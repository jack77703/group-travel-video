# Lobby Share Invite Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the tiny top-right "Share invite" pill on the lobby page with a prominent amber-outlined button in the footer that uses the native OS share sheet (iOS/Android) instead of just copying to clipboard.

**Architecture:** Single-file change in `app/room/[code]/lobby/page.tsx`. Upgrade `copyInvite` → `handleShareInvite` to call `navigator.share` first (which opens the native share sheet on mobile), falling back to clipboard copy if the browser doesn't support it. Remove the pill from the top bar and add a full-width share button in the footer area, always visible for the host regardless of room status.

**Tech Stack:** Next.js 14 App Router, Web Share API (`navigator.share`), Clipboard API fallback.

---

### Task 1: Upgrade share logic and reposition the button

**Files:**
- Modify: `app/room/[code]/lobby/page.tsx`

Current state:
- `copyInvite()` only writes to clipboard — no native share sheet
- Button is a tiny `text-xs` amber pill in the top-right corner — easy to miss
- `copied` state tracks clipboard success message

Target state:
- `handleShareInvite()` calls `navigator.share({ title, text, url })` on browsers that support it (all modern iOS/Android), falls back to clipboard copy
- Remove the pill from the top bar entirely
- Add a full-width amber-outlined "Invite friends ↗" button to the footer, always shown for hosts (`isInitiator`), regardless of room status (`open`, `generating`, `done`)
- Button shows "Copied!" briefly on clipboard fallback, otherwise no state change needed since the OS sheet handles feedback

- [ ] **Step 1: Replace `copyInvite` with `handleShareInvite`**

In `app/room/[code]/lobby/page.tsx`, replace the existing `copyInvite` function (lines 72–78) with:

```typescript
async function handleShareInvite() {
  const url = `${window.location.origin}/room/${code}`
  if (navigator.share) {
    try {
      await navigator.share({
        title: room?.name ?? 'Reveel Room',
        text: 'Join my Reveel room and upload your secret photos!',
        url,
      })
    } catch (err) {
      // User dismissed the share sheet — not an error
      if (err instanceof Error && err.name === 'AbortError') return
      // Unexpected error — fall back to clipboard
      navigator.clipboard.writeText(url).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      })
    }
  } else {
    // Desktop browsers without share support — copy to clipboard
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
}
```

- [ ] **Step 2: Remove the pill from the top bar**

In `app/room/[code]/lobby/page.tsx`, remove the `{isInitiator && (...)}` block that renders the amber pill in the top bar. The top bar should only contain the `← Home` button after this change:

```tsx
{/* Top bar */}
<div className="flex-shrink-0">
  <button
    type="button"
    onClick={() => router.push('/')}
    className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/50 transition hover:border-white/30 hover:text-white/80"
  >
    ← Home
  </button>
</div>
```

- [ ] **Step 3: Add the prominent share button to the footer**

In the `{/* Footer — three states */}` div, add the `isInitiator` share button **after** all three status blocks but still inside the footer `div`. The footer `div` currently ends at the closing `</div>` after the `done` block. Add the share button just before that closing tag:

```tsx
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

  {isInitiator && (
    <button
      type="button"
      onClick={handleShareInvite}
      className="w-full rounded-2xl border border-amber-200/40 bg-amber-200/10 px-5 py-3 text-base font-bold text-amber-200 transition hover:bg-amber-200/20 active:scale-[0.99]"
    >
      {copied ? 'Link copied!' : 'Invite friends ↗'}
    </button>
  )}
</div>
```

- [ ] **Step 4: Verify TypeScript compiles cleanly**

```bash
npx tsc --noEmit
```

Expected: no output (zero errors).

- [ ] **Step 5: Commit and push**

```bash
git add app/room/\[code\]/lobby/page.tsx
git commit -m "feat: lobby share invite uses native share sheet, moved to footer"
git push
```
