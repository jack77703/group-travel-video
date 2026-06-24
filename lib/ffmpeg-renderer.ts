import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile } from '@ffmpeg/util'

import { FFmpegPool } from './ffmpeg-pool'

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
// Supabase Storage rejects uploads over the project file-size limit (~50 MB).
const MAX_UPLOAD_BYTES = 45 * 1024 * 1024

const VIDEO_ENCODE = [
  '-c:v', 'libx264', '-crf', '28', '-maxrate', '2M', '-bufsize', '4M',
  '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
] as const

// ─── Module-level WASM blob cache ─────────────────────────────────────────
// Blob URLs are created once and reused for the lifetime of the page.
// A second "Generate Again" in the same session skips the 31 MB download.
export type CoreBlobs = { coreURL: string; wasmURL: string; workerURL: string }
let _blobCache: CoreBlobs | null = null
let _preloadPromise: Promise<CoreBlobs> | null = null

function _downloadBlobs(onProgress?: (pct: number) => void): Promise<CoreBlobs> {
  // Always use the single-threaded WASM core. The FFmpegPool already provides
  // parallelism by running N separate Web Workers (one per FFmpeg instance).
  // The MT WASM build (core-mt) compiles in pthreads support via Emscripten
  // USE_PTHREADS, which pre-allocates a pthread Worker pool at ff.load() time.
  // With 3–4 pool instances × that pthread pool, total Worker count can exceed
  // mobile browser limits and cause silent exit 1 before any frame encodes.
  // ST WASM has no pthread pool — it runs one Worker per FFmpeg instance, which
  // is exactly what we want: pool-level parallelism, no nested-Worker risk.
  const useMT = false
  console.info('[ffmpeg] core: single-threaded WASM (pool provides clip-level parallelism)')
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

export async function getWasmBlobs(onProgress?: (pct: number) => void): Promise<CoreBlobs> {
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
 * Call on lobby page mount to download WASM in the background while
 * the user waits for friends. By the time they click Generate the download is done.
 */
export async function preloadEncoder(): Promise<void> {
  if (_blobCache || _preloadPromise) return
  _preloadPromise = _downloadBlobs() // silent — no progress callback
}

function finalizeMp4Blob(data: Uint8Array): Blob {
  const blob = new Blob([new Uint8Array(data)], { type: 'video/mp4' })
  const mb = blob.size / (1024 * 1024)
  console.info(`[renderer] output ${mb.toFixed(1)} MB`)
  if (blob.size > MAX_UPLOAD_BYTES) {
    throw new Error(
      `Video is too large to upload (${mb.toFixed(0)} MB). Try fewer photos or a faster pace.`
    )
  }
  return blob
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

  const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
    Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))])

  console.info('[ffmpeg] acquiring WASM blobs...')
  const blobs = await getWasmBlobs(onDownloadProgress)
  const blobOpts = blobs.workerURL
    ? { coreURL: blobs.coreURL, wasmURL: blobs.wasmURL, workerURL: blobs.workerURL }
    : { coreURL: blobs.coreURL, wasmURL: blobs.wasmURL }

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

  // Track each photo's position within the landscape-photo sequence (0 = first
  // landscape photo, 1 = second, etc.) to alternate LTR/RTL pan independently
  // of portrait photos.
  let _lscapeCount = 0
  const landscapeSeq = isLandscape.map(land => land ? _lscapeCount++ : -1)

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

  const clipFrames = Math.max(Math.round(OUTPUT_FPS * photoDuration), 2)
  const onLast = clipFrames - 1

  const portraitFilter = (i: number): string => {
    const prep = [
      `scale=${ZOOMED_W}:${ZOOMED_H}:force_original_aspect_ratio=increase`,
      `crop=${ZOOMED_W}:${ZOOMED_H}`,
      'setsar=1',
    ].join(',')

    // z/x/y each driven directly by on/onLast — no coupling between them.
    // zoom-in must start at (0,0) because at z=1.0 the crop fills the whole image.
    // zoom-out can start at (DW,DH) because at z=1.08 those offsets are within range.
    const zIn  = `1+${ZOOM_MAGNITUDE}*on/${onLast}`
    const zOut = `${1 + ZOOM_MAGNITUDE}-${ZOOM_MAGNITUDE}*on/${onLast}`
    const xFwd = `${DW}*on/${onLast}`
    const xBak = `${DW}-${DW}*on/${onLast}`
    const yFwd = `${DH}*on/${onLast}`
    const yBak = `${DH}-${DH}*on/${onLast}`

    const corners = [
      { z: zIn,  x: xFwd, y: yFwd },  // 0: zoom in,  TL → BR diagonal
      { z: zOut, x: xBak, y: yBak },  // 1: zoom out, BR → TL diagonal
      { z: zIn,  x: xFwd, y: '0'  },  // 2: zoom in,  L → R horizontal
      { z: zOut, x: xBak, y: '0'  },  // 3: zoom out, R → L horizontal
    ] as const
    const { z, x, y } = corners[i % 4]

    return (
      `${prep},` +
      `zoompan=z='${z}':x='${x}':y='${y}':d=${clipFrames}:s=1080x1920:fps=${OUTPUT_FPS},` +
      `format=yuv420p,setsar=1`
    )
  }

  const landscapeFilter = (i: number): string => {
    const seq = landscapeSeq[i]  // 0 for first landscape photo, 1 for second, etc.
    const ltr = seq % 2 === 0
    // Only x varies; w=1080 and h=ih are constant integers, so the filter graph
    // output size never changes and WASM never reinitializes the filter graph.
    // t goes from 0 to photoDuration (set by -framerate -loop 1 -t in stillInputArgs).
    const xExpr = ltr
      ? `${DW}*t/${photoDuration}`           // 0 → DW  (left to right)
      : `${DW}-${DW}*t/${photoDuration}`    // DW → 0  (right to left)
    return (
      `[0:v]split=2[fg][bg];` +
      `[bg]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,` +
      `scale=68:120:flags=bilinear,scale=1080:1920:flags=bilinear,eq=brightness=-0.25[bgblur];` +
      `[fg]scale=${ZOOMED_W}:-2[fgbig];` +
      `[fgbig]crop=1080:ih:'${xExpr}':0[fgpan];` +
      `[bgblur][fgpan]overlay=0:(H-h)/2,format=yuv420p,setsar=1`
    )
  }

  const kenBurns = (i: number): Filter =>
    isLandscape[i]
      ? { fc: landscapeFilter(i) }
      : { vf: portraitFilter(i) }

  // zoompan emits `d` output frames per input frame. Looping the image before
  // zoompan multiplies frames (e.g. 48 inputs × 48 outputs) → huge files + 413.
  const stillInputArgs = (inputFile: string, i: number): string[] =>
    isLandscape[i]
      ? ['-framerate', String(OUTPUT_FPS), '-loop', '1', '-t', String(photoDuration), '-i', inputFile]
      : ['-i', inputFile]

  const clipVideoArgs = (): string[] => [
    '-frames:v', String(clipFrames),
    '-r', String(OUTPUT_FPS),
    ...VIDEO_ENCODE,
  ]

  // ─── Single photo: encode with audio in one pass ──────────────────────────
  if (photos.length === 1) {
    const ffmpeg = new FFmpeg()
    const coreLabel = blobOpts.workerURL ? 'multi-threaded' : 'single-threaded'
    console.info(`[ffmpeg] initialising ${coreLabel} core...`)
    try {
      await withTimeout(ffmpeg.load(blobOpts), 90000)
    } catch (loadErr) {
      throw loadErr instanceof Error ? loadErr : new Error(`FFmpeg init failed: ${String(loadErr)}`)
    }
    onEncoderReady?.()
    try {
      await ffmpeg.writeFile('photo0.jpg', photoBuffers[0])
      await ffmpeg.writeFile('music.mp3', musicData)
      const { vf, fc } = kenBurns(0)
      const filterArgs = fc ? ['-filter_complex', fc] : ['-vf', vf!]
      const code = await ffmpeg.exec([
        ...stillInputArgs('photo0.jpg', 0),
        '-i', 'music.mp3',
        ...filterArgs,
        ...clipVideoArgs(),
        '-c:a', 'aac', '-b:a', '128k',
        '-shortest', '-movflags', '+faststart',
        '-y', 'output.mp4',
      ])
      if (code !== 0) throw new Error(`FFmpeg exited with code ${code}`)
      onProgress?.(100)
      const data = await ffmpeg.readFile('output.mp4')
      return finalizeMp4Blob(new Uint8Array(data as Uint8Array))
    } finally {
      ffmpeg.terminate()
    }
  }

  // ─── Multi-photo: parallel clip encoding + concat ─────────────────────────
  //
  // FFmpegPool spawns N FFmpeg instances (each is its own Web Worker).
  // Clips are dispatched round-robin across instances so they encode in
  // parallel — on a 4-core device this is ~4× faster than sequential.
  //
  // After all clips finish, a fresh FFmpeg instance concatenates them with
  // the audio track. The concat step is fast (stream copy, no re-encode).

  const pool = new FFmpegPool()
  let concatFF: FFmpeg | null = null

  try {
    const coreLabel = blobOpts.workerURL ? 'multi-threaded' : 'single-threaded'
    console.info(`[ffmpeg] loading pool (${coreLabel})...`)
    try {
      await withTimeout(pool.load(blobs), 90000)
    } catch (loadErr) {
      throw loadErr instanceof Error ? loadErr : new Error(`FFmpeg pool init failed: ${String(loadErr)}`)
    }
    onEncoderReady?.()

    const encodeOneClip = async (ff: FFmpeg, i: number): Promise<Uint8Array> => {
      // .slice() creates a copy — @ffmpeg/ffmpeg transfers (detaches) the ArrayBuffer
      // via postMessage, so without a copy the original becomes unusable for retries.
      const buf = photoBuffers[i].slice()

      // Reject clearly invalid input before sending to FFmpeg — avoids a
      // cryptic "exit 1" when the real cause is bad photo data.
      if (buf.byteLength < 1000 || buf[0] !== 0xFF || buf[1] !== 0xD8) {
        throw new Error(
          `Photo ${i} is not a valid JPEG (size=${buf.byteLength}, ` +
          `header=0x${buf[0]?.toString(16) ?? '??'}${buf[1]?.toString(16) ?? '??'})`
        )
      }

      // Capture FFmpeg log lines during this exec so exit-1 errors appear in
      // the thrown message — console.debug is filtered in DevTools by default
      // and the user never sees the actual FFmpeg error.
      const fflogs: string[] = []
      const capture = ({ message }: { message: string }) => {
        console.log(`[ffmpeg clip${i}]`, message)
        fflogs.push(message)
      }
      ff.on('log', capture)

      try {
        await ff.writeFile('input.jpg', buf)
        const { vf, fc } = kenBurns(i)
        const filterArgs = fc ? ['-filter_complex', fc] : ['-vf', vf!]
        console.log(`[renderer] encoding clip ${i}: landscape=${isLandscape[i]}, buf=${buf.byteLength}B`)
        const exitCode = await ff.exec([
          ...stillInputArgs('input.jpg', i),
          ...filterArgs,
          ...clipVideoArgs(),
          '-y', 'clip.mp4',
        ])
        if (exitCode !== 0) {
          const errLines = fflogs.filter(l => /error|invalid|failed|no such|unable/i.test(l))
          const tail = (errLines.length ? errLines : fflogs).slice(-8)
          throw new Error(
            `Failed to encode photo ${i} (exit ${exitCode})\n` + tail.join('\n')
          )
        }
        const data = await ff.readFile('clip.mp4')
        return new Uint8Array(data as Uint8Array)
      } finally {
        ff.off('log', capture)
      }
    }

    let clipsDone = 0
    let clipBuffers: Uint8Array[]

    try {
      clipBuffers = await Promise.all(
        photos.map((_, i) =>
          pool.enqueue(i, async (ff) => {
            const buf = await encodeOneClip(ff, i)
            clipsDone++
            onProgress?.(Math.round((clipsDone / photos.length) * 85))
            return buf
          })
        )
      )
    } catch (poolErr) {
      // Parallel encoding failed (thread exhaustion, init race, etc.).
      // Fall back to sequential encoding on a single fresh instance.
      console.warn('[renderer] parallel encode failed, falling back to sequential:', poolErr)
      pool.terminateAll()
      clipsDone = 0
      clipBuffers = []
      const seqFF = new FFmpeg()
      seqFF.on('log', ({ message }: { message: string }) => console.log('[seq-ffmpeg]', message))
      try {
        await seqFF.load(blobOpts)
        for (let i = 0; i < photos.length; i++) {
          clipBuffers.push(await encodeOneClip(seqFF, i))
          clipsDone++
          onProgress?.(Math.round((clipsDone / photos.length) * 85))
        }
      } finally {
        seqFF.terminate()
      }
    }

    pool.terminateAll()
    onProgress?.(88)

    // Concat pass: stream-copy clips + mix audio. Fast — no re-encode.
    concatFF = new FFmpeg()
    await concatFF.load(blobOpts)

    for (let i = 0; i < clipBuffers.length; i++) {
      await concatFF.writeFile(`clip${i}.mp4`, clipBuffers[i])
    }
    await concatFF.writeFile('music.mp3', musicData)

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
    await concatFF.writeFile('clips.txt', concatTxt)
    onProgress?.(90)

    const concatCode = await concatFF.exec([
      '-f', 'concat', '-safe', '0', '-i', 'clips.txt',
      '-i', 'music.mp3',
      '-c:v', 'copy',
      '-c:a', 'aac', '-b:a', '128k',
      '-shortest', '-movflags', '+faststart',
      'output.mp4',
    ])
    if (concatCode !== 0) throw new Error(`FFmpeg concat step failed (exit ${concatCode})`)

    onProgress?.(100)
    const data = await concatFF.readFile('output.mp4')
    return finalizeMp4Blob(new Uint8Array(data as Uint8Array))
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err))
  } finally {
    pool.terminateAll()
    concatFF?.terminate()
  }
}
