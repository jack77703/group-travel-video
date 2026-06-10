# Room Management Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show room name (not member name) on home page cards, make the lobby fit one mobile screen without full-page scrolling, and fix the lobby so it handles all three room states (open / generating / done) without auto-redirecting users out.

**Architecture:** Four files grow the session data layer (Session type, join API, join page, create page). Then the home page reads the new field. Finally the lobby page is rewritten with a fixed-viewport layout and three-state footer that replaces all auto-redirects.

**Tech Stack:** Next.js 14 App Router, TypeScript, Tailwind CSS, Supabase Realtime, localStorage session via `lib/session.ts`

---

## File Map

**Modified:**
- `lib/session.ts` — add `roomName` field to `Session` interface
- `app/api/rooms/[code]/join/route.ts` — select and return `room.name`
- `app/room/[code]/page.tsx` — store `roomName` from join API response
- `app/create/page.tsx` — store `roomName` from the form input
- `app/page.tsx` — show `roomName` + "You joined as {memberName}" on cards
- `app/room/[code]/lobby/page.tsx` — fixed-height viewport layout, three-state footer, no auto-redirects

---

### Task 1: Add `roomName` to the Session type

**Files:**
- Modify: `lib/session.ts`

- [ ] **Step 1: Add `roomName` to the interface**

Replace the entire `Session` interface in `lib/session.ts`:

```typescript
export interface Session {
  token: string
  roomCode: string
  memberId: string
  memberName: string
  roomName: string
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: errors in `app/room/[code]/page.tsx` and `app/create/page.tsx` because they call `setSession()` without `roomName` — that's correct, those get fixed in Tasks 2 and 3.

- [ ] **Step 3: Commit**

```bash
git add lib/session.ts
git commit -m "feat: add roomName to Session type"
```

---

### Task 2: Return room name from the join API

**Files:**
- Modify: `app/api/rooms/[code]/join/route.ts`

- [ ] **Step 1: Add `name` to the room select**

In `app/api/rooms/[code]/join/route.ts`, find the line:

```typescript
  const { data: room } = await supabase
    .from('rooms')
    .select('id, status, max_photos_per_member, created_by_token')
    .eq('code', params.code.toUpperCase())
    .single()
```

Replace with:

```typescript
  const { data: room } = await supabase
    .from('rooms')
    .select('id, name, status, max_photos_per_member, created_by_token')
    .eq('code', params.code.toUpperCase())
    .single()
```

- [ ] **Step 2: Include `room_name` in the response**

Find the final `return NextResponse.json(...)`:

```typescript
  return NextResponse.json({
    member_id: member.id,
    session_token,
    name: member.name,
    max_photos_per_member: room.max_photos_per_member,
  })
```

Replace with:

```typescript
  return NextResponse.json({
    member_id: member.id,
    session_token,
    name: member.name,
    room_name: room.name,
    max_photos_per_member: room.max_photos_per_member,
  })
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: same errors as Task 1 (callers still not updated) — no new errors.

- [ ] **Step 4: Commit**

```bash
git add "app/api/rooms/[code]/join/route.ts"
git commit -m "feat: return room_name from join API"
```

---

### Task 3: Store roomName in the join page

**Files:**
- Modify: `app/room/[code]/page.tsx`

- [ ] **Step 1: Read `room_name` from the response and pass to `setSession`**

In `app/room/[code]/page.tsx`, find:

```typescript
      setSession(code, {
        token: data.session_token,
        roomCode: code,
        memberId: data.member_id,
        memberName: data.name,
      })
```

Replace with:

```typescript
      setSession(code, {
        token: data.session_token,
        roomCode: code,
        memberId: data.member_id,
        memberName: data.name,
        roomName: data.room_name,
      })
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: only the `app/create/page.tsx` error remains.

- [ ] **Step 3: Commit**

```bash
git add "app/room/[code]/page.tsx"
git commit -m "feat: store roomName in session on join"
```

---

### Task 4: Store roomName in the create page

**Files:**
- Modify: `app/create/page.tsx`

- [ ] **Step 1: Pass `roomName` to `setSession`**

In `app/create/page.tsx`, find:

```typescript
      setSession(data.code, {
        token: joinData.session_token,
        roomCode: data.code,
        memberId: joinData.member_id,
        memberName: joinData.name,
      })
```

Replace with:

```typescript
      setSession(data.code, {
        token: joinData.session_token,
        roomCode: data.code,
        memberId: joinData.member_id,
        memberName: joinData.name,
        roomName: name,
      })
```

Note: `name` is the existing state variable that holds the room name the host typed into the form.

- [ ] **Step 2: Type-check — must be clean now**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add app/create/page.tsx
git commit -m "feat: store roomName in session on create"
```

---

### Task 5: Update home page room cards

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Show room name as primary, member name as secondary**

In `app/page.tsx`, find the card inner div:

```tsx
                      <div>
                        <p className="text-sm font-bold text-white">{s.memberName}</p>
                      </div>
```

Replace with:

```tsx
                      <div>
                        <p className="text-sm font-bold text-white">{s.roomName}</p>
                        <p className="text-xs text-white/40">You joined as {s.memberName}</p>
                      </div>
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Build check**

Run: `npm run build`
Expected: build completes with no errors

- [ ] **Step 4: Commit**

```bash
git add app/page.tsx
git commit -m "feat: show room name on home page cards"
```

---

### Task 6: Rewrite the lobby page

**Files:**
- Modify: `app/room/[code]/lobby/page.tsx`

This is the largest change. The full file is replaced. Key behaviours:

- Fixed-height viewport (`h-screen flex-col`) — member list is the only scroll area (`min-h-0 flex-1 overflow-y-auto`)
- Top bar: `← Home` left, `Share` amber pill right (host only, copies invite link)
- Room name as `h2` (smaller than before to save vertical space)
- Member count below room name
- Member list in the scrollable middle section
- Footer: three states — open / generating / done
- **No auto-redirects** — realtime updates change `room.status` in state; the footer reacts in place
- "Generate Again" in the done state (host only): calls reset API, navigates to `/generate`

- [ ] **Step 1: Replace the full file**

Replace the entire contents of `app/room/[code]/lobby/page.tsx` with:

```tsx
'use client'

import { RealtimeChannel } from '@supabase/supabase-js'
import { useParams, useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'

import { getInitiatorToken } from '@/lib/session'
import { getSupabaseClient } from '@/lib/supabase-client'
import type { MemberPublic, RoomPublic } from '@/lib/types'

export default function LobbyPage() {
  const router = useRouter()
  const params = useParams()
  const code = (params.code as string).toUpperCase()
  const [room, setRoom] = useState<RoomPublic | null>(null)
  const [isInitiator, setIsInitiator] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [resetting, setResetting] = useState(false)

  const loadRoom = useCallback(async () => {
    try {
      const res = await fetch(`/api/rooms/${code}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Could not load room')
      setRoom(data)
      setLoading(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load room')
      setLoading(false)
    }
  }, [code])

  useEffect(() => {
    let channel: RealtimeChannel | null = null
    let cancelled = false

    setIsInitiator(!!getInitiatorToken(code))

    async function subscribeToLobby() {
      await loadRoom()

      const res = await fetch(`/api/rooms/${code}`)
      const data: RoomPublic = await res.json()
      if (cancelled || !data.id) return

      const supabase = getSupabaseClient()
      channel = supabase
        .channel(`lobby-${data.id}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'members', filter: `room_id=eq.${data.id}` },
          () => loadRoom()
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${data.id}` },
          () => loadRoom()
        )
        .subscribe()
    }

    subscribeToLobby()

    return () => {
      cancelled = true
      if (channel) getSupabaseClient().removeChannel(channel)
    }
  }, [code, loadRoom])

  function copyInvite() {
    const url = `${window.location.origin}/room/${code}`
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
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

  if (loading || !room) {
    return (
      <main className="flex h-screen items-center justify-center bg-black px-6 text-white">
        <p className="text-white/45">Loading...</p>
      </main>
    )
  }

  if (error) {
    return (
      <main className="flex h-screen items-center justify-center bg-black px-6 text-white">
        <p className="rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </p>
      </main>
    )
  }

  const maxMembers = Math.min(20, Math.floor(60 / room.max_photos_per_member))
  const allZero = room.members.every((m: MemberPublic) => m.photos_uploaded === 0)

  return (
    <main className="flex h-screen flex-col bg-black px-6 py-8 text-white">
      {/* Top bar */}
      <div className="flex flex-shrink-0 items-center justify-between">
        <button
          type="button"
          onClick={() => router.push('/')}
          className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/50 transition hover:border-white/30 hover:text-white/80"
        >
          ← Home
        </button>
        {isInitiator && (
          <button
            type="button"
            onClick={copyInvite}
            className="rounded-full border border-amber-200/30 bg-amber-200/10 px-3 py-1 text-xs font-semibold text-amber-200 transition hover:bg-amber-200/20"
          >
            {copied ? 'Copied!' : 'Share invite'}
          </button>
        )}
      </div>

      {/* Room info */}
      <div className="mt-5 flex-shrink-0">
        <h1 className="text-3xl font-black tracking-tight">{room.name}</h1>
        <p className="mt-1 text-sm text-white/40">
          {room.members.length} / {maxMembers} members
        </p>
      </div>

      {/* Member list — only this area scrolls */}
      <div className="mt-5 min-h-0 flex-1 space-y-2 overflow-y-auto">
        {room.members.map((member: MemberPublic) => {
          const hasUploaded = member.photos_uploaded > 0
          return (
            <div
              key={member.id}
              className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3"
            >
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-semibold">{member.name}</p>
                  {member.is_initiator && (
                    <span className="rounded-full bg-amber-200/15 px-2 py-0.5 text-xs font-semibold text-amber-200">
                      Host
                    </span>
                  )}
                </div>
                <p className="text-xs text-white/40">
                  {member.photos_uploaded} photo{member.photos_uploaded === 1 ? '' : 's'}
                </p>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-xs font-bold ${
                  hasUploaded
                    ? 'bg-emerald-300/15 text-emerald-200'
                    : 'bg-white/10 text-white/40'
                }`}
              >
                {hasUploaded ? 'uploaded' : 'waiting'}
              </span>
            </div>
          )
        })}
      </div>

      {/* Footer — three states */}
      <div className="mt-5 flex-shrink-0 space-y-3">
        {room.status === 'open' && isInitiator && (
          <button
            type="button"
            onClick={() => router.push(`/room/${code}/generate`)}
            disabled={allZero}
            className="w-full rounded-2xl bg-white px-5 py-4 text-lg font-bold text-black transition hover:scale-[1.01] hover:bg-amber-100 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-30"
          >
            Generate Reel
          </button>
        )}

        {room.status === 'open' && !isInitiator && (
          <p className="py-3 text-center text-sm text-white/40">
            Waiting for the host to generate the reel...
          </p>
        )}

        {room.status === 'generating' && (
          <div className="flex items-center justify-center gap-3 py-3">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-white" />
            <p className="text-sm text-white/60">Generating your reel...</p>
          </div>
        )}

        {room.status === 'done' && (
          <>
            <button
              type="button"
              onClick={() => router.push(`/room/${code}/share`)}
              className="w-full rounded-2xl bg-white px-5 py-4 text-lg font-bold text-black transition hover:scale-[1.01] hover:bg-amber-100 active:scale-[0.99]"
            >
              Watch the Reel →
            </button>
            {isInitiator && (
              <button
                type="button"
                onClick={handleGenerateAgain}
                disabled={resetting}
                className="w-full py-2 text-sm text-white/30 transition hover:text-white/60 disabled:opacity-40"
              >
                {resetting ? 'Resetting...' : 'Generate Again'}
              </button>
            )}
          </>
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
git add "app/room/[code]/lobby/page.tsx"
git commit -m "feat: redesign lobby — fixed viewport, three states, no auto-redirect"
```

- [ ] **Step 5: Push**

```bash
git push
```

---

## Self-Review

**Spec coverage:**
- ✅ `roomName` added to Session type (Task 1)
- ✅ Join API returns `room_name` (Task 2)
- ✅ Join page stores `roomName` (Task 3)
- ✅ Create page stores `roomName` (Task 4)
- ✅ Home cards show room name + "You joined as …" (Task 5)
- ✅ Lobby fixed-height viewport with internal scroll (Task 6)
- ✅ Lobby `open` state (Task 6)
- ✅ Lobby `generating` state — no redirect (Task 6)
- ✅ Lobby `done` state — Watch Reel + Generate Again (Task 6)
- ✅ Room code removed from lobby header (Task 6)
- ✅ Nav simplified to ← Home + Share (Task 6)

**Placeholder scan:** None found.

**Type consistency:** `roomName` used consistently across all tasks. `room_name` is the API wire format, `roomName` is the TypeScript field — correctly mapped in Tasks 3 and 4.
