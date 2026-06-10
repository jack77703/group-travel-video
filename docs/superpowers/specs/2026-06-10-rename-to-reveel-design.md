# Rename to Reveel — Design Spec

**Date:** 2026-06-10
**Status:** Approved

---

## Overview

Rename the project from "group-travel-video" / "Surprise Recap Reels" to **Reveel** — a double meaning of "reveal" (the surprise moment) and "reel" (the video). Domain: `reveel.app`.

---

## Code Changes

Four files require updates. All are string replacements; no logic changes.

| File | Old | New |
|---|---|---|
| `package.json` | `"name": "group-travel-video"` | `"name": "reveel"` |
| `app/layout.tsx` | title `"Group Travel Video"`, description `"Group travel video generator — mobile web MVP"` | title `"Reveel"`, description `"Everyone uploads secretly. You hit generate. They're surprised."` |
| `app/page.tsx` | headline `Surprise Reel` | `Reveel` |
| `app/room/[code]/share/page.tsx` | share title `"Our Surprise Reel"` (×3), download filename `surprise-reel-${code}.mp4` | `"Our Reveel"` (×3), `reveel-${code}.mp4` |

---

## Manual Steps (outside codebase)

These cannot be automated and must be done by the developer:

1. **GitHub** — repo Settings → rename `group-travel-video` → `reveel`
2. **Domain** — purchase `reveel.app`
3. **Vercel** — rename project, add `reveel.app` as custom domain, update `NEXT_PUBLIC_APP_URL` env var to `https://reveel.app`

> **Note:** `NEXT_PUBLIC_APP_URL` is critical — it's used to build the Creatomate webhook URL in `app/api/rooms/[code]/generate/route.ts`. Updating it in Vercel triggers a redeploy automatically.

---

## Out of Scope

- Logo / favicon (no current custom icon to update)
- Social meta tags / OG image (not yet implemented)
- Database content (room names, member names — user-generated, not affected)
