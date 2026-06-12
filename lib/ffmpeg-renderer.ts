import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'

const TRANSITION_DURATION = 0.5 // seconds, crossfade overlap between photos

export async function renderReel(opts: {
  photos: { url: string }[]
  musicUrl: string
  photoDuration: number
  onProgress?: (pct: number) => void
}): Promise<Blob> {
  const { photos, musicUrl, photoDuration, onProgress } = opts

  if (photos.length === 0) throw new Error('No photos provided')

  if (photoDuration <= TRANSITION_DURATION) {
    throw new Error(
      `photoDuration (${photoDuration}s) must be greater than transition duration (${TRANSITION_DURATION}s)`
    )
  }

  const ffmpeg = new FFmpeg()

  // Total output duration is shorter than a hard-cut slideshow because transitions overlap
  const totalDuration =
    photos.length * photoDuration - (photos.length - 1) * TRANSITION_DURATION
  const totalFrames = Math.round(totalDuration * 30)

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
    // Fetch all photos in parallel, then write to virtual FS serially
    const photoBuffers = await Promise.all(photos.map((p) => fetchFile(p.url)))
    for (let i = 0; i < photoBuffers.length; i++) {
      await ffmpeg.writeFile(`photo${i}.jpg`, photoBuffers[i])
    }
    await ffmpeg.writeFile('music.mp3', await fetchFile(musicUrl))

    const args: string[] = []

    // One looping still-image input per photo, each capped at photoDuration
    for (let i = 0; i < photos.length; i++) {
      args.push('-framerate', '30', '-loop', '1', '-t', String(photoDuration), '-i', `photo${i}.jpg`)
    }
    // Music is the last input (index = photos.length)
    args.push('-i', 'music.mp3')

    const scaleFilter =
      'scale=1080:1920:force_original_aspect_ratio=decrease,' +
      'pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,setsar=1'

    if (photos.length === 1) {
      // Single photo: no xfade needed, use simple -vf
      args.push(
        '-vf', scaleFilter,
        '-r', '30',
        '-map', '0:v',
        '-map', `${photos.length}:a`,
      )
    } else {
      // Build filter_complex: scale each input, then chain xfade dissolves
      const filterParts: string[] = []

      for (let i = 0; i < photos.length; i++) {
        filterParts.push(`[${i}:v]${scaleFilter}[v${i}]`)
      }

      let lastLabel = 'v0'
      for (let i = 1; i < photos.length; i++) {
        const offset = i * (photoDuration - TRANSITION_DURATION)
        const outLabel = i === photos.length - 1 ? 'vout' : `x${i}`
        filterParts.push(
          `[${lastLabel}][v${i}]xfade=transition=fade:duration=${TRANSITION_DURATION}:offset=${offset}[${outLabel}]`
        )
        lastLabel = outLabel
      }

      args.push(
        '-filter_complex', filterParts.join(';'),
        '-map', '[vout]',
        '-map', `${photos.length}:a`,
        '-r', '30',
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
