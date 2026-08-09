<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# boxmegle web app

Next.js (App Router) frontend for boxmegle, an Omegle-style matchmaking fighting game. Part of a pnpm monorepo (`apps/web`, `apps/server`, `packages/db`).

## Commands

Run from repo root unless noted.

- `pnpm dev` — runs `apps/web` (port 3000) and `apps/server` together
- `pnpm --filter web dev` — this app only
- `pnpm --filter web build` — production build
- `pnpm --filter web lint` — eslint (run from `apps/web`: `pnpm lint`)
- `pnpm drizzle-kit push` — push the shared Drizzle schema (`packages/db`) to Supabase

## Structure

- `src/app` — routes (App Router)
- `src/components/ui` — shared UI (e.g. `ServerStatusCard`)
- `src/components/landing` — landing page only (e.g. `LandingBackground`, the three.js scene)

## Notes

- No auth — anonymous, name-only.
- `NEXT_PUBLIC_MATCHMAKER_URL` points at `apps/server` (defaults to `http://localhost:4000`); the landing page pings `/health` on it for `ServerStatusCard`.
- Env vars are synced from root `.env` via `./sync-env.sh` (run from repo root) — don't hand-edit `apps/web/.env.local` directly.
- Match code style to the surrounding file. No unsolicited refactors.
