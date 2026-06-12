import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'

const OUTPUT_FPS = 30
const ZOOM_MAGNITUDE = 0.08
const ZOOMED_W = Math.round(1080 * (1 + ZOOM_MAGNITUDE)) // 1166
const ZOOMED_H = Math.round(1920 * (1 + ZOOM_MAGNITUDE)) // 2074
const DW = ZOOMED_W - 1080 // 86
const DH = ZOOMED_H - 1920 // 154

function getImageDimensions(buffer: Uint8Array): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const blob = new Blob([Uint8Array.from(buffer)], { type: 'image/jpeg' })
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve({ width: img.naturalWidth, height: img.naturalHeight }) }
    img.onerror = () => { URL.revokeObjectURL(url); resolve({ width: 1, height: 2 }) }
    img.src = url
  })
}

export async function renderReel(opts: {
  photos: { url: string }[]
  musicUrl: string
  photoDuration: number
  onProgress?: (pct: number) => void
  onEncoderReady?: () => void
}): Promise<Blob> {
  const { photos, musicUrl, photoDuration, onProgress, onEncoderReady } = opts

  if (photos.length === 0) throw new Error('No photos provided')

  const ffmpeg = new FFmpeg()
  const frames = Math.round(photoDuration * OUTPUT_FPS)
  const range = Math.max(frames - 1, 1)

  let clipsDone = 0
  let lastPct = 0
  ffmpeg.on('log', ({ message }) => {
    console.debug('[ffmpeg]', message)
    if (!onProgress) return
    const match = message.match(/frame=\s*(\d+)/)
    if (match) {
      const f = Math.min(parseInt(match[1]), frames)
      const pct = Math.min(90, Math.round(((clipsDone * frames + f) / (photos.length * frames)) * 90))
      if (pct > lastPct) { lastPct = pct; onProgress(pct) }
    }
  })

  // Wrap any promise with a hard deadline so a hanging CDN fetch never blocks.
  const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
    Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))])

  // MT core is disabled: Chrome's COEP/blob-worker combination means MT
  // never reliably initialises in this app's security context, so attempting
  // it wastes up to 40 seconds (25s download + 15s load) before falling back.
  // ST handles all encoding and produces identical output.
  console.info('[ffmpeg] core: single-threaded')

  const stURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd'
  const [coreURL, wasmURL] = await withTimeout(
    Promise.all([
      toBlobURL(`${stURL}/ffmpeg-core.js`,  'text/javascript'),
      toBlobURL(`${stURL}/ffmpeg-core.wasm`, 'application/wasm'),
    ]),
    30000,
  )
  await withTimeout(ffmpeg.load({ coreURL, wasmURL }), 15000)

  // Core is loaded — signal caller so UI can transition from "Loading encoder"
  // to "Encoding". Without this, the progress bar sits at 0% during WASM load
  // (up to 15s on mobile) making it look frozen.
  onEncoderReady?.()

  try {
    const photoBuffers = await Promise.all(photos.map(p => fetchFile(p.url)))
    const isLandscape = await Promise.all(
      photoBuffers.map(async (buf) => {
        const { width, height } = await getImageDimensions(buf)
        return width > height
      })
    )
    for (let i = 0; i < photoBuffers.length; i++) {
      await ffmpeg.writeFile(`photo${i}.jpg`, photoBuffers[i])
    }
    await ffmpeg.writeFile('music.mp3', await fetchFile(musicUrl))

    // ─── Ken Burns filters ────────────────────────────────────────────────────
    //
    // Portrait  → zoom-in/out with corner variation
    //   Corners cycle TL → TR → BL → BR as photos progress (i % 4).
    //   Zoom direction alternates in/out (i % 2).
    //   This gives cinematic variety without looking showy — the viewer just
    //   feels the reel has energy, not that it loops the same move.
    //
    // Landscape → blurred background + sharp foreground + horizontal pan
    //   The photo is shown at full width (1080px) on a blurred, darkened copy
    //   of itself. This is the standard social-video treatment for wide photos.
    //   A subtle horizontal pan (86px across the clip) adds motion.
    //   Uses filter_complex (split stream → two processing paths → overlay).
    //   Safe to use here because each exec call has only ONE looped input,
    //   so the filter_complex concat deadlock cannot occur.
    //
    // Returns { vf } for portrait (simple chain) or { fc } for landscape.
    // ─────────────────────────────────────────────────────────────────────────

    type Filter = { vf: string; fc?: never } | { fc: string; vf?: never }

    const portraitFilter = (i: number): string => {
      const prep = [
        `scale=${ZOOMED_W}:${ZOOMED_H}:force_original_aspect_ratio=increase`,
        `crop=${ZOOMED_W}:${ZOOMED_H}`,
        'setsar=1',
      ].join(',')

      // corner: 0=TL 1=TR 2=BL 3=BR
      const corner = i % 4
      const xLeft = corner === 0 || corner === 2  // TL / BL → left edge anchored
      const yTop  = corner === 0 || corner === 1  // TL / TR → top edge anchored

      if (i % 2 === 0) {
        // zoom-in: crop shrinks toward the anchored corner
        const w = `${ZOOMED_W}-${DW}*n/${range}`
        const h = `${ZOOMED_H}-${DH}*n/${range}`
        const x = xLeft ? '0' : `${DW}*n/${range}`
        const y = yTop  ? '0' : `${DH}*n/${range}`
        return `${prep},crop=w='${w}':h='${h}':x='${x}':y='${y}',scale=1080:1920,setsar=1`
      } else {
        // zoom-out: crop grows away from the anchored corner
        const w = `${1080}+${DW}*n/${range}`
        const h = `${1920}+${DH}*n/${range}`
        const x = xLeft ? '0' : `${DW}-${DW}*n/${range}`
        const y = yTop  ? '0' : `${DH}-${DH}*n/${range}`
        return `${prep},crop=w='${w}':h='${h}':x='${x}':y='${y}',scale=1080:1920,setsar=1`
      }
    }

    const landscapeFilter = (i: number): string => {
      // pan direction alternates per photo
      const panX = i % 2 === 0
        ? `${DW}*n/${range}`
        : `${DW}-${DW}*n/${range}`
      // Background: fill 1080×1920, blur heavily, darken 25%
      // Foreground: scale to ZOOMED_W wide, crop 1080px wide with pan, overlay centred
      // Blur via scale-down + scale-up (bilinear). gblur=sigma=25 is O(radius²) per
      // pixel — at 1080×1920 it takes minutes in single-threaded WASM. This is
      // ~10,000× faster and produces an indistinguishable blurry background.
      return (
        `[0:v]split=2[fg][bg];` +
        `[bg]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,` +
        `scale=68:120:flags=bilinear,scale=1080:1920:flags=bilinear,eq=brightness=-0.25[bgblur];` +
        `[fg]scale=${ZOOMED_W}:-2[fgbig];` +
        `[fgbig]crop=1080:ih:${panX}:0[fgpan];` +
        `[bgblur][fgpan]overlay=0:(H-h)/2,setsar=1`
      )
    }

    const kenBurns = (i: number): Filter =>
      isLandscape[i]
        ? { fc: landscapeFilter(i) }
        : { vf: portraitFilter(i) }

    // ─── Encoding ─────────────────────────────────────────────────────────────

    if (photos.length === 1) {
      const { vf, fc } = kenBurns(0)
      const filterArgs = fc ? ['-filter_complex', fc] : ['-vf', vf!]
      const code = await ffmpeg.exec([
        '-framerate', String(OUTPUT_FPS), '-loop', '1', '-t', String(photoDuration), '-i', 'photo0.jpg',
        '-i', 'music.mp3',
        ...filterArgs,
        '-r', String(OUTPUT_FPS),
        '-c:v', 'libx264', '-crf', '23', '-maxrate', '3M', '-bufsize', '6M', '-preset', 'ultrafast',
        '-c:a', 'aac', '-b:a', '128k',
        '-shortest', '-movflags', '+faststart',
        'output.mp4',
      ])
      if (code !== 0) throw new Error(`FFmpeg exited with code ${code}`)
    } else {
      for (let i = 0; i < photos.length; i++) {
        const { vf, fc } = kenBurns(i)
        const filterArgs = fc ? ['-filter_complex', fc] : ['-vf', vf!]
        const code = await ffmpeg.exec([
          '-framerate', String(OUTPUT_FPS), '-loop', '1', '-t', String(photoDuration), '-i', `photo${i}.jpg`,
          ...filterArgs,
          '-r', String(OUTPUT_FPS),
          '-c:v', 'libx264', '-crf', '23', '-maxrate', '3M', '-bufsize', '6M', '-preset', 'ultrafast',
          `clip${i}.mp4`,
        ])
        if (code !== 0) throw new Error(`Failed to encode photo ${i} (exit ${code})`)
        clipsDone++
        lastPct = Math.round((clipsDone / photos.length) * 90)
        onProgress?.(lastPct)
      }

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
