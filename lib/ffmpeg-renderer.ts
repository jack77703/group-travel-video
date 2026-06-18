import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile } from '@ffmpeg/util'

// Streams a URL into a blob: URL, reporting byte-level download progress.
// Replaces toBlobURL() which blindly buffers the entire file before returning
// — that works fine for small files but blocks with no feedback for 31 MB WASM.
// Falls back to arrayBuffer() when Content-Length is absent (no progress shown).
async function streamToBlobURL(
  url: string,
  mimeType: string,
  onProgress?: (pct: number) => void,
): Promise<string> {
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`Failed to fetch ${url} (${resp.status})`)
  const total = parseInt(resp.headers.get('content-length') ?? '0', 10)
  if (!onProgress || !total || !resp.body) {
    const buf = await resp.arrayBuffer()
    return URL.createObjectURL(new Blob([buf], { type: mimeType }))
  }
  const reader = resp.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.byteLength
    onProgress(Math.min(99, Math.round((received / total) * 100)))
  }
  onProgress(100)
  return URL.createObjectURL(new Blob(chunks.map(c => Uint8Array.from(c)), { type: mimeType }))
}

// 24 fps is cinema standard and imperceptibly different from 30 fps for
// 2-3 s Ken Burns clips. Encodes 20% fewer frames with zero visible quality loss.
const OUTPUT_FPS = 24
const ZOOM_MAGNITUDE = 0.08
const ZOOMED_W = Math.round(1080 * (1 + ZOOM_MAGNITUDE)) // 1166
const ZOOMED_H = Math.round(1920 * (1 + ZOOM_MAGNITUDE)) // 2074
const DW = ZOOMED_W - 1080 // 86
const DH = ZOOMED_H - 1920 // 154

// ─── Module-level WASM blob cache ─────────────────────────────────────────
// Blob URLs are created once and reused for the lifetime of the page.
// A second "Generate Again" in the same session skips the 31 MB download.
type CoreBlobs = { coreURL: string; wasmURL: string; workerURL: string }
let _blobCache: CoreBlobs | null = null
let _preloadPromise: Promise<CoreBlobs> | null = null

function _downloadBlobs(onProgress?: (pct: number) => void): Promise<CoreBlobs> {
  // SharedArrayBuffer is required for the multi-threaded core. It's only
  // available when COOP/COEP headers are present (iOS 15.2+, modern Android).
  // Older devices fall back to the single-threaded core — no SAB needed there.
  const useMT = typeof SharedArrayBuffer !== 'undefined'
  console.info(`[ffmpeg] core: ${useMT ? 'multi-threaded' : 'single-threaded (no SharedArrayBuffer)'}`)
  if (!useMT) {
    return Promise.all([
      streamToBlobURL('/ffmpeg/ffmpeg-core.js',   'text/javascript'),
      streamToBlobURL('/ffmpeg/ffmpeg-core.wasm', 'application/wasm', onProgress),
    ]).then(([coreURL, wasmURL]) => {
      _blobCache = { coreURL, wasmURL, workerURL: '' }
      return _blobCache
    })
  }
  return Promise.all([
    streamToBlobURL('/ffmpeg-mt/ffmpeg-core.js',        'text/javascript'),
    streamToBlobURL('/ffmpeg-mt/ffmpeg-core.wasm',      'application/wasm', onProgress),
    streamToBlobURL('/ffmpeg-mt/ffmpeg-core.worker.js', 'text/javascript'),
  ]).then(([coreURL, wasmURL, workerURL]) => {
    _blobCache = { coreURL, wasmURL, workerURL }
    return _blobCache
  })
}

async function _getBlobs(onProgress?: (pct: number) => void): Promise<CoreBlobs> {
  if (_blobCache) { onProgress?.(100); return _blobCache }
  if (_preloadPromise) {
    try {
      // Background preload already in flight — wait for it (can't pipe progress)
      const blobs = await _preloadPromise
      onProgress?.(100)
      return blobs
    } catch {
      // Preload failed — clear so the next call can retry with progress reporting
      _preloadPromise = null
    }
  }
  // Nothing started (or preload failed) — download now with progress reporting
  _preloadPromise = _downloadBlobs(onProgress)
  return _preloadPromise
}

/**
 * Call on generate page mount to download MT WASM in the background while
 * the user picks music. By the time they click Generate the download is done.
 */
export async function preloadEncoder(): Promise<void> {
  if (_blobCache || _preloadPromise) return
  _preloadPromise = _downloadBlobs() // silent — no progress callback
}

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
  onDownloadProgress?: (pct: number) => void
  onClipStart?: (clipIndex: number, total: number) => void
}): Promise<Blob> {
  const { photos, musicUrl, photoDuration, onProgress, onEncoderReady, onDownloadProgress } = opts

  console.info(`[renderer] starting: photos=${photos.length} pace=${photoDuration}s`)

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

  // streamToBlobURL fetches files in the main thread (same-origin, so no CDN
  // or browser-extension interference) and gives the @ffmpeg/ffmpeg Worker a
  // blob: URL it can read from memory without making its own network request.
  //
  // The WASM file is 31 MB. On a slow connection this takes 30–120s. We show
  // byte-level progress so the user sees "Downloading encoder… 45%" rather
  // than a frozen spinner. There is intentionally no download timeout — the
  // progress bar is the signal, and the browser surfaces network errors itself.
  const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
    Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))])

  console.info('[ffmpeg] acquiring WASM blobs...')
  const { coreURL, wasmURL, workerURL } = await _getBlobs(onDownloadProgress)
  const coreLabel = workerURL ? 'multi-threaded' : 'single-threaded'
  console.info(`[ffmpeg] WASM blobs ready, initialising ${coreLabel} core...`)
  try {
    const loadOpts = workerURL ? { coreURL, wasmURL, workerURL } : { coreURL, wasmURL }
    await withTimeout(ffmpeg.load(loadOpts), 90000)
  } catch (loadErr) {
    // Emscripten sometimes throws non-Error values (strings, abort objects).
    // Normalise so the catch in generate/page.tsx always sees an Error.message.
    throw loadErr instanceof Error ? loadErr : new Error(`FFmpeg init failed: ${String(loadErr)}`)
  }

  // Core is loaded — signal caller so UI can transition from "Loading encoder"
  // to "Encoding". Without this, the progress bar sits at 0% during WASM load
  // (up to 15s on mobile) making it look frozen.
  onEncoderReady?.()

  try {
    const [photoBuffers, musicData] = await Promise.all([
      Promise.all(photos.map(p => fetchFile(p.url))),
      fetchFile(musicUrl),
    ])
    const badBuffers = photoBuffers
      .map((b, i) => ({ i, valid: b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF, size: b.byteLength }))
      .filter(x => !x.valid || x.size < 2000)
    if (badBuffers.length > 0) console.error('[renderer] suspicious buffers:', badBuffers)
    console.info(`[renderer] buffer sizes: ${photoBuffers.map(b => b.byteLength).join(',')}`)

    const isLandscape = await Promise.all(
      photoBuffers.map(async (buf) => {
        const { width, height } = await getImageDimensions(buf)
        return width > height
      })
    )
    for (let i = 0; i < photoBuffers.length; i++) {
      await ffmpeg.writeFile(`photo${i}.jpg`, photoBuffers[i])
    }
    await ffmpeg.writeFile('music.mp3', musicData)

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

      // All clips zoom-in toward the anchored corner — different corners give
      // cinematic variety without zoom-out, which is too subtle to perceive at
      // 8% magnitude over 2-3 s.
      // Use `t` (timestamp in seconds) rather than `n` (frame index): `t` is
      // derived from PTS and is always reliable for looped still image inputs,
      // whereas `n` can be inconsistent across ffmpeg.exec() calls in WASM.
      const w = `${ZOOMED_W}-${DW}*t/${photoDuration}`
      const h = `${ZOOMED_H}-${DH}*t/${photoDuration}`
      const x = xLeft ? '0' : `${DW}*t/${photoDuration}`
      const y = yTop  ? '0' : `${DH}*t/${photoDuration}`
      return `${prep},crop=w='${w}':h='${h}':x='${x}':y='${y}',scale=1080:1920,setsar=1`
    }

    const landscapeFilter = (i: number): string => {
      // pan direction alternates per photo
      const panX = i % 2 === 0
        ? `${DW}*t/${photoDuration}`
        : `${DW}-${DW}*t/${photoDuration}`
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
        opts.onClipStart?.(i, photos.length)
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

      // duration is specified for every clip EXCEPT the last.
      // The concat demuxer uses duration to know when to cut each segment; giving
      // duration to the last clip causes FFmpeg to seek past end-of-file when the
      // encoded clip is even one frame shorter than the stated duration — the last
      // clip gets truncated or dropped. Without duration, it plays to natural end.
      const concatTxt = 'ffconcat version 1.0\n'
        + photos.map((_, i) => {
          const isLast = i === photos.length - 1
          return isLast
            ? `file 'clip${i}.mp4'`
            : `file 'clip${i}.mp4'\nduration ${photoDuration}`
        }).join('\n')
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
