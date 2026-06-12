// lib/ffmpeg-renderer.ts
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'

export async function renderReel(opts: {
  photos: { url: string }[]
  musicUrl: string
  photoDuration: number
  onProgress?: (pct: number) => void
}): Promise<Blob> {
  const { photos, musicUrl, photoDuration, onProgress } = opts

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

  // Write photos to FFmpeg virtual FS
  for (let i = 0; i < photos.length; i++) {
    await ffmpeg.writeFile(`photo${i}.jpg`, await fetchFile(photos[i].url))
  }

  // Write music
  await ffmpeg.writeFile('music.mp3', await fetchFile(musicUrl))

  // Write concat manifest
  const lines = photos.map((_, i) => `file 'photo${i}.jpg'\nduration ${photoDuration}`).join('\n')
  await ffmpeg.writeFile('concat.txt', `ffconcat version 1.0\n${lines}\n`)

  // Encode
  await ffmpeg.exec([
    '-f', 'concat', '-safe', '0', '-i', 'concat.txt',
    '-i', 'music.mp3',
    '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black',
    '-c:v', 'libx264', '-crf', '18', '-preset', 'ultrafast',
    '-c:a', 'aac', '-b:a', '128k',
    '-shortest', '-movflags', '+faststart',
    'output.mp4',
  ])

  onProgress?.(100)

  const data = await ffmpeg.readFile('output.mp4')
  return new Blob([data as Uint8Array], { type: 'video/mp4' })
}
