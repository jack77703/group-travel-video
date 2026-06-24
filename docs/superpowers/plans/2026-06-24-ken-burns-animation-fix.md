# Ken Burns Animation Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix portrait Ken Burns so every photo has visible smooth diagonal-pan + zoom motion cycling through 4 corners, and add alternating left-to-right / right-to-left horizontal pan to landscape photos.

**Architecture:** Single file change in `lib/ffmpeg-renderer.ts`. Portrait uses the existing `zoompan` filter but with `z`/`x`/`y` each driven directly by `on/onLast` (no coupling between them). Landscape keeps the existing blur+overlay `filter_complex` and adds a time-animated `crop x` (only `x` varies; constant `w` and `h` prevent FFmpeg WASM from reinitializing the filter graph).

**Tech Stack:** FFmpeg WASM (`@ffmpeg/ffmpeg`, ST build at `/public/ffmpeg/`), `zoompan` filter for portrait, `filter_complex` with animated crop-x for landscape, TypeScript.

---

## Background: why the current code is broken

### Portrait — even photos look static, odd photos look jerky

Current `portraitFilter` (lines 204–224 of `lib/ffmpeg-renderer.ts`):

```ts
const xExpr = `(iw-iw/zoom)*on/${onLast}`
const yExpr = panDown ? `(ih-ih/zoom)*on/${onLast}` : `(ih-ih/zoom)/2`
```

The bug: `x` depends on `zoom`, which itself depends on `on`. At `on=0`, zoom=1.0, so `iw-iw/1.0 = 0` → x=0 regardless of `on`. The clip starts completely frozen and then accelerates quadratically — that's why even photos (y is also derived from zoom) look static, and odd photos feel non-linear/jerky.

**Fix:** make `z`, `x`, and `y` each independently proportional to `on/onLast`.

### Landscape — no motion at all

Current `landscapeFilter` (lines 226–236) uses a static center crop:
```ts
`[fgbig]crop=1080:ih:(iw-1080)/2:0[fgpan]`
```
The `(iw-1080)/2` is a constant — it never changes. No pan, no motion.

**Fix:** replace `(iw-1080)/2` with a time expression that slides from 0→DW (LTR) or DW→0 (RTL), alternating per landscape photo.

---

## Key constants (already in the file, do not change)

```ts
const OUTPUT_FPS    = 24
const ZOOM_MAGNITUDE = 0.08
const ZOOMED_W      = 1166  // Math.round(1080 * 1.08)
const ZOOMED_H      = 2074  // Math.round(1920 * 1.08)
const DW            = 86    // ZOOMED_W - 1080 — pixels of pan room (width)
const DH            = 154   // ZOOMED_H - 1920 — pixels of pan room (height)
```

`clipFrames` and `onLast` are computed inside `renderReel` right above the filter functions:
```ts
const clipFrames = Math.max(Math.round(OUTPUT_FPS * photoDuration), 2)
const onLast = clipFrames - 1   // e.g. 47 when photoDuration=2 and OUTPUT_FPS=24
```

---

## Math constraints for portrait zoompan

`zoompan`'s `x` and `y` are the top-left corner of the crop window inside the source image. At zoom factor `z`, the crop window is `iw/z × ih/z` pixels, so the valid ranges are:

- max x = `iw − iw/z` = `ZOOMED_W × (1 − 1/z)`
- max y = `ih − ih/z` = `ZOOMED_H × (1 − 1/z)`

At z=1.0 (start of zoom-in): both max values = 0. So **zoom-in clips must start at x=0, y=0**.  
At z=1.08 (start of zoom-out): max x ≈ DW (86), max y ≈ 153.6. So **zoom-out clips can start at x=DW, y=DH** (zoompan clamps the 0.4px overshoot silently).

This is why zoom direction and pan direction are paired:

| `i % 4` | Zoom | x | y | Motion path |
|---------|------|---|---|-------------|
| 0 | in: 1.0 → 1.08 | 0 → DW | 0 → DH | TL → BR diagonal |
| 1 | out: 1.08 → 1.0 | DW → 0 | DH → 0 | BR → TL diagonal |
| 2 | in: 1.0 → 1.08 | 0 → DW | 0 | L → R horizontal |
| 3 | out: 1.08 → 1.0 | DW → 0 | 0 | R → L horizontal |

---

## Why animated crop-x is safe for landscape in WASM

The portrait Ken Burns bug (animated `crop` failing with "Failed to configure input pad") occurred because **both `w` and `h` were changing every frame** — shrinking as the zoom-in progressed. FFmpeg reinitializes the filter graph whenever output dimensions change. During that reinitialization `t` evaluates to a garbage value, causing NaN in the expressions.

For landscape pan, only `x` changes. `w=1080` and `h=ih` are constants. The filter output is always the same size → **no reinitialization → `t` is always valid**.

Landscape input uses `-framerate 24 -loop 1 -t photoDuration`, so `t` goes from 0 to `photoDuration` seconds. The pan expressions below are safe to use.

---

## Task 1: Fix portrait Ken Burns — 4-corner cycling zoompan

**File:** `lib/ffmpeg-renderer.ts`, lines 204–224 (the `portraitFilter` function)

- [ ] **Step 1: Replace `portraitFilter` with the 4-corner implementation**

Find the function starting at line 204:
```ts
const portraitFilter = (i: number): string => {
```

Replace the **entire function** (lines 204–224) with:

```ts
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
```

- [ ] **Step 2: Commit**

```bash
git add lib/ffmpeg-renderer.ts
git commit -m "fix: 4-corner cycling portrait Ken Burns with decoupled zoompan expressions"
```

---

## Task 2: Fix landscape Ken Burns — alternating LTR/RTL animated crop-x

**File:** `lib/ffmpeg-renderer.ts`  
**Touches:** the `landscapeSeq` insertion point (after line 178) and `landscapeFilter` (lines 226–236)

- [ ] **Step 1: Add `landscapeSeq` after the `isLandscape` computation**

Find the closing of `isLandscape` (around line 178):
```ts
  )
)

  // ─── Ken Burns filters ────────────────────────────────────────────────────
```

Insert these lines **between** the closing `)` of `isLandscape` and the `// ─── Ken Burns filters` comment:

```ts
// Track each photo's position within the landscape-photo sequence (0 = first
// landscape photo, 1 = second, etc.) to alternate LTR/RTL pan independently
// of portrait photos.
let _lscapeCount = 0
const landscapeSeq = isLandscape.map(land => land ? _lscapeCount++ : -1)
```

- [ ] **Step 2: Replace `landscapeFilter` with the animated-x version**

Find the function at line 226:
```ts
const landscapeFilter = (_i: number): string => {
  // Static centre crop — animated x in crop= also fails in WASM.
  return (
    `[0:v]split=2[fg][bg];` +
    `[bg]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,` +
    `scale=68:120:flags=bilinear,scale=1080:1920:flags=bilinear,eq=brightness=-0.25[bgblur];` +
    `[fg]scale=${ZOOMED_W}:-2[fgbig];` +
    `[fgbig]crop=1080:ih:(iw-1080)/2:0[fgpan];` +
    `[bgblur][fgpan]overlay=0:(H-h)/2,format=yuv420p,setsar=1`
  )
}
```

Replace the **entire function** with:

```ts
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
```

- [ ] **Step 3: Commit**

```bash
git add lib/ffmpeg-renderer.ts
git commit -m "fix: alternating LTR/RTL animated crop-x for landscape Ken Burns"
```

---

## Task 3: Manual verification

No automated test suite covers FFmpeg WASM output — verification requires generating a real reel in the browser. Deploy to Vercel or run `npm run dev` locally and navigate to the generate page.

**Portrait checklist (generate a reel with 4+ portrait photos):**

- [ ] Photo 1 (i=0, i%4=0): zooms in + pans diagonally from top-left toward bottom-right. Motion visible from the very first frame.
- [ ] Photo 2 (i=1, i%4=1): zooms out + pans diagonally from bottom-right toward top-left.
- [ ] Photo 3 (i=2, i%4=2): zooms in + pans horizontally left to right.
- [ ] Photo 4 (i=3, i%4=3): zooms out + pans horizontally right to left.
- [ ] Photo 5 (i=4): same pattern as photo 1.
- [ ] No photo is static from frame 1 — every clip has visible motion immediately.

**Landscape checklist (generate a reel with 2+ landscape photos):**

- [ ] 1st landscape photo: foreground pans left → right across the blurred background.
- [ ] 2nd landscape photo: foreground pans right → left.
- [ ] 3rd landscape photo (if present): back to left → right.
- [ ] Blurred background is present on all landscape clips (unchanged).

**Error checklist:**

- [ ] No FFmpeg exit 1 errors. If one appears, open browser DevTools → Console and look for `[ffmpeg clip*]` log lines to see the actual FFmpeg error.
- [ ] If landscape animated crop-x fails ("Failed to configure input pad" on a landscape clip), the fallback is to revert `landscapeFilter` to the static center crop and open a new issue for a zoompan-based landscape solution. Portrait zoompan is unaffected.
