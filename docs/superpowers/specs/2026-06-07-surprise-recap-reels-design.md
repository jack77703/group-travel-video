# Surprise Recap Reels — Design Spec

**Date:** 2026-06-07  
**Project:** group-travel-video  
**Status:** Approved

---

## Overview

A mobile-first web app where a group of people secretly upload photos, and an initiator generates a surprise video reel for everyone to watch together. Works for any occasion — trips, weddings, birthdays, company events.

**Core experience:**
1. Initiator creates a Room and shares a link
2. Members join by entering their name
3. Each member uploads their photos privately (others cannot see them)
4. Everyone can see the member list and who has uploaded
5. Initiator picks music genre/track and hits "Generate"
6. A video reel (MP4) is auto-generated and revealed to all members
7. Members watch in-app and download to share on social media

---

## Stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 14 (App Router), Tailwind CSS |
| Backend | Next.js API Routes |
| Database + Auth | Supabase (Postgres + Realtime) |
| File Storage | Supabase Storage |
| Video Generation | Creatomate API |
| Future iOS | React Native (shared Supabase + API backend) |

---

## Database Schema

```sql
rooms
  id                     uuid primary key
  code                   text unique          -- short slug used in URLs
  name                   text                 -- e.g. "Bali Trip 2026"
  occasion               text                 -- birthday, trip, wedding, etc.
  status                 text                 -- open | generating | done
  max_photos_per_member  int                  -- set by initiator (1–10)
  music_genre            text                 -- set before generation
  created_by_token       text                 -- initiator's session token
  created_at             timestamptz

members
  id                     uuid primary key
  room_id                uuid references rooms
  name                   text
  session_token          text unique
  session_token_expires_at timestamptz          -- 30 days from joined_at
  photos_uploaded        int default 0
  joined_at              timestamptz

photos
  id                     uuid primary key
  room_id                uuid references rooms
  member_id              uuid references members
  storage_path           text                 -- path in Supabase Storage
  display_order          int                  -- ordered by uploaded_at within member
  uploaded_at            timestamptz

reels
  id                     uuid primary key
  room_id                uuid references rooms unique
  mp4_url                text
  status                 text                 -- pending | processing | done | failed
  created_at             timestamptz
```

---

## Supabase Storage Buckets

| Bucket | Access | Contents |
|---|---|---|
| `photos` | Private (signed URLs, 1hr expiry) | Member-uploaded photos |
| `reels` | Public | Generated MP4 files |

---

## API Routes

```
POST /api/rooms                    Create room, return code + share link
GET  /api/rooms/[code]             Get room status + member list (names + upload status)
POST /api/rooms/[code]/join        Enter name, receive session token
POST /api/rooms/[code]/photos      Get signed upload URL from Supabase Storage
POST /api/rooms/[code]/generate    Initiator triggers reel generation (calls Creatomate)
GET  /api/rooms/[code]/reel        Poll reel status / return MP4 url when done
POST /api/webhook/creatomate       Creatomate callback — stores MP4 url, sets room to done
```

---

## Pages

```
/                            Landing page — hero + "Create a Reel Room" CTA
/create                      Initiator setup form
/room/[code]                 Member join page (enter name)
/room/[code]/upload          Member's private upload screen
/room/[code]/lobby           Waiting room — member list + upload status
/room/[code]/generate        Initiator-only: pick music, trigger generation
/room/[code]/reel            Reveal screen — video player + download + share
```

### Screen Details

**`/create`**
- Room name, occasion type selector
- Max photos per member (slider, 1–10)
- On submit: creates room, shows shareable link + QR code

**`/room/[code]`**
- Enter your name to join
- If name already taken in room, prompt to choose another

**`/room/[code]/upload`**
- Photo picker (mobile camera or library)
- Shows `X of N slots used`
- Photos upload immediately on select
- Members can replace their own photos but cannot see others'

**`/room/[code]/lobby`**
- Live member list: name + ✓ (uploaded) or ○ (pending)
- Powered by Supabase Realtime
- Initiator sees "Generate Reel" button once ≥1 member has uploaded
- Regular members see a waiting message

**`/room/[code]/generate`** _(initiator only)_
- Music genre picker (e.g. upbeat, cinematic, chill)
- Optional: specific track selection
- "Generate" button → triggers Creatomate API call

**`/room/[code]/reel`**
- Inline MP4 player
- Download button (saves to camera roll on mobile)
- Native share button (mobile share sheet → Instagram, TikTok, etc.)

---

## Auth & Session Strategy

No login required. Fully anonymous and frictionless.

- On join: server generates a `session_token` (UUID), returned to client and stored in `localStorage`
- Token sent in request headers on every subsequent API call
- Server identifies the user and their room by this token
- Token expiry: **30 days** server-side
- Initiator's `created_by_token` is checked server-side before allowing Generate or room management actions
- After reel is revealed (room status = `done`), all valid room session tokens can access the MP4

**Security:**
- Photo signed URLs expire after 1 hour — raw storage paths are useless after expiry
- Generate endpoint validates `created_by_token` — members cannot trigger generation
- Photos are stored under `photos/{room_id}/{member_id}/` — no cross-member path guessing

---

## Video Generation Flow (Creatomate)

1. Initiator hits Generate → `POST /api/rooms/[code]/generate`
2. Server fetches all photo signed URLs for the room (ordered by `display_order`)
3. Server calls Creatomate API with photos + selected music
4. Room status set to `generating`
5. Creatomate calls back a webhook (`/api/webhook/creatomate`) when render is complete
6. Webhook stores MP4 URL in `reels`, updates room status to `done`
7. Supabase Realtime pushes status change to all clients in the lobby → auto-redirect to `/reel`

---

## Future iOS App

- React Native app consuming the same Supabase backend and API routes
- Native camera/photo picker integration
- Native share sheet for viral distribution
- No backend changes required — API is already mobile-ready

---

## Out of Scope (v1)

- User accounts / login
- Multiple reels per room
- Video uploads (photos only)
- Custom music upload (genre/preset selection only)
- Reel editing after generation
