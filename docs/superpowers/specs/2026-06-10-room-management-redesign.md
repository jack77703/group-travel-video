# Room Management Redesign — Design Spec

**Date:** 2026-06-10
**Status:** Approved

---

## Overview

Two problems to fix together:

1. **Wrong identity on home page** — room cards show the member's own name, which is useless. Should show the room name (the event).
2. **Lobby inaccessible after generation** — status `done`/`generating` auto-redirects users out of the lobby forever. The lobby should handle all three room states so "Rejoin" always works.
3. **Lobby too long on mobile** — requires scrolling to reach the Generate button. Should fit one screen with the member list as an internal scroll area.

---

## Changes

### 1. `lib/session.ts` — add `roomName`

Add `roomName: string` to the `Session` interface. All `setSession()` callers must pass it.

### 2. `app/api/rooms/[code]/join/route.ts` — return room name

Add `name` to the room select query and return it in the response:

```ts
.select('id, name, status, max_photos_per_member, created_by_token')
// response:
return NextResponse.json({ member_id, session_token, name: member.name, room_name: room.name, max_photos_per_member })
```

### 3. Join page (`app/room/[code]/page.tsx`)

Read `data.room_name` from the join response and pass it to `setSession()`.

### 4. Create page (`app/create/page.tsx`)

The host already has the room name in the `name` state variable. Pass `roomName: name` to `setSession()`.

### 5. Home page (`app/page.tsx`) — room cards

**Before:**
```
[ Jack                    Rejoin → ] [ × ]
```

**After:**
```
[ Bali Trip 2026          Rejoin → ] [ × ]
  You joined as Jack
```

- Primary: `s.roomName` — bold white
- Secondary: `You joined as {s.memberName}` — small, dimmed
- No API calls; data comes from localStorage

### 6. Lobby page (`app/room/[code]/lobby/page.tsx`) — full redesign

#### Layout — fits one screen (no full-page scroll)

Use a fixed viewport layout: header + member list (internal scroll) + footer button. The member list is the only scrollable area.

```
┌─────────────────────────────────────┐  ← h-screen
│ ← Home              [Share]         │  ← fixed top bar (host: Share; member: nothing)
│                                     │
│ Bali Trip 2026                      │  ← room name (h1, smaller)
│ 3 / 8 members                       │
│─────────────────────────────────────│
│ [member list — flex-1, overflow-y]  │  ← scrolls internally if many members
│                                     │
│─────────────────────────────────────│
│ [primary action button]             │  ← fixed footer
└─────────────────────────────────────┘
```

Remove: `Room XXXXXX` code label, `New Room` pill button. The code is visible nowhere on this page.

Top bar: `←` (goes home) on the left · `Share` amber pill (host only, copies invite link) on the right.

#### Three room states

**open** (collecting uploads):
- Member list with upload status badges — unchanged from current
- Footer: "Generate Reel" button (host, disabled if zero uploads) OR "Waiting for the host…" text (member)

**generating** (reel is being built):
- Remove the auto-redirect to `/reel`. Stay on the lobby.
- Footer: small spinner + "Generating your reel…" text, no button
- Member list stays visible (read-only)

**done** (reel ready):
- Remove the auto-redirect to `/share`. Stay on the lobby.
- Footer: "Watch the Reel →" white button (all users, links to `/room/${code}/share`)
- Host gets a secondary text link below: "Generate Again" (calls reset API then navigates to `/generate`)
- Member list stays visible (read-only)

The realtime subscription keeps working — when status changes while you're in the lobby, the UI updates in place (no redirect).

---

## Out of Scope

- Status badge on home page cards (would require API call per room on load)
- Delete room from DB on × (separate feature, needs confirmation UI)
- Any changes to the upload, generate, or share pages
