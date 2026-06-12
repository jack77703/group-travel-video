import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'

export async function renderReel(opts: {
  photos: { url: string }[]
  musicUrl: string
  photoDuration: number
  onProgress?: (pct: number) => void
}): Promise<Blob> {
  const { photos, musicUrl, photoDuration, onProgress } = opts

  if (photos.length === 0) throw new Error('No photos provided')

  const ffmpeg = new FFmpeg()

  ffmpeg.on('log', ({ message }) => {
    if (!onProgress) return
    const match = message.match(/frame=\s*(\d+)/)
    if (match) {
      const totalFrames = photos.length * photoDuration * 30
      const pct = Math.min(99, Math.round((parseInt(match[1]) / totalFrames) * 100))
      onProgress(pct)
    }
  })

  // Single-threaded core — no SharedArrayBuffer / COOP-COEP headers needed
  const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd'
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
  })

  try {
    // Fetch all photos in parallel, then write to virtual FS serially
    const photoBuffers = await Promise.all(photos.map((p) => fetchFile(p.url)))
    for (let i = 0; i < photoBuffers.length; i++) {
      await ffmpeg.writeFile(`photo${i}.jpg`, photoBuffers[i])
    }

    await ffmpeg.writeFile('music.mp3', await fetchFile(musicUrl))

    // ffconcat requires a trailing file entry (no duration) to flush the last frame
    const lines = photos.map((_, i) => `file 'photo${i}.jpg'\nduration ${photoDuration}`).join('\n')
    await ffmpeg.writeFile(
      'concat.txt',
      `ffconcat version 1.0\n${lines}\nfile 'photo${photos.length - 1}.jpg'\n`
    )

    const exitCode = await ffmpeg.exec([
      '-f', 'concat', '-safe', '0', '-i', 'concat.txt',
      '-r', '30',
      '-i', 'music.mp3',
      '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black',
      '-c:v', 'libx264', '-crf', '18', '-preset', 'ultrafast',
      '-c:a', 'aac', '-b:a', '128k',
      '-shortest', '-movflags', '+faststart',
      'output.mp4',
    ])

    if (exitCode !== 0) throw new Error(`FFmpeg exited with code ${exitCode}`)

    onProgress?.(100)

    const data = await ffmpeg.readFile('output.mp4')
    return new Blob([new Uint8Array(data as Uint8Array)], { type: 'video/mp4' })
  } finally {
    ffmpeg.terminate()
  }
}
