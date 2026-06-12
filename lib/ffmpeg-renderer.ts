import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'

const OUTPUT_FPS = 30
const ZOOM_MAGNITUDE = 0.08 // 8% extra area — subtle Ken Burns, less crop than 15%
const ZOOMED_W = Math.round(1080 * (1 + ZOOM_MAGNITUDE)) // 1166
const ZOOMED_H = Math.round(1920 * (1 + ZOOM_MAGNITUDE)) // 2074
const DW = ZOOMED_W - 1080 // 86
const DH = ZOOMED_H - 1920 // 154
const HW = DW / 2 // 43 — half-delta for centred crop offset
const HH = DH / 2 // 77

// Decode image from buffer into an <img> to read natural dimensions.
function getImageDimensions(buffer: Uint8Array): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const blob = new Blob([buffer], { type: 'image/jpeg' })
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve({ width: img.naturalWidth, height: img.naturalHeight }) }
    img.onerror = () => { URL.revokeObjectURL(url); resolve({ width: 1, height: 2 }) } // fallback portrait
    img.src = url
  })
}

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
  let lastPct = 0
  ffmpeg.on('log', ({ message }) => {
    console.debug('[ffmpeg]', message)
    if (!onProgress) return
    const match = message.match(/frame=\s*(\d+)/)
    if (match) {
      const f = Math.min(parseInt(match[1]), frames)
      const pct = Math.min(90, Math.round(((clipsDone * frames + f) / (photos.length * frames)) * 90))
      if (pct > lastPct) {
        lastPct = pct
        onProgress(pct)
      }
    }
  })

  // SharedArrayBuffer is required for the MT core. If the browser doesn't expose it
  // (older iOS Safari, some Android WebViews) skip straight to ST — no point downloading
  // the heavy MT WASM (~25 MB) only to fail.
  const sabAvailable = typeof SharedArrayBuffer !== 'undefined'
  console.info('[ffmpeg] SharedArrayBuffer available:', sabAvailable)

  // Try multi-threaded core first; fall back to single-threaded if SAB/worker unavailable.
  // The MT core can silently hang on some desktop browsers (workers spawn but never
  // handshake back) — a plain try/catch won't catch a hung promise. We race against a
  // 15-second timeout so a hang triggers the ST fallback just like a thrown error would.
  const mtLoaded = sabAvailable && await (async () => {
    try {
      const mtURL = 'https://unpkg.com/@ffmpeg/core-mt@0.12.6/dist/umd'
      const [coreURL, wasmURL, workerURL] = await Promise.all([
        toBlobURL(`${mtURL}/ffmpeg-core.js`,        'text/javascript'),
        toBlobURL(`${mtURL}/ffmpeg-core.wasm`,      'application/wasm'),
        toBlobURL(`${mtURL}/ffmpeg-core.worker.js`, 'text/javascript'),
      ])
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('MT load timeout')), 15000)
      )
      await Promise.race([ffmpeg.load({ coreURL, wasmURL, workerURL }), timeout])
      return true
    } catch {
      return false
    }
  })()

  console.info('[ffmpeg] core:', mtLoaded ? 'multi-threaded' : 'single-threaded')

  if (!mtLoaded) {
    const stURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd'
    await ffmpeg.load({
      coreURL: await toBlobURL(`${stURL}/ffmpeg-core.js`,  'text/javascript'),
      wasmURL: await toBlobURL(`${stURL}/ffmpeg-core.wasm`, 'application/wasm'),
    })
  }

  try {
    const photoBuffers = await Promise.all(photos.map(p => fetchFile(p.url)))

    // Detect landscape orientation for each photo so Ken Burns pans the right axis.
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

    // Ken Burns via animated crop+scale.
    //
    // Portrait photos (width ≤ height):
    //   prep — scale to 1.08× (ZOOMED_W×ZOOMED_H) then crop to exact size
    //   animate — zoom-in (even): crop window shrinks + drifts diagonally toward the corner
    //             zoom-out (odd): crop window grows from corner
    //   The final scale=1080:1920 normalises output.
    //
    // Landscape photos (width > height):
    //   prep — same scale+crop; the heavy horizontal crop already happens here
    //   animate — pan horizontally only (x moves, y stays at HH centre)
    //   This matches how the eye reads wide photos — left/right reveals, not up/down zoom.
    //
    // NOTE: these expressions work in a simple -vf pipeline but deadlock in filter_complex
    // concat (looped streams never signal EOF to the concat filter).
    // Solution: encode each photo as its own exec() call, then concat demuxer joins them.
    const kenBurns = (i: number): string => {
      const prep = [
        `scale=${ZOOMED_W}:${ZOOMED_H}:force_original_aspect_ratio=increase`,
        `crop=${ZOOMED_W}:${ZOOMED_H}`,
        'setsar=1',
      ].join(',')

      if (isLandscape[i]) {
        // Horizontal pan: x slides across DW pixels, y is fixed at vertical centre (HH).
        // Even → left-to-right; odd → right-to-left.
        const x = i % 2 === 0
          ? `${DW}*n/${range}`
          : `${DW}-${DW}*n/${range}`
        return `${prep},crop=w=1080:h=1920:x='${x}':y=${HH},scale=1080:1920,setsar=1`
      }

      // Portrait: zoom-in/out with diagonal drift
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
        lastPct = Math.round((clipsDone / photos.length) * 90)
        onProgress?.(lastPct)
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
