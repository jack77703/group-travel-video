import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'

const OUTPUT_FPS = 30
const ZOOM_MAGNITUDE = 0.15 // photos zoom between 1.0 and 1.15 (Ken Burns)

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

  // Multi-threaded core — requires SharedArrayBuffer (COOP/COEP headers in next.config.mjs)
  const baseURL = 'https://unpkg.com/@ffmpeg/core-mt@0.12.6/dist/umd'
  await ffmpeg.load({
    coreURL:   await toBlobURL(`${baseURL}/ffmpeg-core.js`,        'text/javascript'),
    wasmURL:   await toBlobURL(`${baseURL}/ffmpeg-core.wasm`,      'application/wasm'),
    workerURL: await toBlobURL(`${baseURL}/ffmpeg-core.worker.js`, 'text/javascript'),
  })

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

    // Crop-to-fill so zoompan never pans into black letterbox bars
    const coverScale = 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1'
    const frames = Math.round(photoDuration * OUTPUT_FPS)
    // Per-frame zoom increment so the full ZOOM_MAGNITUDE is covered exactly in `frames` frames
    const zinc = (ZOOM_MAGNITUDE / frames).toFixed(6)
    const zoomMax = (1.0 + ZOOM_MAGNITUDE).toFixed(2)

    // Even photos zoom in (1.0→1.15), odd photos zoom out (1.15→1.0) — alternating feels dynamic
    const zoompan = (i: number) => {
      const zExpr = i % 2 === 0
        ? `min(1.0+${zinc}*on,${zoomMax})`
        : `max(${zoomMax}-${zinc}*on,1.0)`
      return `zoompan=z='${zExpr}':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=${OUTPUT_FPS}`
    }

    if (photos.length === 1) {
      args.push(
        '-vf', `${coverScale},${zoompan(0)}`,
        '-map', '0:v',
        '-map', '1:a',
      )
    } else {
      const filterParts: string[] = []
      for (let i = 0; i < photos.length; i++) {
        filterParts.push(`[${i}:v]${coverScale},${zoompan(i)}[v${i}]`)
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
  } finally {
    ffmpeg.terminate()
  }
}
