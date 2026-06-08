# Surprise Recap Reels — Spec & Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a mobile-first web app where group members secretly upload photos and an initiator generates a surprise MP4 reel revealed to everyone.

**Architecture:** Next.js 14 App Router for frontend and API routes; Supabase for Postgres, Realtime, and file storage; Creatomate API for server-side video generation delivered via webhook; anonymous session tokens stored in localStorage for identity.

**Tech Stack:** Next.js 14, TypeScript, Tailwind CSS, `@supabase/supabase-js`, `creatomate`

---

## Product Overview

A mobile-first web app for any group occasion (trips, birthdays, weddings, company events).

**Core experience:**
1. Initiator creates a Room and shares a link
2. Members join by entering their name — everyone can see who's in the room
3. Each member uploads their own photos privately (others cannot see them)
4. Initiator sees upload progress (names + whether each person uploaded, not the photos)
5. Initiator picks a music genre and hits "Generate"
6. Creatomate renders an MP4 slideshow — revealed to all members as a surprise
7. Members watch in-app and download to share on Instagram, TikTok, etc.

**Key constraints:**
- No login required — anonymous session tokens in localStorage, expire after 30 days
- Initiator is identified by a `created_by_token` saved in localStorage at room creation
- Only the initiator can trigger generation
- Photos are stored privately (signed URLs, 1hr expiry) — never visible to other members
- After reel is done, all members can access the MP4

**User flows:**
```
Initiator: / → /create → /room/[code]/lobby → /room/[code]/generate → /room/[code]/reel
Member:    /room/[code] → /room/[code]/upload → /room/[code]/lobby → /room/[code]/reel
```

---

## File Map

| File | Purpose |
|---|---|
| `lib/types.ts` | Shared TypeScript interfaces |
| `lib/supabase-server.ts` | Server-side Supabase client (service role key) |
| `lib/supabase-client.ts` | Browser Supabase client (anon key, used for Realtime) |
| `lib/session.ts` | localStorage session token read/write helpers |
| `lib/music.ts` | Genre → music track URL mapping |
| `app/page.tsx` | Landing page |
| `app/create/page.tsx` | Create room form |
| `app/room/[code]/page.tsx` | Join room — enter name |
| `app/room/[code]/upload/page.tsx` | Photo upload screen |
| `app/room/[code]/lobby/page.tsx` | Waiting room with live member list |
| `app/room/[code]/generate/page.tsx` | Music picker + generate button (initiator only) |
| `app/room/[code]/reel/page.tsx` | Reel reveal — video player + download |
| `app/api/rooms/route.ts` | POST: create room |
| `app/api/rooms/[code]/route.ts` | GET: room info + member list |
| `app/api/rooms/[code]/join/route.ts` | POST: join room, receive session token |
| `app/api/rooms/[code]/photos/route.ts` | POST: get signed upload URL |
| `app/api/rooms/[code]/generate/route.ts` | POST: trigger Creatomate render |
| `app/api/rooms/[code]/reel/route.ts` | GET: poll reel status |
| `app/api/webhook/creatomate/route.ts` | POST: Creatomate callback — store MP4 url |
| `supabase/schema.sql` | Database schema (run once in Supabase dashboard) |

---

## Task 1: Install dependencies and configure environment

**Files:**
- Modify: `package.json`
- Create: `.env.local`
- Create: `.env.example`
- Create: `.gitignore` (ensure `.env.local` is listed)

- [ ] **Step 1: Install packages**

```bash
cd /Users/jack/Github/group-travel-video
npm install @supabase/supabase-js creatomate
```

Expected: packages added, `package-lock.json` updated.

- [ ] **Step 2: Create a Supabase project**

Go to https://supabase.com → New project → after it provisions, go to **Settings → API** and copy:
- Project URL
- `anon` public key
- `service_role` secret key

- [ ] **Step 3: Sign up for Creatomate**

Go to https://creatomate.com → sign up (free tier available) → **Settings → API Key** → copy key.

- [ ] **Step 4: Create `.env.local`**

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
CREATOMATE_API_KEY=your-creatomate-api-key
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

- [ ] **Step 5: Create `.env.example`** (safe to commit)

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
CREATOMATE_API_KEY=
NEXT_PUBLIC_APP_URL=
```

- [ ] **Step 6: Ensure `.env.local` is in `.gitignore`**

Open `.gitignore` (create if missing) and confirm it contains:
```
.env.local
```

- [ ] **Step 7: Commit**

```bash
git add .env.example package.json package-lock.json .gitignore
git commit -m "feat: add dependencies and env config"
```

---

## Task 2: Supabase database schema and storage

**Files:**
- Create: `supabase/schema.sql`

- [ ] **Step 1: Create `supabase/schema.sql`**

```sql
create table rooms (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  occasion text not null,
  status text not null default 'open',
  max_photos_per_member int not null default 5,
  music_genre text,
  created_by_token text not null,
  created_at timestamptz default now()
);

create table members (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references rooms(id) on delete cascade,
  name text not null,
  session_token text unique not null,
  session_token_expires_at timestamptz not null,
  photos_uploaded int not null default 0,
  joined_at timestamptz default now()
);

create table photos (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references rooms(id) on delete cascade,
  member_id uuid references members(id) on delete cascade,
  storage_path text not null,
  display_order int not null,
  uploaded_at timestamptz default now()
);

create table reels (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references rooms(id) on delete cascade unique,
  render_id text,
  mp4_url text,
  status text not null default 'pending',
  created_at timestamptz default now()
);

-- Enable Realtime on rooms and members tables
alter publication supabase_realtime add table rooms;
alter publication supabase_realtime add table members;
```

- [ ] **Step 2: Run schema in Supabase**

In Supabase dashboard → **SQL Editor** → paste the full contents of `supabase/schema.sql` → Run.

Verify: go to **Table Editor** and confirm `rooms`, `members`, `photos`, `reels` all exist.

- [ ] **Step 3: Create storage buckets**

In Supabase dashboard → **Storage** → **New bucket**:
1. Name: `photos` — toggle **Private ON**
2. Name: `reels` — toggle **Private OFF** (public)

- [ ] **Step 4: Add storage policy for photos bucket**

In Storage → `photos` bucket → **Policies** → **New policy** → For full customization, paste:

```sql
create policy "Allow upload" on storage.objects
  for insert with check (bucket_id = 'photos');

create policy "Allow read" on storage.objects
  for select using (bucket_id = 'photos');
```

- [ ] **Step 5: Enable Realtime in dashboard**

In Supabase dashboard → **Database → Replication** → confirm `rooms` and `members` are toggled ON under supabase_realtime.

- [ ] **Step 6: Commit**

```bash
git add supabase/schema.sql
git commit -m "feat: database schema and storage setup"
```

---

## Task 3: Shared lib files

**Files:**
- Create: `lib/types.ts`
- Create: `lib/supabase-server.ts`
- Create: `lib/supabase-client.ts`
- Create: `lib/session.ts`
- Create: `lib/music.ts`

- [ ] **Step 1: Create `lib/types.ts`**

```typescript
export interface Room {
  id: string
  code: string
  name: string
  occasion: string
  status: 'open' | 'generating' | 'done'
  max_photos_per_member: number
  music_genre: string | null
  created_by_token: string
  created_at: string
}

export interface Member {
  id: string
  room_id: string
  name: string
  session_token: string
  session_token_expires_at: string
  photos_uploaded: number
  joined_at: string
}

export interface Photo {
  id: string
  room_id: string
  member_id: string
  storage_path: string
  display_order: number
  uploaded_at: string
}

export interface Reel {
  id: string
  room_id: string
  render_id: string | null
  mp4_url: string | null
  status: 'pending' | 'processing' | 'done' | 'failed'
  created_at: string
}

export interface MemberPublic {
  id: string
  name: string
  photos_uploaded: number
}

export interface RoomPublic {
  id: string
  code: string
  name: string
  occasion: string
  status: Room['status']
  max_photos_per_member: number
  members: MemberPublic[]
}
```

- [ ] **Step 2: Create `lib/supabase-server.ts`**

```typescript
import { createClient } from '@supabase/supabase-js'

export function createServerClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}
```

- [ ] **Step 3: Create `lib/supabase-client.ts`**

```typescript
import { createClient, SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | null = null

export function getSupabaseClient(): SupabaseClient {
  if (!client) {
    client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
  }
  return client
}
```

- [ ] **Step 4: Create `lib/session.ts`**

```typescript
const KEY = 'reel_session'

export interface Session {
  token: string
  roomCode: string
  memberId: string
  memberName: string
}

export function getSession(roomCode: string): Session | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(`${KEY}_${roomCode}`)
    return raw ? (JSON.parse(raw) as Session) : null
  } catch {
    return null
  }
}

export function setSession(roomCode: string, session: Session): void {
  localStorage.setItem(`${KEY}_${roomCode}`, JSON.stringify(session))
}

export function getInitiatorToken(roomCode: string): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(`${KEY}_${roomCode}_initiator`)
}

export function setInitiatorToken(roomCode: string, token: string): void {
  localStorage.setItem(`${KEY}_${roomCode}_initiator`, token)
}
```

- [ ] **Step 5: Create `lib/music.ts`**

```typescript
export const MUSIC_GENRES = {
  upbeat: {
    label: 'Upbeat',
    description: 'Energetic and fun',
    url: 'https://cdn.pixabay.com/audio/2024/03/04/audio_d1b5d81a6e.mp3',
  },
  cinematic: {
    label: 'Cinematic',
    description: 'Epic and emotional',
    url: 'https://cdn.pixabay.com/audio/2023/10/30/audio_b09c0a1234.mp3',
  },
  chill: {
    label: 'Chill',
    description: 'Relaxed and dreamy',
    url: 'https://cdn.pixabay.com/audio/2024/01/15/audio_a1b2c3d4e5.mp3',
  },
} as const

export type MusicGenre = keyof typeof MUSIC_GENRES
```

> **Note:** Replace the `url` values with real licensed tracks. Go to https://pixabay.com/music, find a track, right-click the audio player → Copy audio address. All Pixabay music is free for commercial use.

- [ ] **Step 6: Commit**

```bash
git add lib/
git commit -m "feat: shared types, Supabase clients, session helpers, music config"
```

---

## Task 4: API — Create room

**Files:**
- Create: `app/api/rooms/route.ts`

- [ ] **Step 1: Create `app/api/rooms/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { randomBytes } from 'crypto'

function generateRoomCode(): string {
  return randomBytes(3).toString('hex').toUpperCase()
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { name, occasion, max_photos_per_member } = body

  if (!name || !occasion || !max_photos_per_member) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }
  if (max_photos_per_member < 1 || max_photos_per_member > 10) {
    return NextResponse.json({ error: 'max_photos_per_member must be 1–10' }, { status: 400 })
  }

  const supabase = createServerClient()
  const created_by_token = crypto.randomUUID()
  let code = generateRoomCode()

  for (let i = 0; i < 5; i++) {
    const { data: existing } = await supabase
      .from('rooms').select('id').eq('code', code).single()
    if (!existing) break
    code = generateRoomCode()
  }

  const { data, error } = await supabase
    .from('rooms')
    .insert({ name, occasion, max_photos_per_member, code, created_by_token })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: 'Failed to create room' }, { status: 500 })
  }

  return NextResponse.json({
    code: data.code,
    created_by_token,
    share_url: `${process.env.NEXT_PUBLIC_APP_URL}/room/${data.code}`,
  })
}
```

- [ ] **Step 2: Start dev server and test**

```bash
npm run dev
```

```bash
curl -X POST http://localhost:3000/api/rooms \
  -H "Content-Type: application/json" \
  -d '{"name":"Bali Trip","occasion":"trip","max_photos_per_member":5}'
```

Expected:
```json
{"code":"ABC123","created_by_token":"...uuid...","share_url":"http://localhost:3000/room/ABC123"}
```

- [ ] **Step 3: Commit**

```bash
git add app/api/rooms/route.ts
git commit -m "feat: POST /api/rooms — create room"
```

---

## Task 5: API — Get room and join room

**Files:**
- Create: `app/api/rooms/[code]/route.ts`
- Create: `app/api/rooms/[code]/join/route.ts`

- [ ] **Step 1: Create `app/api/rooms/[code]/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

export async function GET(
  _request: NextRequest,
  { params }: { params: { code: string } }
) {
  const supabase = createServerClient()

  const { data: room, error } = await supabase
    .from('rooms')
    .select('id, code, name, occasion, status, max_photos_per_member')
    .eq('code', params.code.toUpperCase())
    .single()

  if (error || !room) {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 })
  }

  const { data: members } = await supabase
    .from('members')
    .select('id, name, photos_uploaded')
    .eq('room_id', room.id)
    .order('joined_at', { ascending: true })

  return NextResponse.json({ ...room, members: members ?? [] })
}
```

- [ ] **Step 2: Create `app/api/rooms/[code]/join/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

export async function POST(
  request: NextRequest,
  { params }: { params: { code: string } }
) {
  const { name } = await request.json()
  if (!name?.trim()) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  }

  const supabase = createServerClient()

  const { data: room } = await supabase
    .from('rooms')
    .select('id, status, max_photos_per_member')
    .eq('code', params.code.toUpperCase())
    .single()

  if (!room) {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 })
  }
  if (room.status !== 'open') {
    return NextResponse.json({ error: 'Room is no longer accepting members' }, { status: 409 })
  }

  const { data: existing } = await supabase
    .from('members')
    .select('id')
    .eq('room_id', room.id)
    .ilike('name', name.trim())
    .single()

  if (existing) {
    return NextResponse.json({ error: 'Name already taken in this room' }, { status: 409 })
  }

  const session_token = crypto.randomUUID()
  const session_token_expires_at = new Date(
    Date.now() + 30 * 24 * 60 * 60 * 1000
  ).toISOString()

  const { data: member, error } = await supabase
    .from('members')
    .insert({ room_id: room.id, name: name.trim(), session_token, session_token_expires_at })
    .select()
    .single()

  if (error || !member) {
    return NextResponse.json({ error: 'Failed to join room' }, { status: 500 })
  }

  return NextResponse.json({
    member_id: member.id,
    session_token,
    name: member.name,
    max_photos_per_member: room.max_photos_per_member,
  })
}
```

- [ ] **Step 3: Test**

```bash
# Use the code from Task 4 test
curl http://localhost:3000/api/rooms/ABC123
curl -X POST http://localhost:3000/api/rooms/ABC123/join \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice"}'
```

Expected join response: `{"member_id":"...","session_token":"...","name":"Alice","max_photos_per_member":5}`

- [ ] **Step 4: Commit**

```bash
git add app/api/rooms/[code]/route.ts app/api/rooms/[code]/join/route.ts
git commit -m "feat: GET /api/rooms/[code] and POST join"
```

---

## Task 6: API — Photo signed upload URL

**Files:**
- Create: `app/api/rooms/[code]/photos/route.ts`

- [ ] **Step 1: Create `app/api/rooms/[code]/photos/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

export async function POST(
  request: NextRequest,
  { params }: { params: { code: string } }
) {
  const session_token = request.headers.get('x-session-token')
  const { file_name, file_type } = await request.json()

  if (!session_token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServerClient()

  const { data: member } = await supabase
    .from('members')
    .select('id, room_id, photos_uploaded, session_token_expires_at')
    .eq('session_token', session_token)
    .single()

  if (!member) {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
  }
  if (new Date(member.session_token_expires_at) < new Date()) {
    return NextResponse.json({ error: 'Session expired' }, { status: 401 })
  }

  const { data: room } = await supabase
    .from('rooms')
    .select('id, status, max_photos_per_member')
    .eq('id', member.room_id)
    .eq('code', params.code.toUpperCase())
    .single()

  if (!room || room.status !== 'open') {
    return NextResponse.json({ error: 'Room not found or closed' }, { status: 404 })
  }
  if (member.photos_uploaded >= room.max_photos_per_member) {
    return NextResponse.json({ error: 'Photo limit reached' }, { status: 409 })
  }

  const { count } = await supabase
    .from('photos')
    .select('id', { count: 'exact', head: true })
    .eq('member_id', member.id)

  const display_order = (count ?? 0) + 1
  const storage_path = `${room.id}/${member.id}/${Date.now()}_${file_name}`

  const { data: uploadData, error: uploadError } = await supabase.storage
    .from('photos')
    .createSignedUploadUrl(storage_path)

  if (uploadError || !uploadData) {
    return NextResponse.json({ error: 'Failed to create upload URL' }, { status: 500 })
  }

  await supabase.from('photos').insert({
    room_id: room.id,
    member_id: member.id,
    storage_path,
    display_order,
  })

  await supabase
    .from('members')
    .update({ photos_uploaded: member.photos_uploaded + 1 })
    .eq('id', member.id)

  return NextResponse.json({ upload_url: uploadData.signedUrl, path: storage_path })
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/rooms/[code]/photos/route.ts
git commit -m "feat: POST /api/rooms/[code]/photos — signed upload URL"
```

---

## Task 7: API — Generate reel, webhook, and poll

**Files:**
- Create: `app/api/rooms/[code]/generate/route.ts`
- Create: `app/api/rooms/[code]/reel/route.ts`
- Create: `app/api/webhook/creatomate/route.ts`

- [ ] **Step 1: Create `app/api/rooms/[code]/generate/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { Client as CreatomateClient } from 'creatomate'
import { MUSIC_GENRES, MusicGenre } from '@/lib/music'

export async function POST(
  request: NextRequest,
  { params }: { params: { code: string } }
) {
  const initiator_token = request.headers.get('x-initiator-token')
  const { music_genre } = await request.json()

  if (!initiator_token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!music_genre || !(music_genre in MUSIC_GENRES)) {
    return NextResponse.json({ error: 'Invalid music genre' }, { status: 400 })
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

  const { data: photos } = await supabase
    .from('photos')
    .select('storage_path, display_order')
    .eq('room_id', room.id)
    .order('display_order', { ascending: true })

  if (!photos || photos.length === 0) {
    return NextResponse.json({ error: 'No photos uploaded' }, { status: 400 })
  }

  const photoUrls: string[] = []
  for (const photo of photos) {
    const { data } = await supabase.storage
      .from('photos')
      .createSignedUrl(photo.storage_path, 3600)
    if (data?.signedUrl) photoUrls.push(data.signedUrl)
  }

  const musicUrl = MUSIC_GENRES[music_genre as MusicGenre].url
  const PHOTO_DURATION = 3

  const creatomate = new CreatomateClient(process.env.CREATOMATE_API_KEY!)
  const renders = await creatomate.render({
    source: {
      output_format: 'mp4',
      width: 1080,
      height: 1920,
      fill_color: '#000000',
      elements: [
        {
          type: 'audio',
          source: musicUrl,
          duration: PHOTO_DURATION * photoUrls.length,
          audio_fade_out: 2,
        },
        ...photoUrls.map((url, i) => ({
          type: 'image',
          source: url,
          time: i * PHOTO_DURATION,
          duration: PHOTO_DURATION,
          fit: 'cover',
          animations: [
            {
              type: 'scale',
              scope: 'element',
              easing: 'linear',
              start_scale: '100%',
              end_scale: '110%',
            },
          ],
        })),
      ],
    },
    webhook_url: `${process.env.NEXT_PUBLIC_APP_URL}/api/webhook/creatomate`,
  })

  const render_id = renders[0].id

  await supabase
    .from('rooms')
    .update({ status: 'generating', music_genre })
    .eq('id', room.id)

  await supabase.from('reels').insert({ room_id: room.id, render_id, status: 'processing' })

  return NextResponse.json({ render_id, status: 'processing' })
}
```

- [ ] **Step 2: Create `app/api/rooms/[code]/reel/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

export async function GET(
  _request: NextRequest,
  { params }: { params: { code: string } }
) {
  const supabase = createServerClient()

  const { data: room } = await supabase
    .from('rooms')
    .select('id')
    .eq('code', params.code.toUpperCase())
    .single()

  if (!room) {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 })
  }

  const { data: reel } = await supabase
    .from('reels')
    .select('status, mp4_url')
    .eq('room_id', room.id)
    .single()

  if (!reel) {
    return NextResponse.json({ status: 'not_started' })
  }

  return NextResponse.json({ status: reel.status, mp4_url: reel.mp4_url })
}
```

- [ ] **Step 3: Create `app/api/webhook/creatomate/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { id: render_id, status, url } = body

  if (!render_id || !status) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  const supabase = createServerClient()

  const { data: reel } = await supabase
    .from('reels')
    .select('id, room_id')
    .eq('render_id', render_id)
    .single()

  if (!reel) {
    return NextResponse.json({ ok: true })
  }

  if (status === 'succeeded') {
    await supabase
      .from('reels')
      .update({ status: 'done', mp4_url: url })
      .eq('id', reel.id)
    await supabase
      .from('rooms')
      .update({ status: 'done' })
      .eq('id', reel.room_id)
  } else if (status === 'failed') {
    await supabase
      .from('reels')
      .update({ status: 'failed' })
      .eq('id', reel.id)
    await supabase
      .from('rooms')
      .update({ status: 'open' })
      .eq('id', reel.room_id)
  }

  return NextResponse.json({ ok: true })
}
```

> **Testing the webhook locally:** Creatomate needs a public URL to call back. Install [ngrok](https://ngrok.com), run `ngrok http 3000`, copy the `https://...ngrok.io` URL, and set `NEXT_PUBLIC_APP_URL=https://...ngrok.io` in `.env.local` before triggering generation.

- [ ] **Step 4: Commit**

```bash
git add app/api/rooms/[code]/generate/route.ts app/api/rooms/[code]/reel/route.ts app/api/webhook/creatomate/route.ts
git commit -m "feat: generate, reel poll, and Creatomate webhook"
```

---

## Task 8: Landing page and Create room page

**Files:**
- Modify: `app/page.tsx`
- Create: `app/create/page.tsx`

- [ ] **Step 1: Update `app/page.tsx`**

```tsx
import Link from 'next/link'

export default function Home() {
  return (
    <main className="min-h-screen bg-black text-white flex flex-col items-center justify-center px-6">
      <div className="max-w-sm w-full text-center space-y-8">
        <div className="space-y-3">
          <h1 className="text-4xl font-bold tracking-tight">Surprise Reel</h1>
          <p className="text-gray-400 text-lg">
            Everyone uploads secretly. You hit generate. They&apos;re surprised.
          </p>
        </div>
        <Link
          href="/create"
          className="block w-full bg-white text-black font-semibold py-4 rounded-2xl text-lg"
        >
          Create a Reel Room
        </Link>
      </div>
    </main>
  )
}
```

- [ ] **Step 2: Create `app/create/page.tsx`**

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { setInitiatorToken } from '@/lib/session'

const OCCASIONS = ['Trip', 'Birthday', 'Wedding', 'Company Event', 'Graduation', 'Other']

export default function CreatePage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [occasion, setOccasion] = useState('')
  const [maxPhotos, setMaxPhotos] = useState(5)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, occasion, max_photos_per_member: maxPhotos }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setInitiatorToken(data.code, data.created_by_token)
      router.push(`/room/${data.code}/lobby`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-black text-white flex flex-col items-center justify-center px-6">
      <div className="max-w-sm w-full space-y-6">
        <h1 className="text-2xl font-bold">Create a Reel Room</h1>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Room name</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Bali Trip 2026"
              required
              className="w-full bg-gray-900 rounded-xl px-4 py-3 text-white placeholder-gray-600 outline-none focus:ring-2 focus:ring-white"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-2">Occasion</label>
            <div className="grid grid-cols-2 gap-2">
              {OCCASIONS.map(o => (
                <button
                  key={o}
                  type="button"
                  onClick={() => setOccasion(o)}
                  className={`py-3 rounded-xl text-sm font-medium transition-colors ${
                    occasion === o ? 'bg-white text-black' : 'bg-gray-900 text-gray-300'
                  }`}
                >
                  {o}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-2">
              Max photos per person:{' '}
              <span className="text-white font-semibold">{maxPhotos}</span>
            </label>
            <input
              type="range"
              min={1}
              max={10}
              value={maxPhotos}
              onChange={e => setMaxPhotos(Number(e.target.value))}
              className="w-full accent-white"
            />
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading || !name || !occasion}
            className="w-full bg-white text-black font-semibold py-4 rounded-2xl text-lg disabled:opacity-40"
          >
            {loading ? 'Creating…' : 'Create Room'}
          </button>
        </form>
      </div>
    </main>
  )
}
```

- [ ] **Step 3: Test manually**

```bash
npm run dev
```

Open http://localhost:3000. Click "Create a Reel Room", fill the form, submit. Should redirect to `/room/[code]/lobby`.

- [ ] **Step 4: Commit**

```bash
git add app/page.tsx app/create/page.tsx
git commit -m "feat: landing page and create room page"
```

---

## Task 9: Join page and upload page

**Files:**
- Create: `app/room/[code]/page.tsx`
- Create: `app/room/[code]/upload/page.tsx`

- [ ] **Step 1: Create `app/room/[code]/page.tsx`**

```tsx
'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { getSession, setSession, getInitiatorToken } from '@/lib/session'

export default function JoinPage() {
  const router = useRouter()
  const params = useParams()
  const code = (params.code as string).toUpperCase()
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (getSession(code)) router.replace(`/room/${code}/lobby`)
  }, [code, router])

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/rooms/${code}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setSession(code, {
        token: data.session_token,
        roomCode: code,
        memberId: data.member_id,
        memberName: data.name,
      })
      router.push(`/room/${code}/upload`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-black text-white flex flex-col items-center justify-center px-6">
      <div className="max-w-sm w-full space-y-6">
        <div>
          <p className="text-gray-400 text-sm uppercase tracking-widest mb-1">Room</p>
          <h1 className="text-3xl font-bold">{code}</h1>
        </div>
        <p className="text-gray-300">Enter your name to join and upload your photos.</p>
        <form onSubmit={handleJoin} className="space-y-4">
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Your name"
            required
            autoFocus
            className="w-full bg-gray-900 rounded-xl px-4 py-4 text-white placeholder-gray-600 outline-none focus:ring-2 focus:ring-white text-lg"
          />
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading || !name.trim()}
            className="w-full bg-white text-black font-semibold py-4 rounded-2xl text-lg disabled:opacity-40"
          >
            {loading ? 'Joining…' : 'Join Room'}
          </button>
        </form>
      </div>
    </main>
  )
}
```

- [ ] **Step 2: Create `app/room/[code]/upload/page.tsx`**

```tsx
'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { getSession } from '@/lib/session'

export default function UploadPage() {
  const router = useRouter()
  const params = useParams()
  const code = (params.code as string).toUpperCase()
  const [session, setSessionState] = useState<ReturnType<typeof getSession>>(null)
  const [maxPhotos, setMaxPhotos] = useState(5)
  const [uploaded, setUploaded] = useState(0)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const s = getSession(code)
    if (!s) { router.replace(`/room/${code}`); return }
    setSessionState(s)
    fetch(`/api/rooms/${code}`)
      .then(r => r.json())
      .then(data => {
        setMaxPhotos(data.max_photos_per_member)
        const me = data.members?.find((m: { id: string; photos_uploaded: number }) => m.id === s.memberId)
        if (me) setUploaded(me.photos_uploaded)
      })
  }, [code, router])

  async function handleFiles(files: FileList | null) {
    if (!files || !session) return
    const toUpload = Array.from(files).slice(0, maxPhotos - uploaded)
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
        const { upload_url } = await res.json()
        if (!upload_url) continue
        await fetch(upload_url, {
          method: 'PUT',
          headers: { 'Content-Type': file.type },
          body: file,
        })
        setUploaded(prev => prev + 1)
      } catch (err) {
        console.error('Upload failed', err)
      }
    }
    setUploading(false)
  }

  const slotsLeft = maxPhotos - uploaded

  return (
    <main className="min-h-screen bg-black text-white flex flex-col items-center justify-center px-6">
      <div className="max-w-sm w-full space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Your Photos</h1>
          <p className="text-gray-400 mt-1">{uploaded} of {maxPhotos} uploaded</p>
        </div>
        <div className="w-full bg-gray-800 rounded-full h-2">
          <div
            className="bg-white h-2 rounded-full transition-all"
            style={{ width: `${(uploaded / maxPhotos) * 100}%` }}
          />
        </div>
        {slotsLeft > 0 ? (
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="w-full border-2 border-dashed border-gray-600 rounded-2xl py-12 text-gray-400 text-lg disabled:opacity-40"
          >
            {uploading ? 'Uploading…' : `Tap to add photos (${slotsLeft} left)`}
          </button>
        ) : (
          <div className="w-full bg-gray-900 rounded-2xl py-12 text-center text-gray-500">
            All slots filled
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={e => handleFiles(e.target.files)}
        />
        <button
          onClick={() => router.push(`/room/${code}/lobby`)}
          className="w-full bg-white text-black font-semibold py-4 rounded-2xl text-lg"
        >
          {uploaded > 0 ? 'Done — Go to Lobby' : 'Skip for now'}
        </button>
      </div>
    </main>
  )
}
```

- [ ] **Step 3: Test manually**

Open http://localhost:3000/room/[code] (use a real code). Enter a name → should go to upload page. Tap to upload photos → progress bar should fill. Tap "Done" → should go to lobby.

- [ ] **Step 4: Commit**

```bash
git add "app/room/[code]/page.tsx" "app/room/[code]/upload/page.tsx"
git commit -m "feat: join page and photo upload page"
```

---

## Task 10: Lobby page with Supabase Realtime

**Files:**
- Create: `app/room/[code]/lobby/page.tsx`

- [ ] **Step 1: Create `app/room/[code]/lobby/page.tsx`**

```tsx
'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
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

  async function loadRoom() {
    const res = await fetch(`/api/rooms/${code}`)
    const data: RoomPublic = await res.json()
    setRoom(data)
    setLoading(false)
    if (data.status === 'done' || data.status === 'generating') {
      router.replace(`/room/${code}/reel`)
    }
  }

  useEffect(() => {
    setIsInitiator(!!getInitiatorToken(code))
    loadRoom()

    const supabase = getSupabaseClient()
    let roomId: string

    fetch(`/api/rooms/${code}`)
      .then(r => r.json())
      .then((data: RoomPublic) => {
        roomId = data.id
        const channel = supabase
          .channel(`lobby-${roomId}`)
          .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'members',
            filter: `room_id=eq.${roomId}`,
          }, () => loadRoom())
          .on('postgres_changes', {
            event: 'UPDATE',
            schema: 'public',
            table: 'rooms',
            filter: `id=eq.${roomId}`,
          }, (payload) => {
            if (payload.new.status === 'done' || payload.new.status === 'generating') {
              router.replace(`/room/${code}/reel`)
            }
          })
          .subscribe()
        return () => { supabase.removeChannel(channel) }
      })
  }, [code, router])

  if (loading || !room) {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center">
        <p className="text-gray-400">Loading…</p>
      </main>
    )
  }

  const uploadedCount = room.members.filter((m: MemberPublic) => m.photos_uploaded > 0).length

  return (
    <main className="min-h-screen bg-black text-white flex flex-col px-6 pt-12 pb-8">
      <div className="max-w-sm w-full mx-auto flex flex-col flex-1 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">{room.name}</h1>
          <p className="text-gray-400 mt-1">
            {uploadedCount} of {room.members.length} members uploaded
          </p>
        </div>
        <div className="flex-1 space-y-3">
          {room.members.map((member: MemberPublic) => (
            <div key={member.id} className="flex items-center justify-between bg-gray-900 rounded-xl px-4 py-3">
              <span className="font-medium">{member.name}</span>
              <span className={member.photos_uploaded > 0 ? 'text-green-400 text-sm' : 'text-gray-600 text-sm'}>
                {member.photos_uploaded > 0 ? '✓ uploaded' : '○ waiting'}
              </span>
            </div>
          ))}
        </div>
        {isInitiator ? (
          <button
            onClick={() => router.push(`/room/${code}/generate`)}
            disabled={uploadedCount === 0}
            className="w-full bg-white text-black font-semibold py-4 rounded-2xl text-lg disabled:opacity-30"
          >
            Generate Reel
          </button>
        ) : (
          <p className="text-center text-gray-500 text-sm">
            Waiting for the host to generate the reel…
          </p>
        )}
      </div>
    </main>
  )
}
```

- [ ] **Step 2: Test Realtime**

Open the lobby in two browser tabs. In one tab go to the upload page and upload a photo. The other tab's lobby should update the member's status to "✓ uploaded" without a page refresh.

- [ ] **Step 3: Commit**

```bash
git add "app/room/[code]/lobby/page.tsx"
git commit -m "feat: lobby with Supabase Realtime member updates"
```

---

## Task 11: Generate page and Reel reveal page

**Files:**
- Create: `app/room/[code]/generate/page.tsx`
- Create: `app/room/[code]/reel/page.tsx`

- [ ] **Step 1: Create `app/room/[code]/generate/page.tsx`**

```tsx
'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { getInitiatorToken } from '@/lib/session'
import { MUSIC_GENRES, MusicGenre } from '@/lib/music'

export default function GeneratePage() {
  const router = useRouter()
  const params = useParams()
  const code = (params.code as string).toUpperCase()
  const [genre, setGenre] = useState<MusicGenre | ''>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!getInitiatorToken(code)) router.replace(`/room/${code}/lobby`)
  }, [code, router])

  async function handleGenerate() {
    if (!genre) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/rooms/${code}/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-initiator-token': getInitiatorToken(code)!,
        },
        body: JSON.stringify({ music_genre: genre }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      router.push(`/room/${code}/reel`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-black text-white flex flex-col items-center justify-center px-6">
      <div className="max-w-sm w-full space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Choose the vibe</h1>
          <p className="text-gray-400 mt-1">Pick a music style for the reel.</p>
        </div>
        <div className="space-y-3">
          {(Object.entries(MUSIC_GENRES) as [MusicGenre, typeof MUSIC_GENRES[MusicGenre]][]).map(
            ([key, val]) => (
              <button
                key={key}
                onClick={() => setGenre(key)}
                className={`w-full text-left px-5 py-4 rounded-2xl transition-colors ${
                  genre === key ? 'bg-white text-black' : 'bg-gray-900 text-white'
                }`}
              >
                <div className="font-semibold">{val.label}</div>
                <div className={`text-sm ${genre === key ? 'text-gray-600' : 'text-gray-400'}`}>
                  {val.description}
                </div>
              </button>
            )
          )}
        </div>
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <button
          onClick={handleGenerate}
          disabled={!genre || loading}
          className="w-full bg-white text-black font-semibold py-4 rounded-2xl text-lg disabled:opacity-40"
        >
          {loading ? 'Starting generation…' : 'Generate Reel'}
        </button>
      </div>
    </main>
  )
}
```

- [ ] **Step 2: Create `app/room/[code]/reel/page.tsx`**

```tsx
'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams } from 'next/navigation'

export default function ReelPage() {
  const params = useParams()
  const code = (params.code as string).toUpperCase()
  const [mp4Url, setMp4Url] = useState<string | null>(null)
  const [status, setStatus] = useState<'not_started' | 'processing' | 'done' | 'failed'>('processing')
  const pollRef = useRef<ReturnType<typeof setInterval>>()

  useEffect(() => {
    async function poll() {
      const res = await fetch(`/api/rooms/${code}/reel`)
      const data = await res.json()
      setStatus(data.status)
      if (data.status === 'done' && data.mp4_url) {
        setMp4Url(data.mp4_url)
        clearInterval(pollRef.current)
      } else if (data.status === 'failed') {
        clearInterval(pollRef.current)
      }
    }
    poll()
    pollRef.current = setInterval(poll, 5000)
    return () => clearInterval(pollRef.current)
  }, [code])

  async function handleDownload() {
    if (!mp4Url) return
    const res = await fetch(mp4Url)
    const blob = await res.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `surprise-reel-${code}.mp4`
    a.click()
  }

  async function handleShare() {
    if (!mp4Url) return
    if (navigator.share) {
      const res = await fetch(mp4Url)
      const blob = await res.blob()
      const file = new File([blob], `surprise-reel-${code}.mp4`, { type: 'video/mp4' })
      await navigator.share({ files: [file], title: 'Our Surprise Reel' })
    } else {
      handleDownload()
    }
  }

  if (status !== 'done' || !mp4Url) {
    return (
      <main className="min-h-screen bg-black text-white flex flex-col items-center justify-center px-6 space-y-4">
        {status === 'failed' ? (
          <p className="text-red-400 text-lg text-center">Generation failed. Go back and try again.</p>
        ) : (
          <>
            <div className="w-12 h-12 border-4 border-white border-t-transparent rounded-full animate-spin" />
            <p className="text-gray-300 text-lg">Generating your reel…</p>
            <p className="text-gray-500 text-sm">This takes about a minute.</p>
          </>
        )}
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-black text-white flex flex-col items-center justify-center px-6 space-y-6">
      <div className="w-full max-w-sm">
        <video
          src={mp4Url}
          controls
          autoPlay
          playsInline
          className="w-full rounded-2xl"
        />
      </div>
      <div className="w-full max-w-sm space-y-3">
        <button
          onClick={handleShare}
          className="w-full bg-white text-black font-semibold py-4 rounded-2xl text-lg"
        >
          Share
        </button>
        <button
          onClick={handleDownload}
          className="w-full bg-gray-900 text-white font-semibold py-4 rounded-2xl text-lg"
        >
          Download MP4
        </button>
      </div>
    </main>
  )
}
```

- [ ] **Step 3: Test manually**

Go through the full flow: create room → join as a member → upload photos → go to lobby → hit Generate Reel → pick music → watch loading spinner → reel appears when webhook fires.

- [ ] **Step 4: Commit**

```bash
git add "app/room/[code]/generate/page.tsx" "app/room/[code]/reel/page.tsx"
git commit -m "feat: generate page and reel reveal page"
```

---

## Future Features (v2)

### Music Search (Pixabay API)
Let users search and pick specific tracks instead of preset genres.

**What changes:**
- `lib/music.ts` → replaced by `lib/music-search.ts` (function that calls Pixabay Music API)
- New API route: `app/api/music/search/route.ts` — proxies Pixabay so the API key stays server-side
- `app/room/[code]/generate/page.tsx` — replace genre buttons with search input + results list
- Supabase schema: add `music_url text` column to `rooms` table to store the chosen track URL instead of just a genre name

**Why Pixabay:** Free, royalty-free, returns direct `.mp3` URLs that Creatomate can use. Spotify/YouTube won't work — their streams are DRM protected.

---

## Final Pre-Launch Checklist

- [ ] All env vars set in `.env.local`
- [ ] Supabase tables created (`rooms`, `members`, `photos`, `reels`)
- [ ] Realtime enabled for `rooms` and `members` in Supabase → Database → Replication
- [ ] Storage buckets created: `photos` (private), `reels` (public)
- [ ] Storage policies applied to `photos` bucket
- [ ] Creatomate API key set
- [ ] Music URLs in `lib/music.ts` replaced with real licensed tracks from https://pixabay.com/music
- [ ] For webhook testing locally: use ngrok and set `NEXT_PUBLIC_APP_URL` to ngrok URL
- [ ] For production: deploy to Vercel, set all env vars in Vercel dashboard, update `NEXT_PUBLIC_APP_URL` to production domain
