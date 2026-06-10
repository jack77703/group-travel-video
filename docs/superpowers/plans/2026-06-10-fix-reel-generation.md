# Fix Reel Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the reel generation flow work end-to-end — generate route stores the render ID, Creatomate calls the webhook, the webhook finds the reel and marks it done, and the reel page displays the video.

**Architecture:** The generate route calls Creatomate, stores the `render_id` in the `reels` table, then the webhook fired by Creatomate looks up that row and flips it to `done` with the video URL. Currently the webhook fires but finds no row — meaning either the insert silently fails or the render_id format mismatches. This plan diagnoses via the already-deployed debug logs, then applies targeted fixes.

**Tech Stack:** Next.js 14 App Router, Supabase (Postgres), Creatomate Node SDK, Vercel serverless functions.

---

## Known state going in

Debug logging is already deployed on two routes:
- `app/api/rooms/[code]/generate/route.ts` logs `[generate] render_id:` and `[generate] reel insert error:`
- `app/api/webhook/creatomate/route.ts` logs `[webhook] payload:`, `[webhook] render_id:`, and `[webhook] reel:`

The symptom: webhook fires (200), but only one Supabase GET is made (on `reels`), meaning the row is not found and the webhook exits early without updating anything.

---

## File Map

| File | Change |
|------|--------|
| `app/api/rooms/[code]/generate/route.ts` | Add error guard on reel insert; return 500 if it fails |
| `app/api/webhook/creatomate/route.ts` | Remove debug logs after fix confirmed |
| `app/api/rooms/[code]/generate/route.ts` | Remove debug logs after fix confirmed |

---

### Task 1: Read the debug logs to confirm root cause

The fix depends on what the logs show. Trigger a fresh generate, then check Vercel Runtime Logs.

- [ ] **Step 1: Create a fresh room, upload at least one photo, and click Generate Reel**

- [ ] **Step 2: In Vercel Runtime Logs, filter for `[generate]` — find these two lines:**

```
[generate] render_id: <some-uuid>  room.id: <some-uuid>
[generate] reel insert error: null
```

If `reel insert error` is **not** `null`, the insert is failing — go to Task 2A.
If `reel insert error` is `null`, the insert succeeded — go to Task 2B.

- [ ] **Step 3: In Vercel Runtime Logs, filter for `[webhook]` — find these lines:**

```
[webhook] payload: {"id":"<uuid>","status":"succeeded","url":"https://..."}
[webhook] render_id: <uuid>  reel: null  error: {...}
```

If `reel` is `null`, compare the `render_id` from `[generate]` vs `[webhook]` — if they differ, go to Task 2C.
If they match but reel is still null, the row isn't in the database — confirm Task 2A was the issue.

---

### Task 2A: Fix — reel insert failing silently in generate route

The generate route does not return an error if the `reels` insert fails, so the user gets no feedback and the webhook finds nothing.

**Files:**
- Modify: `app/api/rooms/[code]/generate/route.ts`

- [ ] **Step 1: Open `app/api/rooms/[code]/generate/route.ts` and replace the reel insert block**

Current code (around line 95):
```typescript
  const { error: reelInsertError } = await supabase.from('reels').insert({ room_id: room.id, render_id, status: 'processing' })
  console.log('[generate] reel insert error:', JSON.stringify(reelInsertError))
```

Replace with:
```typescript
  const { error: reelInsertError } = await supabase
    .from('reels')
    .insert({ room_id: room.id, render_id, status: 'processing' })

  if (reelInsertError) {
    console.error('[generate] reel insert failed:', reelInsertError)
    // Roll back room status so user can retry
    await supabase.from('rooms').update({ status: 'open' }).eq('id', room.id)
    return NextResponse.json({ error: 'Failed to start reel generation' }, { status: 500 })
  }
```

- [ ] **Step 2: Check if the `reels` table exists in Supabase**

Go to Supabase dashboard → Table Editor. If the `reels` table is missing, run this SQL in the SQL editor:

```sql
create table if not exists reels (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  render_id text not null unique,
  status text not null default 'processing',
  mp4_url text,
  created_at timestamptz not null default now()
);
```

- [ ] **Step 3: Verify columns match what the code expects**

The code inserts: `room_id`, `render_id`, `status`.
The webhook updates: `status`, `mp4_url`.
The reel GET reads: `status`, `mp4_url`.

Run in Supabase SQL editor to confirm:
```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_name = 'reels'
order by ordinal_position;
```

Expected columns: `id`, `room_id`, `render_id`, `status`, `mp4_url`, `created_at`.

- [ ] **Step 4: Commit**

```bash
git add app/api/rooms/\[code\]/generate/route.ts
git commit -m "fix: return 500 and rollback room status if reel insert fails"
git push origin main
```

---

### Task 2B: Fix — render_id present in DB but webhook lookup fails

If the `[generate]` logs show the insert succeeded but the `[webhook]` logs show `reel: null`, the `render_id` values are not matching. This could be a Creatomate SDK wrapping issue.

**Files:**
- Modify: `app/api/webhook/creatomate/route.ts`

- [ ] **Step 1: Compare the two render IDs**

From the logs:
- `[generate] render_id: <A>`
- `[webhook] render_id: <B>`

If A ≠ B, note the format difference. The Creatomate SDK `renders[0].id` is a UUID. The webhook payload `id` should also be the same UUID. If the webhook payload wraps it (e.g. `{ "renderId": "..." }` instead of `{ "id": "..." }`), adjust the destructure.

- [ ] **Step 2: Log the full webhook payload to find the correct field name**

The debug logging already does `console.log('[webhook] payload:', JSON.stringify(body))` — read those logs to see the exact structure Creatomate sends.

If the field is named differently (e.g. `renderId` instead of `id`), update the destructure in `app/api/webhook/creatomate/route.ts`:

```typescript
// Change this:
const { id: render_id, status, url } = body

// To match whatever the payload shows, e.g.:
const { id: render_id, status, url } = body   // if "id" is correct
// OR
const render_id = body.id ?? body.renderId    // if name is uncertain
```

- [ ] **Step 3: Commit**

```bash
git add app/api/webhook/creatomate/route.ts
git commit -m "fix: match render_id field name from Creatomate webhook payload"
git push origin main
```

---

### Task 2C: Fix — timing race (Creatomate fires webhook before insert completes)

Unlikely but possible: Creatomate completes synchronously and fires the webhook before the `reels` insert finishes. Fix by retrying the lookup.

**Files:**
- Modify: `app/api/webhook/creatomate/route.ts`

- [ ] **Step 1: Add a simple retry loop in the webhook reel lookup**

Replace:
```typescript
  const { data: reel, error: reelError } = await supabase
    .from('reels')
    .select('id, room_id')
    .eq('render_id', render_id)
    .single()

  console.log('[webhook] render_id:', render_id, 'reel:', JSON.stringify(reel), 'error:', JSON.stringify(reelError))

  if (!reel) {
    return NextResponse.json({ ok: true })
  }
```

With:
```typescript
  let reel: { id: string; room_id: string } | null = null
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1000))
    const { data } = await supabase
      .from('reels')
      .select('id, room_id')
      .eq('render_id', render_id)
      .single()
    if (data) { reel = data; break }
  }

  if (!reel) {
    console.error('[webhook] reel not found after retries, render_id:', render_id)
    return NextResponse.json({ ok: true })
  }
```

- [ ] **Step 2: Commit**

```bash
git add app/api/webhook/creatomate/route.ts
git commit -m "fix: retry reel lookup in webhook to handle insert race"
git push origin main
```

---

### Task 3: Clean up debug logging

Once the fix is confirmed working (reel generation completes and video appears on reel page), remove the debug logs.

**Files:**
- Modify: `app/api/rooms/[code]/generate/route.ts`
- Modify: `app/api/webhook/creatomate/route.ts`

- [ ] **Step 1: Remove debug lines from `app/api/rooms/[code]/generate/route.ts`**

Remove:
```typescript
  console.log('[generate] render_id:', render_id, 'room.id:', room.id)
```

- [ ] **Step 2: Remove debug lines from `app/api/webhook/creatomate/route.ts`**

Remove:
```typescript
  console.log('[webhook] payload:', JSON.stringify(body))
```

And remove the inline `console.error` you added in Task 2C (or keep it — error logs on webhook failure are reasonable to keep permanently).

- [ ] **Step 3: Commit**

```bash
git add app/api/rooms/\[code\]/generate/route.ts app/api/webhook/creatomate/route.ts
git commit -m "chore: remove debug logging from generate and webhook routes"
git push origin main
```

---

### Task 4: End-to-end test

- [ ] **Step 1: Create a fresh room, upload at least 1 photo**
- [ ] **Step 2: Go to lobby, click Generate Reel, pick a track, click Generate**
- [ ] **Step 3: Reel page shows spinner — wait up to 2 minutes**
- [ ] **Step 4: Reel page transitions to video player without manual refresh**
- [ ] **Step 5: Video plays correctly. Share and Download buttons work.**
- [ ] **Step 6: In Vercel Runtime Logs, confirm `/api/webhook/creatomate` shows two Supabase calls (GET reels + PATCH reels + PATCH rooms) — not just one**
