import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'

const OUTPUT_FPS = 30
const ZOOM_MAGNITUDE = 0.15 // photos zoom between 1× and 1.15× (Ken Burns)
const ZOOMED_W = Math.round(1080 * (1 + ZOOM_MAGNITUDE)) // 1242
const ZOOMED_H = Math.round(1920 * (1 + ZOOM_MAGNITUDE)) // 2208
const DW = ZOOMED_W - 1080 // 162 — crop width delta across the zoom range
const DH = ZOOMED_H - 1920 // 288 — crop height delta across the zoom range

export async function renderReel(opts: {
  photos: { url: string }[]
  musicUrl: string
  photoDuration: number
  onProgress?: (pct: number) => void
}): Promise<Blob> {
  const { photos, musicUrl, photoDuration, onProgress } = opts

  if (photos.length === 0) throw new Error('No photos provided')

  const ffmpeg = new FFmpeg()

  const totalFrames = photos.length * photoDuration * OUTPUT_FPS

  ffmpeg.on('log', ({ message }) => {
    if (!onProgress) return
    const match = message.match(/frame=\s*(\d+)/)
    if (match) {
      const pct = Math.min(99, Math.round((parseInt(match[1]) / totalFrames) * 100))
      onProgress(pct)
    }
  })

  // Try multi-threaded core first (2-4× faster, needs SharedArrayBuffer + COOP/COEP headers).
  // Fall back to single-threaded if MT fails for any reason (missing SAB, network error, etc.).
  try {
    const mtURL = 'https://unpkg.com/@ffmpeg/core-mt@0.12.6/dist/umd'
    await ffmpeg.load({
      coreURL:   await toBlobURL(`${mtURL}/ffmpeg-core.js`,        'text/javascript'),
      wasmURL:   await toBlobURL(`${mtURL}/ffmpeg-core.wasm`,      'application/wasm'),
      workerURL: await toBlobURL(`${mtURL}/ffmpeg-core.worker.js`, 'text/javascript'),
    })
  } catch {
    const stURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd'
    await ffmpeg.load({
      coreURL: await toBlobURL(`${stURL}/ffmpeg-core.js`,  'text/javascript'),
      wasmURL: await toBlobURL(`${stURL}/ffmpeg-core.wasm`, 'application/wasm'),
    })
  }

  try {
    const photoBuffers = await Promise.all(photos.map((p) => fetchFile(p.url)))
    for (let i = 0; i < photoBuffers.length; i++) {
      await ffmpeg.writeFile(`photo${i}.jpg`, photoBuffers[i])
    }
    await ffmpeg.writeFile('music.mp3', await fetchFile(musicUrl))

    const args: string[] = []

    for (let i = 0; i < photos.length; i++) {
      args.push('-framerate', String(OUTPUT_FPS), '-loop', '1', '-t', String(photoDuration), '-i', `photo${i}.jpg`)
    }
    args.push('-i', 'music.mp3')

    // Ken Burns via animated crop+scale — avoids zoompan which buffers all frames and hangs.
    // Technique: scale image to 1.15× output size, then animate the crop window:
    //   zoom-in  (even photos): crop shrinks from ZOOMED_W×ZOOMED_H → 1080×1920 (centred)
    //   zoom-out (odd  photos): crop grows  from 1080×1920 → ZOOMED_W×ZOOMED_H (centred)
    // The final scale=1080:1920 normalises output regardless of intermediate crop size.
    const frames = Math.round(photoDuration * OUTPUT_FPS)
    const range  = Math.max(frames - 1, 1) // denominator for n-based expressions; avoids ÷0

    const kenBurns = (i: number): string => {
      const prep    = `scale=${ZOOMED_W}:${ZOOMED_H}:force_original_aspect_ratio=increase,crop=${ZOOMED_W}:${ZOOMED_H},setsar=1`
      const zoomIn  = `crop=w='${ZOOMED_W}-${DW}*n/${range}':h='${ZOOMED_H}-${DH}*n/${range}':x='(iw-ow)/2':y='(ih-oh)/2'`
      const zoomOut = `crop=w='${1080}+${DW}*n/${range}':h='${1920}+${DH}*n/${range}':x='(iw-ow)/2':y='(ih-oh)/2'`
      return `${prep},${i % 2 === 0 ? zoomIn : zoomOut},scale=1080:1920,setsar=1`
    }

    if (photos.length === 1) {
      args.push(
        '-vf', kenBurns(0),
        '-map', '0:v',
        '-map', '1:a',
      )
    } else {
      const filterParts: string[] = []
      for (let i = 0; i < photos.length; i++) {
        filterParts.push(`[${i}:v]${kenBurns(i)}[v${i}]`)
      }
      const concatInputs = Array.from({ length: photos.length }, (_, i) => `[v${i}]`).join('')
      filterParts.push(`${concatInputs}concat=n=${photos.length}:v=1:a=0[vout]`)

      args.push(
        '-filter_complex', filterParts.join(';'),
        '-map', '[vout]',
        '-map', `${photos.length}:a`,
      )
    }

    args.push(
      '-c:v', 'libx264', '-crf', '23', '-maxrate', '3M', '-bufsize', '6M', '-preset', 'ultrafast',
      '-c:a', 'aac', '-b:a', '128k',
      '-shortest', '-movflags', '+faststart',
      'output.mp4',
    )

    const exitCode = await ffmpeg.exec(args)
    if (exitCode !== 0) throw new Error(`FFmpeg exited with code ${exitCode}`)

    onProgress?.(100)

    const data = await ffmpeg.readFile('output.mp4')
    return new Blob([new Uint8Array(data as Uint8Array)], { type: 'video/mp4' })
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err))
  } finally {
    ffmpeg.terminate()
  }
}
