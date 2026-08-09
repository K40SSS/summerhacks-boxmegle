# boxmegle

Omegle-style fighting game. Backend repo — matchmaking, DB, and internal API. Frontend/game-mechanics team owns the `ws-server` and fight UI in a separate repo.

## Stack

- Next.js 14 (App Router) — `apps/web`
- Standalone matchmaker worker — `apps/server`
- Supabase Postgres + Drizzle ORM — `packages/db`
- Supabase Storage — replay blobs
- No auth (anonymous, name-only)

## Structure

```
apps/
  web/          # Next.js app — queue, rooms, summary pages, internal API
  server/       # standing process — pairs queued users into game_sessions
packages/
  db/           # shared Drizzle schema + client, used by both apps
```

## Prerequisites

- Node 20+
- pnpm (`npm install -g pnpm` if you don't have it)
- Access to the shared Supabase project (ask a teammate for credentials)

## Setup

```bash
git clone <repo-url>
cd fight-game
pnpm install
```

### Environment variables

Get `SUPABASE_DB_PASSWORD`, `DATABASE_URL`, `DIRECT_URL` from a teammate or the Supabase dashboard (Connect → ORM tab). `NEXT_PUBLIC_MATCHMAKER_URL` defaults to `http://localhost:4000` and only needs to change if the matchmaker runs elsewhere.

```bash
cp .env.example .env
# fill in the values in .env
chmod +x sync-env.sh
./sync-env.sh
```

This copies root `.env` into `apps/web/.env.local` and `apps/server/.env`. Re-run `./sync-env.sh` any time you update root `.env`.

### Database schema

Push the Drizzle schema to Supabase (uses `DIRECT_URL`):

```bash
pnpm drizzle-kit push
```

## Dev

```bash
pnpm dev
```

Runs `apps/web` and `apps/server` together. Web app on `localhost:3000`.

Run individually if needed:
```bash
pnpm dev:web
pnpm dev:server
```
