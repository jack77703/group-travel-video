# User Flow Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the upload page for local preview, replace the generate page with mood/pace/animation controls, add a reset API for re-generation, update the share page with "Generate Again" + polling, and update the generate route for shuffle/captions/variable settings.

**Architecture:** Seven tasks in dependency order. Backend tasks (Music API, Reset API, Reel API, Generate route) first, then frontend (Upload, Generate page, Share page). Each task is independently committable and doesn't depend on later tasks.

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase Postgres + Storage, Creatomate SDK, Jamendo API, Tailwind CSS

---

## File Map

**Modified:**
- `app/api/music/search/route.ts` — replace `?q=` with `?mood=` + always instrumental
- `app/api/rooms/[code]/generate/route.ts` — accept `photo_duration`/`animation`, join photos+members, shuffle, per-photo caption
- `app/api/rooms/[code]/reel/route.ts` — return latest reel + `room_status`
- `app/api/webhook/creatomate/route.ts` — remove debug log line
- `app/room/[code]/upload/page.tsx` — local preview grid + "I'm ready" bulk upload
- `app/room/[code]/generate/page.tsx` — mood chips, track list, pace slider, animation picker
- `app/room/[code]/share/page.tsx` — stripped buttons, "Generate Again", polling

**Created:**
- `app/api/rooms/[code]/reset/route.ts` — sets room status back to `open`

---

### Task 1: Music API — mood-based endpoint

Replace free-text search with mood/tag filtering. Always instrumental only.

**Files:**
- Modify: `app/api/music/search/route.ts`

- [ ] **Step 1: Replace the route handler**

Replace the entire contents of `app/api/music/search/route.ts` with:

```typescript
import { NextRequest, NextResponse } from 'next/server'

const VALID_MOODS = ['ambient', 'epic', 'happy', 'chill', 'romantic', 'upbeat', 'dark', 'jazz', 'electronic']

export async function GET(request: NextRequest) {
  const mood = request.nextUrl.searchParams.get('mood') ?? ''

  const url = new URL('https://api.jamendo.com/v3.0/tracks/')
  url.searchParams.set('client_id', process.env.JAMENDO_CLIENT_ID!)
  url.searchParams.set('format', 'json')
  url.searchParams.set('limit', '10')
  url.searchParams.set('audioformat', 'mp32')
  url.searchParams.set('imagesize', '100')
  url.searchParams.set('vocalinstrumental', 'instrumental')
  url.searchParams.set('order', 'popularity_total')

  if (mood && VALID_MOODS.includes(mood)) {
    url.searchParams.set('tags', mood)
  }

  const res = await fetch(url.toString())
  if (!res.ok) {
    return NextResponse.json({ error: 'Music search failed' }, { status: 502 })
  }

  const data = await res.json()

  const tracks = (data.results ?? []).map((t: {
    id: string
    name: string
    artist_name: string
    duration: number
    audio: string
    image: string
  }) => ({
    id: t.id,
    name: t.name,
    artist: t.artist_name,
    duration: t.duration,
    url: t.audio,
    image: t.image,
  }))

  return NextResponse.json({ tracks })
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add app/api/music/search/route.ts
git commit -m "feat: music API — mood-based instrumental search"
```

---

### Task 2: Reset API

New `POST /api/rooms/[code]/reset` endpoint that reopens a room for regeneration. Requires the initiator token. Leaves the existing reel row untouched — the old `mp4_url` stays in DB so guests keep seeing the old video while the new one renders.

**Files:**
- Create: `app/api/rooms/[code]/reset/route.ts`

- [ ] **Step 1: Create the file**

```typescript
import { NextRequest, NextResponse } from 'next/server'

import { createServerClient } from '@/lib/supabase-server'

export async function POST(
  request: NextRequest,
  { params }: { params: { code: string } }
) {
  const initiator_token = request.headers.get('x-initiator-token')
  if (!initiator_token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServerClient()

  const { data: room } = await supabase
    .from('rooms')
    .select('id, created_by_token')
    .eq('code', params.code.toUpperCase())
    .single()

  if (!room) {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 })
  }
  if (room.created_by_token !== initiator_token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  await supabase
    .from('rooms')
    .update({ status: 'open' })
    .eq('id', room.id)

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add "app/api/rooms/[code]/reset/route.ts"
git commit -m "feat: reset API — reopen room for regeneration"
```

---

### Task 3: Reel API — latest reel + room_status

The current `.single()` call breaks when there are multiple reels (one per generation). Fix it to return the most recent reel. Also return `room_status` from the rooms table so the share page knows when to poll.

**Files:**
- Modify: `app/api/rooms/[code]/reel/route.ts`

- [ ] **Step 1: Replace the route**

Replace the entire contents of `app/api/rooms/[code]/reel/route.ts` with:

```typescript
import { NextRequest, NextResponse } from 'next/server'

import { createServerClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: NextRequest,
  { params }: { params: { code: string } }
) {
  const supabase = createServerClient()

  const { data: room } = await supabase
    .from('rooms')
    .select('id, status')
    .eq('code', params.code.toUpperCase())
    .single()

  if (!room) {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 })
  }

  const { data: reel } = await supabase
    .from('reels')
    .select('status, mp4_url')
    .eq('room_id', room.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!reel) {
    return NextResponse.json({ room_status: room.status, status: 'not_started', mp4_url: null })
  }

  return NextResponse.json({ room_status: room.status, status: reel.status, mp4_url: reel.mp4_url })
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add "app/api/rooms/[code]/reel/route.ts"
git commit -m "fix: reel API returns latest reel and room_status"
```

---

### Task 4: Generate route — shuffle, captions, variable settings

Accept `photo_duration` and `animation` from the request body. Join photos to members to get names. Shuffle photo order with Fisher-Yates. Add a per-photo text caption (member name, bottom-left). Apply the chosen animation to each image element. Also remove the debug log from the webhook.

**Files:**
- Modify: `app/api/rooms/[code]/generate/route.ts`
- Modify: `app/api/webhook/creatomate/route.ts`

- [ ] **Step 1: Remove the debug log from the webhook**

Open `app/api/webhook/creatomate/route.ts` and delete the line:

```typescript
console.log('[webhook] payload:', JSON.stringify({ render_id, status, url, raw: body }))
```

- [ ] **Step 2: Replace the generate route**

Replace the entire contents of `app/api/rooms/[code]/generate/route.ts` with:

```typescript
import { Client as CreatomateClient } from 'creatomate'
import { NextRequest, NextResponse } from 'next/server'

import { createServerClient } from '@/lib/supabase-server'

type PhotoRow = {
  storage_path: string
  members: { name: string } | null
}

function buildAnimations(type: string) {
  if (type === 'zoom-out') {
    return [{ type: 'scale', scope: 'element', easing: 'linear', start_scale: '110%', end_scale: '100%' }]
  }
  if (type === 'static') {
    return []
  }
  return [{ type: 'scale', scope: 'element', easing: 'linear', start_scale: '100%', end_scale: '110%' }]
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export async function POST(
  request: NextRequest,
  { params }: { params: { code: string } }
) {
  const initiator_token = request.headers.get('x-initiator-token')
  const { music_url, music_name, photo_duration = 2, animation = 'zoom-in' } = await request.json()

  if (!initiator_token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!music_url) {
    return NextResponse.json({ error: 'No music track selected' }, { status: 400 })
  }
  if (photo_duration < 1 || photo_duration > 3) {
    return NextResponse.json({ error: 'photo_duration must be between 1 and 3' }, { status: 400 })
  }

  const supabase = createServerClient()

  const { data: room } = await supabase
    .from('rooms')
    .select('id, status, created_by_token')
    .eq('code', params.code.toUpperCase())
    .single()

  if (!room) {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 })
  }
  if (room.created_by_token !== initiator_token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }
  if (room.status !== 'open') {
    return NextResponse.json({ error: 'Reel already generating or done' }, { status: 409 })
  }

  const { data: rawPhotos } = await supabase
    .from('photos')
    .select('storage_path, members(name)')
    .eq('room_id', room.id)

  if (!rawPhotos || rawPhotos.length === 0) {
    return NextResponse.json({ error: 'No photos uploaded' }, { status: 400 })
  }

  const photos = shuffle(rawPhotos as PhotoRow[])

  const photoItems: Array<{ url: string; memberName: string }> = []
  for (const photo of photos) {
    const { data } = await supabase.storage
      .from('photos')
      .createSignedUrl(photo.storage_path, 3600)
    if (data?.signedUrl) {
      photoItems.push({
        url: data.signedUrl,
        memberName: (photo.members as { name: string } | null)?.name ?? '',
      })
    }
  }

  const totalDuration = photo_duration * photoItems.length
  const animations = buildAnimations(animation)

  const creatomate = new CreatomateClient(process.env.CREATOMATE_API_KEY!)
  const renders = await creatomate.startRender({
    source: {
      output_format: 'mp4',
      width: 1080,
      height: 1920,
      fill_color: '#000000',
      elements: [
        {
          type: 'audio',
          source: music_url,
          duration: totalDuration,
          audio_fade_out: 2,
        },
        ...photoItems.flatMap(({ url, memberName }, i) => {
          const imageEl: Record<string, unknown> = {
            type: 'image',
            source: url,
            time: i * photo_duration,
            duration: photo_duration,
            fit: 'cover',
            ...(animations.length > 0 ? { animations } : {}),
          }
          const els: Record<string, unknown>[] = [imageEl]
          if (memberName) {
            els.push({
              type: 'text',
              text: memberName,
              time: i * photo_duration,
              duration: photo_duration,
              // bottom-left: element center at 28% x, 93% y; 56% wide covers left half
              x: '28%',
              y: '93%',
              width: '56%',
              x_alignment: '0%',
              font_size: 44,
              font_weight: '700',
              color: '#ffffff',
              shadow_color: 'rgba(0,0,0,0.75)',
              shadow_blur: 4,
            })
          }
          return els
        }),
      ],
    },
    webhookUrl: `${process.env.NEXT_PUBLIC_APP_URL}/api/webhook/creatomate`,
  })

  const render_id = renders[0].id

  await supabase
    .from('rooms')
    .update({ status: 'generating', music_genre: music_name ?? music_url })
    .eq('id', room.id)

  const { error: reelInsertError } = await supabase
    .from('reels')
    .insert({ room_id: room.id, render_id, status: 'processing' })

  if (reelInsertError) {
    console.error('[generate] reel insert failed:', reelInsertError)
    await supabase.from('rooms').update({ status: 'open' }).eq('id', room.id)
    return NextResponse.json({ error: 'Failed to start reel generation' }, { status: 500 })
  }

  return NextResponse.json({ render_id, status: 'processing' })
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add "app/api/rooms/[code]/generate/route.ts" app/api/webhook/creatomate/route.ts
git commit -m "feat: generate route — shuffle, member captions, variable duration/animation"
```

---

### Task 5: Upload page — local preview

Replace the current flow (file picked → immediately uploads) with a local preview grid where photos live in browser memory until "I'm ready" is tapped.

**Files:**
- Modify: `app/room/[code]/upload/page.tsx`

- [ ] **Step 1: Replace the upload page**

Replace the entire contents of `app/room/[code]/upload/page.tsx` with:

```tsx
'use client'

import { useParams, useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { getSession, Session } from '@/lib/session'

export default function UploadPage() {
  const router = useRouter()
  const params = useParams()
  const code = (params.code as string).toUpperCase()
  const [session, setSessionState] = useState<Session | null>(null)
  const [maxPhotos, setMaxPhotos] = useState(5)
  const [photos, setPhotos] = useState<File[]>([])
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null)
  const [failedIndex, setFailedIndex] = useState<number | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const addInputRef = useRef<HTMLInputElement>(null)
  const replaceInputRef = useRef<HTMLInputElement>(null)
  const replaceIndexRef = useRef<number>(-1)
  const previewUrls = useRef<Map<File, string>>(new Map())

  function getPreviewUrl(file: File): string {
    if (!previewUrls.current.has(file)) {
      previewUrls.current.set(file, URL.createObjectURL(file))
    }
    return previewUrls.current.get(file)!
  }

  useEffect(() => {
    return () => {
      previewUrls.current.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [])

  useEffect(() => {
    const storedSession = getSession(code)
    if (!storedSession) {
      router.replace(`/room/${code}`)
      return
    }
    setSessionState(storedSession)
    fetch(`/api/rooms/${code}`)
      .then((r) => r.json())
      .then((data) => setMaxPhotos(data.max_photos_per_member))
      .catch(() => setError('Could not load room details'))
  }, [code, router])

  function handleAddFiles(files: FileList | null) {
    if (!files) return
    const slotsLeft = maxPhotos - photos.length
    const incoming = Array.from(files)
      .filter((f) => f.type.startsWith('image/'))
      .slice(0, slotsLeft)
    setPhotos((prev) => [...prev, ...incoming])
  }

  function removePhoto(index: number) {
    setPhotos((prev) => prev.filter((_, i) => i !== index))
  }

  function openReplace(index: number) {
    replaceIndexRef.current = index
    replaceInputRef.current?.click()
  }

  function handleReplaceFile(files: FileList | null) {
    if (!files || files.length === 0) return
    const file = files[0]
    if (!file.type.startsWith('image/')) return
    const idx = replaceIndexRef.current
    setPhotos((prev) => {
      const next = [...prev]
      next[idx] = file
      return next
    })
    if (replaceInputRef.current) replaceInputRef.current.value = ''
  }

  async function handleReady() {
    if (!session || photos.length !== maxPhotos) return
    setUploading(true)
    setError('')
    setFailedIndex(null)

    for (let i = 0; i < photos.length; i++) {
      const file = photos[i]
      setUploadingIndex(i)
      try {
        const res = await fetch(`/api/rooms/${code}/photos`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-session-token': session.token,
          },
          body: JSON.stringify({ file_name: file.name, file_type: file.type }),
        })
        const data = await res.json()
        if (!res.ok || !data.upload_url) throw new Error(data.error ?? 'Could not create upload URL')

        const uploadRes = await fetch(data.upload_url, {
          method: 'PUT',
          headers: { 'Content-Type': file.type },
          body: file,
        })
        if (!uploadRes.ok) throw new Error('Upload failed')
      } catch (err) {
        setFailedIndex(i)
        setError(err instanceof Error ? err.message : 'Upload failed')
        setUploading(false)
        setUploadingIndex(null)
        return
      }
    }

    setUploadingIndex(null)
    setUploading(false)
    router.push(`/room/${code}/lobby`)
  }

  const atCap = photos.length >= maxPhotos
  const readyToUpload = photos.length === maxPhotos && !uploading

  return (
    <main className="min-h-screen bg-black px-6 py-8 text-white">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-md flex-col">
        <div className="space-y-8">
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-amber-200/80">
              Room {code}
            </p>
            <h1 className="text-4xl font-black tracking-tight">Your Photos</h1>
            <p className="text-sm leading-6 text-white/55">
              Add your favorite shots. Nobody else sees them before the reel reveal.
            </p>
          </div>

          <p className="text-sm text-white/40">
            {photos.length} / {maxPhotos} selected
          </p>

          {photos.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {photos.map((file, i) => (
                <div key={i} className="relative aspect-square">
                  <img
                    src={getPreviewUrl(file)}
                    alt=""
                    onClick={() => openReplace(i)}
                    className="h-full w-full cursor-pointer rounded-xl object-cover"
                  />
                  {uploadingIndex === i && (
                    <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/50">
                      <div className="h-6 w-6 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    </div>
                  )}
                  {failedIndex === i && (
                    <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-red-900/60">
                      <span className="text-xs font-bold text-red-200">!</span>
                    </div>
                  )}
                  {uploadingIndex !== i && (
                    <button
                      type="button"
                      onClick={() => removePhoto(i)}
                      className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white/80 text-xs leading-none hover:bg-black"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {!atCap && (
            <button
              type="button"
              onClick={() => addInputRef.current?.click()}
              disabled={uploading}
              className="w-full rounded-[2rem] border-2 border-dashed border-white/20 bg-white/[0.04] px-5 py-10 text-center text-base font-bold text-white/65 transition hover:border-amber-200/60 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              + Add photos ({maxPhotos - photos.length} left)
            </button>
          )}

          <input
            ref={addInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => handleAddFiles(e.target.files)}
          />
          <input
            ref={replaceInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => handleReplaceFile(e.target.files)}
          />

          {error && (
            <p className="rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {error}
            </p>
          )}
        </div>

        <div className="mt-auto pt-8">
          <button
            type="button"
            onClick={handleReady}
            disabled={!readyToUpload}
            className="w-full rounded-2xl bg-white px-5 py-4 text-lg font-bold text-black transition hover:scale-[1.01] hover:bg-amber-100 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-30"
          >
            {uploading ? 'Uploading...' : "I'm ready"}
          </button>
        </div>
      </div>
    </main>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add "app/room/[code]/upload/page.tsx"
git commit -m "feat: upload page — local preview grid, I'm ready bulk upload"
```

---

### Task 6: Generate page — mood chips, pace slider, animation picker

Replace the search-box UI with: mood chip grid (single select) → track list → pace slider → animation picker. Persist settings to `localStorage` so "Generate Again" pre-fills them.

**Files:**
- Modify: `app/room/[code]/generate/page.tsx`

- [ ] **Step 1: Replace the generate page**

Replace the entire contents of `app/room/[code]/generate/page.tsx` with:

```tsx
'use client'

import { useParams, useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { getInitiatorToken } from '@/lib/session'

type Track = {
  id: string
  name: string
  artist: string
  duration: number
  url: string
  image: string
}

type Animation = 'zoom-in' | 'zoom-out' | 'static'

const MOODS = [
  { label: 'Ambient', tag: 'ambient' },
  { label: 'Epic', tag: 'epic' },
  { label: 'Happy', tag: 'happy' },
  { label: 'Chill', tag: 'chill' },
  { label: 'Romantic', tag: 'romantic' },
  { label: 'Upbeat', tag: 'upbeat' },
  { label: 'Dark', tag: 'dark' },
  { label: 'Jazz', tag: 'jazz' },
  { label: 'Electronic', tag: 'electronic' },
]

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function loadSavedSettings(code: string) {
  try {
    const raw = localStorage.getItem(`reel_generate_settings_${code}`)
    return raw ? (JSON.parse(raw) as { mood: string; track: Track; pace: number; animation: Animation }) : null
  } catch {
    return null
  }
}

function saveSettings(code: string, s: { mood: string; track: Track; pace: number; animation: Animation }) {
  localStorage.setItem(`reel_generate_settings_${code}`, JSON.stringify(s))
}

export default function GeneratePage() {
  const router = useRouter()
  const params = useParams()
  const code = (params.code as string).toUpperCase()

  const [selectedMood, setSelectedMood] = useState<string | null>(null)
  const [tracks, setTracks] = useState<Track[]>([])
  const [fetchingTracks, setFetchingTracks] = useState(false)
  const [selected, setSelected] = useState<Track | null>(null)
  const [previewing, setPreviewing] = useState<string | null>(null)
  const [pace, setPace] = useState(2)
  const [animation, setAnimation] = useState<Animation>('zoom-in')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const audioRef = useRef<HTMLAudioElement | null>(null)
  // Track ID to pre-select once tracks load (used for Generate Again pre-fill)
  const pendingTrackIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!getInitiatorToken(code)) {
      router.replace(`/room/${code}/lobby`)
      return
    }
    const saved = loadSavedSettings(code)
    if (saved) {
      setPace(saved.pace ?? 2)
      setAnimation(saved.animation ?? 'zoom-in')
      if (saved.mood) {
        pendingTrackIdRef.current = saved.track?.id ?? null
        setSelectedMood(saved.mood)
      }
    }
  }, [code, router])

  useEffect(() => {
    if (!selectedMood) return
    setFetchingTracks(true)
    setTracks([])
    setSelected(null)
    fetch(`/api/music/search?mood=${selectedMood}`)
      .then((r) => r.json())
      .then((data) => {
        const fetched: Track[] = data.tracks ?? []
        setTracks(fetched)
        if (pendingTrackIdRef.current) {
          const found = fetched.find((t) => t.id === pendingTrackIdRef.current)
          setSelected(found ?? null)
          pendingTrackIdRef.current = null
        }
      })
      .catch(() => setTracks([]))
      .finally(() => setFetchingTracks(false))
  }, [selectedMood])

  useEffect(() => {
    return () => { audioRef.current?.pause() }
  }, [])

  function togglePreview(track: Track) {
    if (previewing === track.id) {
      audioRef.current?.pause()
      setPreviewing(null)
      return
    }
    audioRef.current?.pause()
    audioRef.current = new Audio(track.url)
    audioRef.current.play()
    audioRef.current.onended = () => setPreviewing(null)
    setPreviewing(track.id)
  }

  async function handleGenerate() {
    if (!selected) return
    const initiatorToken = getInitiatorToken(code)
    if (!initiatorToken) {
      router.replace(`/room/${code}/lobby`)
      return
    }
    setLoading(true)
    setError('')

    try {
      const res = await fetch(`/api/rooms/${code}/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-initiator-token': initiatorToken,
        },
        body: JSON.stringify({
          music_url: selected.url,
          music_name: `${selected.name} — ${selected.artist}`,
          photo_duration: pace,
          animation,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      if (selectedMood) {
        saveSettings(code, { mood: selectedMood, track: selected, pace, animation })
      }
      router.push(`/room/${code}/reel`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="h-screen overflow-hidden bg-black px-6 py-8 text-white">
      <div className="mx-auto flex h-full w-full max-w-md flex-col gap-5">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-amber-200/80">
            Room {code}
          </p>
          <h1 className="text-4xl font-black tracking-tight">Pick a vibe</h1>
        </div>

        {/* Mood chips */}
        <div className="flex flex-wrap gap-2">
          {MOODS.map(({ label, tag }) => (
            <button
              key={tag}
              type="button"
              onClick={() => setSelectedMood(tag)}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                selectedMood === tag
                  ? 'bg-amber-200 text-black'
                  : 'border border-white/15 bg-white/[0.06] text-white/70 hover:border-white/30 hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Track list */}
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
          {fetchingTracks && (
            <div className="flex justify-center py-6">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-white" />
            </div>
          )}
          {!fetchingTracks && !selectedMood && (
            <p className="py-8 text-center text-sm text-white/30">Select a vibe above</p>
          )}
          {!fetchingTracks && selectedMood && tracks.length === 0 && (
            <p className="py-8 text-center text-sm text-white/30">No tracks found</p>
          )}
          {tracks.map((track) => {
            const isSelected = selected?.id === track.id
            const isPreviewing = previewing === track.id
            return (
              <div
                key={track.id}
                onClick={() => setSelected(track)}
                className={`flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 transition ${
                  isSelected
                    ? 'border-amber-200/60 bg-amber-200/10'
                    : 'border-white/10 bg-white/[0.04] hover:border-white/20'
                }`}
              >
                {track.image ? (
                  <img src={track.image} alt="" className="h-10 w-10 flex-shrink-0 rounded-lg object-cover" />
                ) : (
                  <div className="h-10 w-10 flex-shrink-0 rounded-lg bg-white/10" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold leading-tight">{track.name}</p>
                  <p className="truncate text-xs text-white/45">
                    {track.artist} · {formatDuration(track.duration)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); togglePreview(track) }}
                  className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
                >
                  {isPreviewing ? '■' : '▶'}
                </button>
              </div>
            )
          })}
        </div>

        {/* Pace slider */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-white/70">Pace</span>
            <span className="rounded-full bg-white px-3 py-0.5 text-sm font-bold text-black">{pace}s</span>
          </div>
          <input
            type="range"
            min={1}
            max={3}
            step={1}
            value={pace}
            onChange={(e) => setPace(Number(e.target.value))}
            className="w-full accent-amber-200"
          />
          <div className="mt-1 flex justify-between text-xs text-white/30">
            <span>Fast</span>
            <span>Slow</span>
          </div>
        </div>

        {/* Animation picker */}
        <div className="grid grid-cols-3 gap-2">
          {(['zoom-in', 'zoom-out', 'static'] as Animation[]).map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => setAnimation(a)}
              className={`rounded-2xl border py-3 text-sm font-semibold transition ${
                animation === a
                  ? 'border-amber-200/60 bg-amber-200/10 text-amber-200'
                  : 'border-white/10 bg-white/[0.04] text-white/50 hover:border-white/20 hover:text-white/80'
              }`}
            >
              {a === 'zoom-in' ? 'Zoom In' : a === 'zoom-out' ? 'Zoom Out' : 'Static'}
            </button>
          ))}
        </div>

        {error && (
          <p className="rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={handleGenerate}
          disabled={!selected || loading}
          className="w-full rounded-2xl bg-white px-5 py-4 text-lg font-bold text-black transition hover:scale-[1.01] hover:bg-amber-100 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? 'Starting generation...' : 'Generate Reel'}
        </button>
      </div>
    </main>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add "app/room/[code]/generate/page.tsx"
git commit -m "feat: generate page — mood chips, track list, pace slider, animation picker"
```

---

### Task 7: Share page — stripped + Generate Again + polling

Remove Threads/Twitter/WhatsApp grid and "Create another room". Rename "Download MP4" to "Download". Add "Generate Again" text link for host only. Poll the reel API while room is generating so guests see the new reel automatically when it's ready. The old video keeps playing until the new URL arrives.

**Files:**
- Modify: `app/room/[code]/share/page.tsx`

- [ ] **Step 1: Replace the share page**

Replace the entire contents of `app/room/[code]/share/page.tsx` with:

```tsx
'use client'

import { useParams, useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { getInitiatorToken } from '@/lib/session'

export default function SharePage() {
  const router = useRouter()
  const params = useParams()
  const code = (params.code as string).toUpperCase()
  const [displayedUrl, setDisplayedUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [shareError, setShareError] = useState('')
  const [downloaded, setDownloaded] = useState(false)
  const [resetting, setResetting] = useState(false)
  const isInitiator = !!getInitiatorToken(code)
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    let cancelled = false

    async function poll() {
      try {
        const res = await fetch(`/api/rooms/${code}/reel`)
        const data = await res.json()
        if (cancelled) return

        // Always take a real URL when we get one (keeps old video during regeneration)
        if (data.mp4_url) setDisplayedUrl(data.mp4_url)
        setLoading(false)

        // Room is done — stop polling
        if (data.room_status === 'done') return

        // Room is generating — wait 5s and check again
        await new Promise<void>((resolve) => setTimeout(resolve, 5000))
        if (!cancelled) poll()
      } catch {
        if (!cancelled) setLoading(false)
      }
    }

    poll()
    return () => { cancelled = true }
  }, [code])

  async function handleNativeShare() {
    if (!displayedUrl) return
    setShareError('')
    if (navigator.share) {
      try {
        if (navigator.canShare?.({ url: displayedUrl })) {
          await navigator.share({ url: displayedUrl, title: 'Our Surprise Reel' })
          return
        }
        const res = await fetch(displayedUrl)
        const blob = await res.blob()
        const file = new File([blob], `surprise-reel-${code}.mp4`, { type: 'video/mp4' })
        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], title: 'Our Surprise Reel' })
          return
        }
        await navigator.share({ url: displayedUrl, title: 'Our Surprise Reel' })
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          setShareError('Could not open share sheet.')
        }
      }
    } else {
      await handleDownload()
    }
  }

  async function handleDownload() {
    if (!displayedUrl) return
    const res = await fetch(displayedUrl)
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `surprise-reel-${code}.mp4`
    link.click()
    URL.revokeObjectURL(url)
    setDownloaded(true)
  }

  async function handleGenerateAgain() {
    const initiatorToken = getInitiatorToken(code)
    if (!initiatorToken) return
    setResetting(true)
    try {
      await fetch(`/api/rooms/${code}/reset`, {
        method: 'POST',
        headers: { 'x-initiator-token': initiatorToken },
      })
      router.push(`/room/${code}/generate`)
    } catch {
      setResetting(false)
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-white border-t-transparent" />
      </main>
    )
  }

  if (!displayedUrl) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black px-6 text-white">
        <div className="text-center">
          <p className="text-white/50">Reel not found.</p>
          <button type="button" onClick={() => router.push('/')} className="mt-4 text-sm text-amber-200 underline">
            Go home
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-black px-6 py-8 text-white">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-md flex-col gap-6">
        <div className="space-y-1 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-amber-200/80">
            Room {code}
          </p>
          <h1 className="text-4xl font-black tracking-tight">The reveal is ready</h1>
        </div>

        <div className="rounded-[2rem] border border-white/10 bg-white/[0.06] p-3 shadow-2xl shadow-black/40">
          <video
            ref={videoRef}
            src={displayedUrl}
            controls
            autoPlay
            playsInline
            className="aspect-[9/16] w-full rounded-[1.5rem] bg-black object-cover"
          />
        </div>

        <div className="space-y-3">
          <button
            type="button"
            onClick={handleNativeShare}
            className="w-full rounded-2xl bg-white px-5 py-4 text-lg font-bold text-black transition hover:scale-[1.01] hover:bg-amber-100 active:scale-[0.99]"
          >
            Share
          </button>

          <button
            type="button"
            onClick={handleDownload}
            className="w-full rounded-2xl border border-white/10 bg-white/[0.06] px-5 py-4 text-lg font-bold text-white transition hover:border-white/25"
          >
            {downloaded ? 'Downloaded!' : 'Download'}
          </button>

          {shareError && (
            <p className="text-center text-sm text-red-300">{shareError}</p>
          )}
        </div>

        {isInitiator && (
          <button
            type="button"
            onClick={handleGenerateAgain}
            disabled={resetting}
            className="w-full py-3 text-sm text-white/30 transition hover:text-white/60 disabled:opacity-40"
          >
            {resetting ? 'Resetting...' : 'Generate Again'}
          </button>
        )}
      </div>
    </main>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Build check**

Run: `npm run build`
Expected: build completes with no errors

- [ ] **Step 4: Commit**

```bash
git add "app/room/[code]/share/page.tsx"
git commit -m "feat: share page — stripped buttons, Generate Again, reel polling"
```

---

## Notes for the implementer

**Creatomate caption positioning:** The text element coordinates (`x: '28%', y: '93%'`) are approximate. If the caption appears misaligned in a test render, adjust `y` upward (e.g. `'90%'`) to move it away from the bottom edge, or change `x` to shift it left/right. Creatomate positions elements from their center point by default.

**Jamendo instrumental filter:** The `vocalinstrumental=instrumental` filter is a Jamendo API parameter — it returns tracks with no vocals. Combined with the `tags` parameter, results are mood-appropriate instrumental tracks only.

**Multiple reels:** After regeneration, there will be two reel rows in the `reels` table for the same room. The reel API now fetches the most recent one (`order created_at desc limit 1`), so this is intentional and handled.
