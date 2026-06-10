# UX Polish & Share Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish the app's UX across five areas: clean up the home page, remove occasion, enforce required photo counts with a 20-member cap, lock the upload flow, and add a dedicated share screen with native + social share options.

**Architecture:** All changes are purely frontend/API layer — no Supabase schema migrations needed. The DB column `max_photos_per_member` stays as-is; only the UI label changes. The share page (`/room/[code]/share`) fetches the existing reel API to get the mp4_url, so no new API routes are needed. Social sharing uses navigator.share (native OS sheet on mobile) plus deep-link fallbacks for Threads, Twitter, and WhatsApp using the Creatomate CDN URL which is publicly accessible.

**Tech Stack:** Next.js 14 App Router, React, Tailwind CSS, Supabase, Creatomate CDN URLs, Web Share API.

---

## File Map

| File | Change |
|------|--------|
| `lib/session.ts` | Add `removeSession()` |
| `app/page.tsx` | Remove decorative card, add × remove-room button |
| `app/create/page.tsx` | Remove occasion field and state; rename label to "Required photos per person" |
| `app/api/rooms/route.ts` | Remove occasion from required fields and insert |
| `app/api/rooms/[code]/route.ts` | Remove occasion from SELECT |
| `app/api/rooms/[code]/join/route.ts` | Add 20-member hard cap |
| `app/room/[code]/lobby/page.tsx` | Show member count |
| `app/room/[code]/upload/page.tsx` | Remove skip button, enforce exact count |
| `app/room/[code]/reel/page.tsx` | Navigate to share page when done instead of showing inline buttons |
| `app/room/[code]/share/page.tsx` | Create new dedicated share page |

---

### Task 1: Add removeSession and clean up home page

Remove the decorative photo mockup card, and let users delete rooms from their "Your Rooms" list.

**Files:**
- Modify: `lib/session.ts`
- Modify: `app/page.tsx`

- [ ] **Step 1: Add `removeSession` to `lib/session.ts`**

Add after `setInitiatorToken`:

```typescript
export function removeSession(roomCode: string): void {
  localStorage.removeItem(`${KEY}_${roomCode}`)
  localStorage.removeItem(`${KEY}_${roomCode}_initiator`)
}
```

- [ ] **Step 2: Update `app/page.tsx` — remove the decorative card, add remove button**

Replace the entire file:

```tsx
'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import { listSessions, removeSession, Session } from '@/lib/session'

export default function Home() {
  const [sessions, setSessions] = useState<Session[]>([])

  useEffect(() => {
    setSessions(listSessions())
  }, [])

  function handleRemove(roomCode: string) {
    removeSession(roomCode)
    setSessions((prev) => prev.filter((s) => s.roomCode !== roomCode))
  }

  return (
    <main className="min-h-screen overflow-hidden bg-black px-6 text-white">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center py-12">
        <div className="relative">
          <div className="absolute -left-16 -top-20 h-48 w-48 rounded-full bg-amber-300/20 blur-3xl" />
          <div className="absolute -right-20 top-24 h-56 w-56 rounded-full bg-sky-400/20 blur-3xl" />

          <div className="relative space-y-10">
            <div className="space-y-5">
              <p className="inline-flex rounded-full border border-white/15 bg-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.28em] text-white/70">
                Private group recap
              </p>
              <div className="space-y-4">
                <h1 className="text-5xl font-black leading-[0.95] tracking-tight">
                  Surprise Reel
                </h1>
                <p className="text-lg leading-7 text-white/65">
                  Everyone uploads secretly. You hit generate. They&apos;re surprised.
                </p>
              </div>
            </div>

            {sessions.length > 0 && (
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/40">
                  Your rooms
                </p>
                {sessions.map((s) => (
                  <div
                    key={s.roomCode}
                    className="flex items-center gap-2"
                  >
                    <Link
                      href={`/room/${s.roomCode}/lobby`}
                      className="flex flex-1 items-center justify-between rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 transition hover:border-white/20 hover:bg-white/[0.09]"
                    >
                      <div>
                        <p className="font-mono text-sm font-bold tracking-widest text-amber-100">
                          {s.roomCode}
                        </p>
                        <p className="text-xs text-white/40">{s.memberName}</p>
                      </div>
                      <span className="text-xs text-white/30">Rejoin →</span>
                    </Link>
                    <button
                      type="button"
                      onClick={() => handleRemove(s.roomCode)}
                      className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl border border-white/10 text-white/30 transition hover:border-red-400/30 hover:text-red-300"
                      aria-label="Remove room"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            <Link
              href="/create"
              className="block w-full rounded-2xl bg-white px-5 py-4 text-center text-lg font-bold text-black transition hover:scale-[1.01] hover:bg-amber-100 active:scale-[0.99]"
            >
              Create a Reel Room
            </Link>
          </div>
        </div>
      </div>
    </main>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add lib/session.ts app/page.tsx
git commit -m "feat: add remove-room button and clean up home page"
git push origin main
```

- [ ] **Step 4: Verify**

Open https://group-travel-video.vercel.app/ after deploy. The decorative card is gone. If any rooms exist in localStorage, each shows a `×` button. Clicking `×` removes it from the list immediately.

---

### Task 2: Remove occasion from create flow

Occasion is stored in the DB but never used in the render or displayed after creation. Remove it from the form, the API validation, and the SELECT.

**Files:**
- Modify: `app/create/page.tsx`
- Modify: `app/api/rooms/route.ts`
- Modify: `app/api/rooms/[code]/route.ts`

- [ ] **Step 1: Update `app/create/page.tsx` — remove occasion**

Remove the `occasion` state and the whole occasion grid. Replace the full file:

```tsx
'use client'

import { useRouter } from 'next/navigation'
import { FormEvent, useState } from 'react'

import { setInitiatorToken, setSession } from '@/lib/session'

export default function CreatePage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [initiatorName, setInitiatorName] = useState('')
  const [requiredPhotos, setRequiredPhotos] = useState(3)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          max_photos_per_member: requiredPhotos,
        }),
      })
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error)
      }

      const joinRes = await fetch(`/api/rooms/${data.code}/join`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-initiator-token': data.created_by_token,
        },
        body: JSON.stringify({ name: initiatorName }),
      })
      const joinData = await joinRes.json()

      if (!joinRes.ok) {
        throw new Error(joinData.error)
      }

      setInitiatorToken(data.code, data.created_by_token)
      setSession(data.code, {
        token: joinData.session_token,
        roomCode: data.code,
        memberId: joinData.member_id,
        memberName: joinData.name,
      })
      router.push(`/room/${data.code}/upload`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-black px-6 py-8 text-white">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-md flex-col justify-center">
        <div className="space-y-8">
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-amber-200/80">
              Start the surprise
            </p>
            <h1 className="text-4xl font-black tracking-tight">Create a Reel Room</h1>
            <p className="text-sm leading-6 text-white/55">
              Name the moment, set how many photos each person must upload, then share the room.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="mb-2 block text-sm font-medium text-white/70">Room name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Bali Trip 2026"
                required
                className="w-full rounded-2xl border border-white/10 bg-white/[0.07] px-4 py-4 text-white outline-none transition placeholder:text-white/25 focus:border-amber-200 focus:ring-4 focus:ring-amber-200/10"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-white/70">Your name</label>
              <input
                value={initiatorName}
                onChange={(e) => setInitiatorName(e.target.value)}
                placeholder="e.g. Jack"
                required
                className="w-full rounded-2xl border border-white/10 bg-white/[0.07] px-4 py-4 text-white outline-none transition placeholder:text-white/25 focus:border-amber-200 focus:ring-4 focus:ring-amber-200/10"
              />
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/[0.05] p-4">
              <label className="mb-3 flex items-center justify-between text-sm font-medium text-white/70">
                <span>Required photos per person</span>
                <span className="rounded-full bg-white px-3 py-1 text-sm font-bold text-black">
                  {requiredPhotos}
                </span>
              </label>
              <input
                type="range"
                min={1}
                max={10}
                value={requiredPhotos}
                onChange={(e) => setRequiredPhotos(Number(e.target.value))}
                className="w-full accent-amber-200"
              />
              <p className="mt-2 text-xs text-white/35">
                Everyone must upload exactly {requiredPhotos} photo{requiredPhotos !== 1 ? 's' : ''} before you can generate the reel.
              </p>
            </div>

            {error && (
              <p className="rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading || !name.trim() || !initiatorName.trim()}
              className="w-full rounded-2xl bg-white px-5 py-4 text-lg font-bold text-black transition hover:scale-[1.01] hover:bg-amber-100 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {loading ? 'Creating...' : 'Create Room'}
            </button>
          </form>
        </div>
      </div>
    </main>
  )
}
```

- [ ] **Step 2: Update `app/api/rooms/route.ts` — remove occasion from validation and insert**

```typescript
import { NextRequest, NextResponse } from 'next/server'

import { createServerClient } from '@/lib/supabase-server'

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return code
}

export async function POST(request: NextRequest) {
  const { name, max_photos_per_member } = await request.json()

  if (!name || !max_photos_per_member) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const supabase = createServerClient()
  const code = generateCode()
  const created_by_token = crypto.randomUUID()

  const { data: room, error } = await supabase
    .from('rooms')
    .insert({ name, max_photos_per_member, code, created_by_token })
    .select('id, code, created_by_token')
    .single()

  if (error || !room) {
    return NextResponse.json({ error: 'Failed to create room' }, { status: 500 })
  }

  return NextResponse.json(room)
}
```

- [ ] **Step 3: Update `app/api/rooms/[code]/route.ts` — remove occasion from SELECT**

Change line:
```typescript
.select('id, code, name, occasion, status, max_photos_per_member')
```
To:
```typescript
.select('id, code, name, status, max_photos_per_member')
```

- [ ] **Step 4: Commit**

```bash
git add app/create/page.tsx app/api/rooms/route.ts app/api/rooms/\[code\]/route.ts
git commit -m "feat: remove occasion field, rename to required photos per person"
git push origin main
```

- [ ] **Step 5: Verify**

Open create page. Occasion grid is gone. Form has Room name, Your name, Required photos slider. Room creates successfully.

---

### Task 3: Enforce 20-member hard cap in join API + show count in lobby

**Files:**
- Modify: `app/api/rooms/[code]/join/route.ts`
- Modify: `app/room/[code]/lobby/page.tsx`

- [ ] **Step 1: Add member count cap to `app/api/rooms/[code]/join/route.ts`**

After the room lookup, add a member count check. Find the block where `member` is looked up and the room is validated (around lines 20–40 of the file), and add before the insert:

```typescript
  // Check member cap
  const { count: memberCount } = await supabase
    .from('members')
    .select('id', { count: 'exact', head: true })
    .eq('room_id', room.id)

  if ((memberCount ?? 0) >= 20) {
    return NextResponse.json({ error: 'Room is full (20 members max)' }, { status: 409 })
  }
```

Place this immediately before the `supabase.from('members').insert(...)` call.

- [ ] **Step 2: Show member count in lobby header — `app/room/[code]/lobby/page.tsx`**

Find the `<h1>` tag in the lobby page:
```tsx
<h1 className="text-4xl font-black tracking-tight">{room.name}</h1>
```

Replace with:
```tsx
<h1 className="text-4xl font-black tracking-tight">{room.name}</h1>
<p className="text-sm text-white/40">
  {room.members.length} member{room.members.length !== 1 ? 's' : ''} · up to 20
</p>
```

- [ ] **Step 3: Commit**

```bash
git add app/api/rooms/\[code\]/join/route.ts app/room/\[code\]/lobby/page.tsx
git commit -m "feat: enforce 20-member cap in join API, show member count in lobby"
git push origin main
```

- [ ] **Step 4: Verify**

Join a room 21 times (or test the API directly). The 21st join returns a 409 with "Room is full (20 members max)". Lobby shows "3 members · up to 20".

---

### Task 4: Upload page — enforce exact photo count, remove skip

The host has set a required count. Each person must hit that exact number before they can proceed to the lobby.

**Files:**
- Modify: `app/room/[code]/upload/page.tsx`

- [ ] **Step 1: Replace `app/room/[code]/upload/page.tsx`**

```tsx
'use client'

import { useParams, useRouter } from 'next/navigation'
import { ChangeEvent, useEffect, useRef, useState } from 'react'

import { getSession, Session } from '@/lib/session'

export default function UploadPage() {
  const router = useRouter()
  const params = useParams()
  const code = (params.code as string).toUpperCase()
  const [session, setSessionState] = useState<Session | null>(null)
  const [requiredPhotos, setRequiredPhotos] = useState(5)
  const [uploaded, setUploaded] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const storedSession = getSession(code)
    if (!storedSession) {
      router.replace(`/room/${code}`)
      return
    }

    setSessionState(storedSession)
    fetch(`/api/rooms/${code}`)
      .then((res) => res.json())
      .then((data) => {
        setRequiredPhotos(data.max_photos_per_member)
        const me = data.members?.find(
          (member: { id: string; photos_uploaded: number }) =>
            member.id === storedSession.memberId
        )
        if (me) setUploaded(me.photos_uploaded)
      })
      .catch(() => setError('Could not load room details'))
  }, [code, router])

  async function handleFiles(files: FileList | null) {
    if (!files || !session) return

    setError('')
    const slotsLeft = requiredPhotos - uploaded
    const toUpload = Array.from(files)
      .filter((file) => file.type.startsWith('image/'))
      .slice(0, slotsLeft)

    if (toUpload.length === 0) {
      setError(slotsLeft <= 0 ? 'All slots filled' : 'Choose image files to upload')
      return
    }

    setUploading(true)

    for (const file of toUpload) {
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

        if (!res.ok || !data.upload_url) {
          throw new Error(data.error ?? 'Could not create upload URL')
        }

        const uploadRes = await fetch(data.upload_url, {
          method: 'PUT',
          headers: { 'Content-Type': file.type },
          body: file,
        })

        if (!uploadRes.ok) throw new Error('Upload failed')

        setUploaded((prev) => prev + 1)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Upload failed')
      }
    }

    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const slotsLeft = Math.max(requiredPhotos - uploaded, 0)
  const isComplete = uploaded >= requiredPhotos

  return (
    <main className="min-h-screen bg-black px-6 py-8 text-white">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-md flex-col justify-center">
        <div className="space-y-8">
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-amber-200/80">
              Room {code}
            </p>
            <h1 className="text-4xl font-black tracking-tight">Your Photos</h1>
            <p className="text-sm leading-6 text-white/55">
              Upload exactly {requiredPhotos} photo{requiredPhotos !== 1 ? 's' : ''}. Nobody sees them until the reel reveal.
            </p>
          </div>

          <div className="rounded-[2rem] border border-white/10 bg-white/[0.06] p-5">
            <div className="mb-3 flex items-end justify-between">
              <div>
                <p className="text-sm text-white/50">Uploaded</p>
                <p className="text-3xl font-black">
                  {uploaded}
                  <span className="text-base font-semibold text-white/35"> / {requiredPhotos}</span>
                </p>
              </div>
              {isComplete && (
                <p className="rounded-full bg-emerald-300/15 px-3 py-1 text-sm font-bold text-emerald-200">
                  Done
                </p>
              )}
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-amber-200 transition-all"
                style={{ width: `${Math.min((uploaded / requiredPhotos) * 100, 100)}%` }}
              />
            </div>
          </div>

          {!isComplete && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="w-full rounded-[2rem] border-2 border-dashed border-white/20 bg-white/[0.04] px-5 py-12 text-center text-lg font-bold text-white/65 transition hover:border-amber-200/60 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {uploading ? 'Uploading...' : `Tap to add photos (${slotsLeft} left)`}
            </button>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e: ChangeEvent<HTMLInputElement>) => handleFiles(e.target.files)}
          />

          {error && (
            <p className="rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={() => router.push(`/room/${code}/lobby`)}
            disabled={!isComplete}
            className="w-full rounded-2xl bg-white px-5 py-4 text-lg font-bold text-black transition hover:scale-[1.01] hover:bg-amber-100 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-30"
          >
            Done — Go to Lobby
          </button>
        </div>
      </div>
    </main>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add app/room/\[code\]/upload/page.tsx
git commit -m "feat: enforce exact required photo count on upload, remove skip button"
git push origin main
```

- [ ] **Step 3: Verify**

Open the upload page. "Done — Go to Lobby" is greyed out. Upload photos one by one — button stays disabled until uploaded count matches required. Upload area disappears when all slots are filled. No skip button anywhere.

---

### Task 5: Dedicated share page after reel generation

When the reel finishes, navigate to `/room/[code]/share` which shows the video, a native share button, social media deep links, download, and a "Create Another Room" CTA.

**Files:**
- Modify: `app/room/[code]/reel/page.tsx`
- Create: `app/room/[code]/share/page.tsx`

- [ ] **Step 1: Update `app/room/[code]/reel/page.tsx` — navigate to share page when done**

Find the polling effect. Change the `done` handler from setting state to navigating:

```typescript
if (data.status === 'done' && data.mp4_url) {
  if (pollRef.current) clearInterval(pollRef.current)
  router.replace(`/room/${code}/share`)
}
```

The reel page now only shows the spinner/failed state. Add `useRouter` import if not present.

Full updated file:

```tsx
'use client'

import { useParams, useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

type ReelStatus = 'not_started' | 'processing' | 'done' | 'failed'

export default function ReelPage() {
  const router = useRouter()
  const params = useParams()
  const code = (params.code as string).toUpperCase()
  const [status, setStatus] = useState<ReelStatus>('processing')
  const [error, setError] = useState('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    async function poll() {
      try {
        const res = await fetch(`/api/rooms/${code}/reel`)
        const data = await res.json()

        if (!res.ok) throw new Error(data.error ?? 'Could not load reel')

        setStatus(data.status)

        if (data.status === 'done' && data.mp4_url) {
          if (pollRef.current) clearInterval(pollRef.current)
          router.replace(`/room/${code}/share`)
        } else if (data.status === 'failed') {
          if (pollRef.current) clearInterval(pollRef.current)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load reel')
        if (pollRef.current) clearInterval(pollRef.current)
      }
    }

    poll()
    pollRef.current = setInterval(poll, 5000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [code, router])

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-black px-6 text-white">
      <div className="w-full max-w-sm space-y-5 text-center">
        {status === 'failed' || error ? (
          <div className="rounded-[2rem] border border-red-400/20 bg-red-500/10 px-5 py-8">
            <p className="text-lg font-bold text-red-200">Generation failed</p>
            <p className="mt-2 text-sm text-red-100/70">
              {error || 'Go back and try again.'}
            </p>
          </div>
        ) : (
          <>
            <div className="mx-auto h-14 w-14 animate-spin rounded-full border-4 border-white border-t-transparent" />
            <div className="space-y-2">
              <h1 className="text-2xl font-black">Generating your reel...</h1>
              <p className="text-sm text-white/45">
                This usually takes about a minute. Keep this page open.
              </p>
            </div>
          </>
        )}
      </div>
    </main>
  )
}
```

- [ ] **Step 2: Create `app/room/[code]/share/page.tsx`**

```tsx
'use client'

import { useParams, useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

export default function SharePage() {
  const router = useRouter()
  const params = useParams()
  const code = (params.code as string).toUpperCase()
  const [mp4Url, setMp4Url] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [shareError, setShareError] = useState('')
  const [downloaded, setDownloaded] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    fetch(`/api/rooms/${code}/reel`)
      .then((r) => r.json())
      .then((data) => {
        if (data.mp4_url) setMp4Url(data.mp4_url)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [code])

  async function handleNativeShare() {
    if (!mp4Url) return
    setShareError('')

    if (navigator.share) {
      try {
        if (navigator.canShare?.({ url: mp4Url })) {
          await navigator.share({ url: mp4Url, title: 'Our Surprise Reel' })
          return
        }
        // Try to share as file on mobile
        const res = await fetch(mp4Url)
        const blob = await res.blob()
        const file = new File([blob], `surprise-reel-${code}.mp4`, { type: 'video/mp4' })
        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], title: 'Our Surprise Reel' })
          return
        }
        await navigator.share({ url: mp4Url, title: 'Our Surprise Reel' })
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          setShareError('Could not open share sheet.')
        }
      }
    } else {
      handleDownload()
    }
  }

  async function handleDownload() {
    if (!mp4Url) return
    const res = await fetch(mp4Url)
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `surprise-reel-${code}.mp4`
    link.click()
    URL.revokeObjectURL(url)
    setDownloaded(true)
  }

  function socialLink(platform: 'threads' | 'twitter' | 'whatsapp') {
    if (!mp4Url) return '#'
    const text = encodeURIComponent('Our surprise reel is here 🎬')
    const url = encodeURIComponent(mp4Url)
    if (platform === 'threads') return `https://www.threads.net/intent/post?text=${text}%20${url}`
    if (platform === 'twitter') return `https://twitter.com/intent/tweet?text=${text}&url=${url}`
    if (platform === 'whatsapp') return `https://wa.me/?text=${text}%20${url}`
    return '#'
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-white border-t-transparent" />
      </main>
    )
  }

  if (!mp4Url) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black px-6 text-white">
        <div className="text-center">
          <p className="text-white/50">Reel not found.</p>
          <button
            type="button"
            onClick={() => router.push('/')}
            className="mt-4 text-sm text-amber-200 underline"
          >
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
            src={mp4Url}
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

          <div className="grid grid-cols-3 gap-2">
            <a
              href={socialLink('threads')}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-3 text-sm font-semibold text-white transition hover:border-white/25 hover:bg-white/[0.1]"
            >
              Threads
            </a>
            <a
              href={socialLink('twitter')}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-3 text-sm font-semibold text-white transition hover:border-white/25 hover:bg-white/[0.1]"
            >
              Twitter
            </a>
            <a
              href={socialLink('whatsapp')}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-3 text-sm font-semibold text-white transition hover:border-white/25 hover:bg-white/[0.1]"
            >
              WhatsApp
            </a>
          </div>

          <button
            type="button"
            onClick={handleDownload}
            className="w-full rounded-2xl border border-white/10 bg-white/[0.06] px-5 py-4 text-lg font-bold text-white transition hover:border-white/25"
          >
            {downloaded ? 'Downloaded!' : 'Download MP4'}
          </button>

          {shareError && (
            <p className="text-center text-sm text-red-300">{shareError}</p>
          )}
        </div>

        <button
          type="button"
          onClick={() => router.push('/create')}
          className="w-full py-3 text-sm text-white/30 transition hover:text-white/60"
        >
          Create another room
        </button>
      </div>
    </main>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add app/room/\[code\]/reel/page.tsx app/room/\[code\]/share/page.tsx
git commit -m "feat: add dedicated share page with native share, Threads, Twitter, WhatsApp"
git push origin main
```

- [ ] **Step 4: Verify**

Generate a reel. Reel page shows spinner until done, then auto-navigates to `/room/CODE/share`. Share page shows video, Share button, three social grid buttons (Threads/Twitter/WhatsApp), Download button, and "Create another room" at the bottom. On mobile, Share opens the native OS share sheet. On desktop, Share falls back to download.

---

## Self-Review

**Spec coverage:**
1. ✅ Remove photo from home page — Task 1 removes decorative card
2. ✅ Remove rooms feature — Task 1 adds × button with `removeSession()`
3. ✅ Remove occasion — Task 2
4. ✅ Required photos (not max) label — Task 2 (slider label updated)
5. ✅ Hard max 10 in UI — Task 2 (slider max={10})
6. ✅ At least 1 — Task 2 (slider min={1})
7. ✅ 20-member cap — Task 3
8. ✅ Upload enforces exact count, no skip — Task 4
9. ✅ Share page with social media — Task 5
10. ✅ Jump to other page after generate — Task 5 (reel page navigates to /share)

**Placeholder scan:** No TBDs, no "add appropriate error handling" without code, no similar-to-above references.

**Type consistency:** `Session` type from `lib/session.ts` is used correctly in Task 1 and Task 4. `removeSession` defined in Task 1 Step 1 is used in Task 1 Step 2. `mp4Url` is `string | null` consistently in Task 5.
