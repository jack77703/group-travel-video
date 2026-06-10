# Rename to Reveel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the project from "group-travel-video" to "Reveel" across all code files, then guide the manual GitHub + Vercel steps.

**Architecture:** Four targeted string replacements across four files — no logic changes. Manual steps (GitHub repo rename, Vercel project rename + env var update) are listed separately and must be done by the developer in their browser.

**Tech Stack:** Next.js 14, package.json, Vercel

---

## File Map

**Modified:**
- `package.json` — project name field
- `app/layout.tsx` — browser tab title + meta description
- `app/page.tsx` — home page headline
- `app/room/[code]/share/page.tsx` — native share title + download filename

---

### Task 1: Update package.json name

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Update the name field**

In `package.json`, change line 2:

```json
"name": "reveel",
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: rename package to reveel"
```

---

### Task 2: Update site title and meta description

**Files:**
- Modify: `app/layout.tsx`

- [ ] **Step 1: Replace the metadata**

Replace the entire contents of `app/layout.tsx` with:

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Reveel",
  description: "Everyone uploads secretly. You hit generate. They're surprised.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add app/layout.tsx
git commit -m "chore: update site title and description to Reveel"
```

---

### Task 3: Update home page headline

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Find the headline**

In `app/page.tsx`, find the line:

```tsx
                  Surprise Reel
```

Replace it with:

```tsx
                  Reveel
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add app/page.tsx
git commit -m "chore: update home page headline to Reveel"
```

---

### Task 4: Update share page titles and download filename

**Files:**
- Modify: `app/room/[code]/share/page.tsx`

- [ ] **Step 1: Update share titles**

In `app/room/[code]/share/page.tsx`, replace all three occurrences of:

```ts
'Our Surprise Reel'
```

with:

```ts
'Our Reveel'
```

- [ ] **Step 2: Update download filename**

In the same file, find:

```ts
link.download = `surprise-reel-${code}.mp4`
```

Replace with:

```ts
link.download = `reveel-${code}.mp4`
```

Also find:

```ts
const file = new File([blob], `surprise-reel-${code}.mp4`, { type: 'video/mp4' })
```

Replace with:

```ts
const file = new File([blob], `reveel-${code}.mp4`, { type: 'video/mp4' })
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Build check**

Run: `npm run build`
Expected: build completes with no errors

- [ ] **Step 5: Commit**

```bash
git add "app/room/[code]/share/page.tsx"
git commit -m "chore: update share titles and download filename to Reveel"
```

- [ ] **Step 6: Push**

```bash
git push
```

---

### Task 5: Manual steps (developer does these in browser)

No code required. Do these in order after pushing.

- [ ] **Step 1: Rename GitHub repo**

1. Go to `https://github.com/jack77703/group-travel-video`
2. Click **Settings** (top tab)
3. Under **Repository name**, change to `reveel`
4. Click **Rename**

After renaming, update your local remote:

```bash
git remote set-url origin https://github.com/jack77703/reveel.git
```

- [ ] **Step 2: Rename Vercel project**

1. Go to your Vercel dashboard → find the `group-travel-video` project
2. Click **Settings** → **General**
3. Under **Project Name**, change to `reveel`
4. Save — the deployment URL becomes `reveel.vercel.app`

- [ ] **Step 3: Update NEXT_PUBLIC_APP_URL in Vercel**

1. In the same Vercel project → **Settings** → **Environment Variables**
2. Find `NEXT_PUBLIC_APP_URL`
3. Change the value to `https://reveel.vercel.app`
4. Save — Vercel will trigger a redeploy automatically

> **Why this matters:** The Creatomate webhook URL is built from `NEXT_PUBLIC_APP_URL` in `app/api/rooms/[code]/generate/route.ts`. If this isn't updated, video generation will break after the rename.

- [ ] **Step 4: Verify**

1. Open `https://reveel.vercel.app` — should load the app with title "Reveel"
2. Create a test room — confirm generation still works (webhook hits the correct URL)
