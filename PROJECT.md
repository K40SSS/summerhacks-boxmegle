# boxmegle - Project Architecture

Omegle-style 1v1 boxing game. Two strangers match up, fight via webcam-tracked motion (pose landmarks), then get a 3D replay + stats. No auth, name-only.

## Infra

- **apps/web** - Next.js 14 (App Router). Serves all pages + internal API routes (`/queue`, `/begin_fight`, `/peerjs`, `/game_session` ws).
- **apps/server** - standalone Node/Express process. Matchmaking worker: polls `public_queue` and pairs users into `game_sessions`.
- **packages/db** - shared Drizzle ORM schema/client (Supabase Postgres), used by both apps.
- **packages/game-mechanics** - shared fight logic (pose tracking, punch detection, scoring), used by the fight page.
- Supabase Postgres - primary DB.
- Supabase Storage - stores replay blobs (`completed_games.replay_key`).
- PeerJS - WebRTC video call between the two players during a fight, brokered via a `/peerjs` middleware/proxy endpoint.
- WebSocket (`/game_session`) - low-latency channel carrying live fight events (joint coordinates, punches, timestamps) between the two clients.

## Database (Drizzle schema, `packages/db/schema.ts`)

- `users` - uuid, name, record (jsonb), max_stats (jsonb), created_at.
- `public_queue` - id, user_uuid -> users, joined_at. Holding pen for public matchmaking.
- `private_rooms` - code (pk), host_uuid -> users, created_at. Private/code-based matchmaking.
- `game_sessions` - id, player1_uuid, player2_uuid -> users, token, status (default `pending`), created_at. One row per fight; created by `/begin_fight`.
- `completed_games` - id, session_id -> game_sessions, winner_uuid -> users, strongest_punch (jsonb), replay_key (Supabase Storage object key), completed_at.

## Pages / Flow

### 1. Landing / entry
User enters a name, picks **public game** (join queue) or **private game** (enter/create a code).
- Public: `POST /queue` writes user to `users` table, then adds them to `public_queue`.
- Private: writes/matches against `private_rooms` by code.

### 2. Queue page
Shows "waiting for match" while the matchmaker worker (apps/server) polls `public_queue` on an interval. When it pairs two users it calls `/begin_fight`, which:
- Inserts a row into `game_sessions` (player1, player2, status).
- Elects a **host** (one of the two clients) so only one side initiates the P2P/websocket setup, avoiding a double-connect race.
- Returns a promise that resolves once setup below completes, then the client navigates to the fight page.

`/begin_fight` spawns two parallel connection processes:
- **`/peerjs` video call endpoint** - sets up WebRTC signaling middleware/proxy, resolves client-side once the peer connection is negotiable.
- **`/game_session` websocket** - the live data channel for the match.

Both must resolve before the fight experience proceeds (both users have entered the same `game_sessions` row).

### 3. Fight page ("fight experience")
A single React component/route that opens the websocket connection (and the PeerJS video call) established above. This is where `packages/game-mechanics` runs: tracks pose/joint data from webcam input client-side and streams events over the websocket.

During the fight the websocket must track, per user:
- winner uuid
- strongest punch + timestamp
- array of user events: `{ timestamp, event, joint coordinates[] }` - full motion log, used later to reconstruct the player in 3D.

When the fight ends:
- Write a row to `completed_games` (winner, strongest_punch, replay_key pointing at Supabase Storage).
- Both clients close their peer connection/websocket; the `/game_session` promise resolves once **both** users have left, at which point each client receives the final data payload (winner, punch stats, event log) needed for the summary page.

### 4. Summary page
Shown after the fight ends. Two parts:
- **Replay** - playback of the match.
- **3D reconstruction / stats page** - rebuilds the player's movement from the recorded joint-coordinate event array, plus stats (punch strength, record, etc.), pulled from `completed_games` / `users`.

From here, "back to start" returns the user to the landing page, closing the loop.

## Data flow summary

```
landing -> /queue -> public_queue (poll) -> matched -> /begin_fight
  -> writes game_sessions, picks host
  -> parallel: /peerjs (video) + /game_session (ws)
  -> both resolve -> fight page (websocket + peer video live)
    -> game-mechanics tracks joints/punches client-side, streamed over ws
    -> fight ends -> write completed_games (winner, strongest punch, replay_key)
    -> ws promise resolves once both clients disconnect -> each client gets final payload
  -> summary page: replay + 3D reconstruction from joint-event log + stats
  -> back to landing
```
