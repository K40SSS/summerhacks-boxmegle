/**
 * Supabase Storage access for replay tapes.
 *
 * Tapes are a few hundred KB of opaque binary each. That is the wrong shape
 * for Postgres — a jsonb column would bloat the row, the WAL and every backup
 * with a blob nothing ever queries — so the bytes live in object storage and
 * `completed_games.replay_key` holds the object key, which is what that column
 * was always for.
 *
 * Talks to the Storage REST API with `fetch` rather than pulling in
 * `@supabase/supabase-js`: upload, download and create-bucket are three
 * one-line requests, and the server otherwise has no Supabase dependency.
 *
 * ## Configuration
 *
 * Needs `SUPABASE_SERVICE_ROLE_KEY`. The project URL is read from
 * `SUPABASE_URL` if set, and otherwise derived from the project ref already
 * embedded in `DATABASE_URL`, so the usual setup is one new variable.
 *
 * The service role key bypasses RLS and must never reach the browser — which
 * is why the web app fetches tapes through this server's `/games/:id/replay`
 * rather than hitting Storage directly. That also keeps the bucket private and
 * sidesteps CORS entirely.
 *
 * When the key is absent, every function here degrades to a no-op with one
 * warning. A missing replay must not be able to fail a match.
 */

const BUCKET = process.env.SUPABASE_REPLAY_BUCKET ?? 'replays';

function projectUrl(): string | null {
  const explicit = process.env.SUPABASE_URL;
  if (explicit) return explicit.replace(/\/+$/, '');
  // Pooler hosts embed the project ref as the Postgres user: postgres.<ref>
  const ref = /postgres\.([a-z0-9]+)[:@]/.exec(process.env.DATABASE_URL ?? '')?.[1];
  return ref ? `https://${ref}.supabase.co` : null;
}

const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? null;
const URL_BASE = projectUrl();

export const replayStorageEnabled = Boolean(SERVICE_KEY && URL_BASE);

let warned = false;
function warnOnce(): void {
  if (warned) return;
  warned = true;
  console.warn(
    '[replay] storage is not configured — set SUPABASE_SERVICE_ROLE_KEY (and SUPABASE_URL if it cannot be derived from DATABASE_URL). Matches will still be recorded to completed_games, without a tape.',
  );
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    Authorization: `Bearer ${SERVICE_KEY}`,
    apikey: SERVICE_KEY as string,
    ...extra,
  };
}

/** Object key for a game's tape. */
export function replayKeyFor(gameId: string): string {
  return `${gameId}.bxrp`;
}

// Created lazily on the first upload so a fresh project needs no dashboard
// setup. Kept as a promise, not a boolean, so concurrent matches ending at the
// same moment share one attempt instead of racing.
let bucketReady: Promise<void> | null = null;

function ensureBucket(): Promise<void> {
  bucketReady ??= (async () => {
    const res = await fetch(`${URL_BASE}/storage/v1/bucket`, {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json' }),
      // Private: tapes are served through this process, never linked directly.
      body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false }),
    });
    // 409 means someone already created it, which is the goal state.
    if (!res.ok && res.status !== 409) {
      const detail = await res.text().catch(() => '');
      throw new Error(`could not create bucket ${BUCKET}: ${res.status} ${detail}`);
    }
  })().catch((err) => {
    // Don't cache a transient failure as a permanent one.
    bucketReady = null;
    throw err;
  });
  return bucketReady;
}

/** Upload a tape. Returns the stored key, or null when storage is unconfigured. */
export async function uploadReplay(gameId: string, tape: Uint8Array): Promise<string | null> {
  if (!replayStorageEnabled) {
    warnOnce();
    return null;
  }
  await ensureBucket();

  const key = replayKeyFor(gameId);
  const res = await fetch(`${URL_BASE}/storage/v1/object/${BUCKET}/${key}`, {
    method: 'POST',
    headers: headers({
      'Content-Type': 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'x-upsert': 'true',
    }),
    body: tape,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`replay upload failed: ${res.status} ${detail}`);
  }
  return key;
}

/** Fetch a stored tape. Null when the object is gone or storage is off. */
export async function downloadReplay(key: string): Promise<Buffer | null> {
  if (!replayStorageEnabled) {
    warnOnce();
    return null;
  }
  const res = await fetch(`${URL_BASE}/storage/v1/object/${BUCKET}/${key}`, {
    headers: headers(),
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`replay download failed: ${res.status} ${detail}`);
  }
  return Buffer.from(await res.arrayBuffer());
}
