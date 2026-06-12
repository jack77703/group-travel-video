import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'

const OUTPUT_FPS = 30
const ZOOM_MAGNITUDE = 0.15 // photos zoom between 1× and 1.15× (Ken Burns)
const ZOOMED_W = Math.round(1080 * (1 + ZOOM_MAGNITUDE)) // 1242
const ZOOMED_H = Math.round(1920 * (1 + ZOOM_MAGNITUDE)) // 2208
const DW = ZOOMED_W - 1080 // 162
const DH = ZOOMED_H - 1920 // 288
const HW = DW / 2 // 81 — half-delta for centred crop offset
const HH = DH / 2 // 144

export async function renderReel(opts: {
  photos: { url: string }[]
  musicUrl: string
  photoDuration: number
  onProgress?: (pct: number) => void
}): Promise<Blob> {
  const { photos, musicUrl, photoDuration, onProgress } = opts

  if (photos.length === 0) throw new Error('No photos provided')

  const ffmpeg = new FFmpeg()
  const frames = Math.round(photoDuration * OUTPUT_FPS)
  const range = Math.max(frames - 1, 1) // denominator for n-based expressions; avoids ÷0

  // Progress tracks across multiple exec calls (clips 0-90%, concat 90-100%)
  let clipsDone = 0
  ffmpeg.on('log', ({ message }) => {
    console.debug('[ffmpeg]', message)
    if (!onProgress) return
    const match = message.match(/frame=\s*(\d+)/)
    if (match) {
      const f = Math.min(parseInt(match[1]), frames)
      const pct = Math.round(((clipsDone * frames + f) / (photos.length * frames)) * 90)
      onProgress(Math.min(90, pct))
    }
  })

  // Try multi-threaded core first; fall back to single-threaded if SAB/worker unavailable.
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
    const photoBuffers = await Promise.all(photos.map(p => fetchFile(p.url)))
    for (let i = 0; i < photoBuffers.length; i++) {
      await ffmpeg.writeFile(`photo${i}.jpg`, photoBuffers[i])
    }
    await ffmpeg.writeFile('music.mp3', await fetchFile(musicUrl))

    // Ken Burns via animated crop+scale.
    // Scale to 1.15× for zoom headroom, then animate the crop window using `n` (frame number).
    //   zoom-in  (even): large crop → small crop  (scene gets closer)
    //   zoom-out (odd):  small crop → large crop  (scene pulls back)
    // The final scale=1080:1920 normalises output regardless of intermediate crop size.
    // NOTE: these expressions work fine in a simple -vf pipeline but deadlock in
    // filter_complex concat (concurrent stream graph never gets EOF from looped inputs).
    // That's why we encode each photo as its own exec() call and concat afterwards.
    const kenBurns = (i: number): string => {
      const prep = [
        `scale=${ZOOMED_W}:${ZOOMED_H}:force_original_aspect_ratio=increase`,
        `crop=${ZOOMED_W}:${ZOOMED_H}`,
        'setsar=1',
      ].join(',')
      if (i % 2 === 0) {
        const w = `${ZOOMED_W}-${DW}*n/${range}`
        const h = `${ZOOMED_H}-${DH}*n/${range}`
        const x = `${HW}*n/${range}`
        const y = `${HH}*n/${range}`
        return `${prep},crop=w='${w}':h='${h}':x='${x}':y='${y}',scale=1080:1920,setsar=1`
      } else {
        const w = `${1080}+${DW}*n/${range}`
        const h = `${1920}+${DH}*n/${range}`
        const x = `${HW}-${HW}*n/${range}`
        const y = `${HH}-${HH}*n/${range}`
        return `${prep},crop=w='${w}':h='${h}':x='${x}':y='${y}',scale=1080:1920,setsar=1`
      }
    }

    if (photos.length === 1) {
      const code = await ffmpeg.exec([
        '-framerate', String(OUTPUT_FPS), '-loop', '1', '-t', String(photoDuration), '-i', 'photo0.jpg',
        '-i', 'music.mp3',
        '-vf', kenBurns(0),
        '-r', String(OUTPUT_FPS),
        '-c:v', 'libx264', '-crf', '23', '-maxrate', '3M', '-bufsize', '6M', '-preset', 'ultrafast',
        '-c:a', 'aac', '-b:a', '128k',
        '-shortest', '-movflags', '+faststart',
        'output.mp4',
      ])
      if (code !== 0) throw new Error(`FFmpeg exited with code ${code}`)
    } else {
      // Encode each photo as an individual clip (simple -vf, no filter_complex).
      for (let i = 0; i < photos.length; i++) {
        const code = await ffmpeg.exec([
          '-framerate', String(OUTPUT_FPS), '-loop', '1', '-t', String(photoDuration), '-i', `photo${i}.jpg`,
          '-vf', kenBurns(i),
          '-r', String(OUTPUT_FPS),
          '-c:v', 'libx264', '-crf', '23', '-maxrate', '3M', '-bufsize', '6M', '-preset', 'ultrafast',
          `clip${i}.mp4`,
        ])
        if (code !== 0) throw new Error(`Failed to encode photo ${i} (exit ${code})`)
        clipsDone++
        onProgress?.(Math.round((clipsDone / photos.length) * 90))
      }

      // Join clips + audio with the concat demuxer (no re-encoding of video).
      const concatTxt = 'ffconcat version 1.0\n'
        + photos.map((_, i) => `file 'clip${i}.mp4'\nduration ${photoDuration}`).join('\n')
      await ffmpeg.writeFile('clips.txt', concatTxt)

      onProgress?.(92)

      const code = await ffmpeg.exec([
        '-f', 'concat', '-safe', '0', '-i', 'clips.txt',
        '-i', 'music.mp3',
        '-c:v', 'copy',
        '-c:a', 'aac', '-b:a', '128k',
        '-shortest', '-movflags', '+faststart',
        'output.mp4',
      ])
      if (code !== 0) throw new Error(`FFmpeg concat step failed (exit ${code})`)
    }

    onProgress?.(100)
    const data = await ffmpeg.readFile('output.mp4')
    return new Blob([new Uint8Array(data as Uint8Array)], { type: 'video/mp4' })
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err))
  } finally {
    ffmpeg.terminate()
  }
}
