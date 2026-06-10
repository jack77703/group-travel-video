# User Flow & Reel Customization Design

**Date:** 2026-06-10
**Status:** Approved

---

## Overview

This spec covers three interrelated improvements to the Surprise Recap Reels app:
1. A redesigned upload page with local preview before committing to Supabase
2. A redesigned generate page with mood-based music browsing and reel style controls
3. A regenerate flow so the host can remake the reel if unsatisfied

---

## Full User Flow

### Host

```
Home
  → Create (room name, your name, required photos per person)
  → Upload (local preview → "I'm ready" → lobby)
  → Lobby (watch members join + upload status)
  → Generate (pick mood → select track → set pace → set animation → Generate)
  → Reel (spinner → auto-navigates to share when done)
  → Share (watch, Share, Download, Generate Again)
       ↑ Generate Again loops back to Generate page with settings pre-filled
```

### Guest

```
Join link → Enter name
  → Upload (same flow as host)
  → Lobby (wait for host)
  → Share (watch, Share, Download)
```

---

## Page Designs

### Upload Page

**Goal:** Let users preview and curate photos locally before anything touches Supabase.

**Flow:**
1. Page loads showing current upload count (may be > 0 if rejoining)
2. Tap "Add photos" → native file picker opens (multi-select, images only)
3. Selected photos appear as thumbnails in a grid — nothing uploaded yet
4. Each thumbnail has:
   - **× button** → removes that photo from selection, slot disappears
   - **Tap the photo itself** → opens file picker for that single slot, replaces just that photo
5. `+ Add more` button is visible only when `selected < required`. Hidden at cap.
6. Counter shows `N / required selected`
7. `I'm ready` button is disabled until `selected === required`
8. Tap `I'm ready`:
   - Uploads all photos to Supabase sequentially
   - Each thumbnail shows a spinner overlay during its upload
   - On completion → navigate to lobby automatically
   - On partial failure → show error inline on the failed thumbnail, allow retry

**Key rule:** Photos live in browser memory (`File` objects) until `I'm ready` is tapped. No Supabase call happens before that.

---

### Generate Page

**Goal:** Host picks music by mood, sets pace and animation style before generating.

**Layout (top to bottom):**

```
1. Pick a vibe         ← mood chip grid (single select)
2. Track list          ← 5–10 tracks for selected mood, with preview
3. Pace slider         ← 1s to 3s, default 2s
4. Animation picker    ← Zoom In | Zoom Out | Static (3-button toggle)
5. Generate Reel       ← disabled until a track is selected
```

**Mood chips (single select):**
Ambient · Epic · Happy · Chill · Romantic · Upbeat · Dark · Jazz · Electronic

Tapping a mood fetches tracks from Jamendo filtered by that tag, always instrumental only. Previous mood selection is remembered if the host navigates back.

**Track list:**
Shows track name, artist, duration. Tap to select, play button to preview. Selected track is highlighted. Only one track selected at a time.

**Pace slider:**
- Range: 1–3 seconds per photo
- Default: 2s
- Label: "Slow ←——→ Fast" with current value shown
- Sets `photo_duration` sent to the generate API

**Animation picker:**
- Three buttons: Zoom In / Zoom Out / Static
- Default: Zoom In
- Sets `animation` sent to the generate API

**On regenerate:** All fields (selected mood, selected track, pace, animation) are pre-filled from the previous generation. Host only changes what they want.

---

### Share Page

**Layout:**
```
Video player (autoplay)
[ Share ]               ← primary, full width, native OS share sheet
[ Download ]            ← secondary
[ Generate Again ]      ← text link style, host only (invisible to guests)
```

Threads / Twitter / WhatsApp buttons removed. "Create another room" removed.

**Generate Again (host only):**
- Visible only if `getInitiatorToken(code)` returns a value
- Styled as a subtle text link, not a primary button
- Tapping it: calls `POST /api/rooms/[code]/reset`, then navigates to the generate page

**Guest experience during regeneration:**
- Share page polls `/api/rooms/[code]/reel` every 5 seconds in the background
- While room is `generating`: old video keeps playing, no visible indicator
- When new reel is `done`: video `src` updates automatically, no page refresh needed

---

## Regenerate Flow

### Reset API: `POST /api/rooms/[code]/reset`

**Auth:** Requires `x-initiator-token` header. Returns 403 if token doesn't match.

**What it does:**
1. Sets `rooms.status` back to `'open'` so the generate route passes its existing status check
2. Leaves the reel row untouched — `mp4_url` stays in DB so guests keep seeing the old video

The generate route immediately sets `rooms.status = 'generating'` when it starts, so the window where status is `'open'` is milliseconds. New members cannot sneak in during this window in practice, and the member cap already blocks them anyway.

For the old reel: the share page caches the last known `mp4_url` in component state and keeps showing it even while the new render runs. When the webhook updates the reel row with a new `mp4_url`, the polling picks it up and swaps the video src.

**Share page polling logic:**
```
- On mount: fetch reel, store mp4_url in state
- If room.status === 'generating': start polling every 5s
- On each poll: if new mp4_url differs from current → update video src
- If room.status === 'done' and mp4_url unchanged: stop polling
```

---

## Music API Change

**Current:** Jamendo search by artist/track name — returns unfamiliar indie artists, feels broken.

**New:** Browse by mood/genre, always instrumental only.

**API endpoint change:** `GET /api/music/search?mood=chill` (replaces `?q=...`)

The Jamendo API supports filtering by tags (`tags=chill`) and by `vocalinstrumental=instrumental`. This gives a curated set of tracks per mood without requiring the user to know any artist names.

**Mood → Jamendo tag mapping:**
| UI Label | Jamendo tag |
|---|---|
| Ambient | ambient |
| Epic | epic |
| Happy | happy |
| Chill | chill |
| Romantic | romantic |
| Upbeat | upbeat |
| Dark | dark |
| Jazz | jazz |
| Electronic | electronic |

---

## Data Flow Summary

### New fields sent to `POST /api/rooms/[code]/generate`:
```json
{
  "music_url": "...",
  "music_name": "...",
  "photo_duration": 2,
  "animation": "zoom-in"
}
```

### New API endpoint:
```
POST /api/rooms/[code]/reset
Headers: x-initiator-token
Response: { ok: true }
```

### Existing generate route changes:
- Accept `photo_duration` and `animation` from body
- Fetch photos with member names (join to members table)
- Shuffle photos randomly before building Creatomate elements
- Add per-photo text caption (member name, bottom-left corner, subtle styling)
- Apply animation type to each image element
- `photo_duration` replaces the hardcoded `PHOTO_DURATION` constant

---

## What Stays the Same

- Create page: room name, your name, required photos slider — no changes
- Lobby page: member list, host/guest display, generate button — no changes
- Reel page: spinner, auto-navigate to share on done — no changes
- Join page: enter name flow — no changes
- All API auth (session tokens, initiator tokens) — no changes

---

## Out of Scope

- Transition between photos (dropped — adds complexity, low visual payoff at 1–3s per photo)
- Multiple mood selection (start with single, can add later)
- BPM-based auto duration (Jamendo BPM field unreliable, approximation not worth the UX complexity)
- Old reel history / retrieval (one active reel per room, always latest)
- Social share deep links (Threads/Twitter/WhatsApp removed from share page)
