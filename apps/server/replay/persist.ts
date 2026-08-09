/**
 * Writes a finished match to `completed_games` and its tape to Storage.
 *
 * Until now nothing persisted a match at all: the loop broadcast `match-end`
 * and the result evaporated, which is why the fight log and the summary page
 * both fall back to fixtures. This is the writer.
 *
 * ## Two writes, not one
 *
 * The row is inserted immediately and `replay_key` is patched in after the
 * upload. The alternative — pack, upload, then insert once — would leave the
 * summary page 404ing for however long a few hundred KB takes to reach
 * Storage, on exactly the navigation the player just made. Inserting first
 * means the fight is queryable straight away and the tape arrives a moment
 * later, which the client already handles: `/games/:id/replay` reports
 * `pending` while the key is null.
 *
 * ## Failure policy
 *
 * The match is over and both clients have already been told who won. Nothing
 * here can change that, so every failure is logged and swallowed — a Storage
 * outage costs the replay, never the result. An upload failure still leaves a
 * complete row behind, just without a tape.
 */

import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { db } from 'db/client';
import { completedGames, users } from 'db/schema';
import type { ReplayPunchRecord } from 'game-mechanics';
import type { ReplayRecorder } from './recorder';
import { uploadReplay } from './storage';

export interface PersistMatchOptions {
  /** Pre-generated so `match-end` can carry it before any of this finishes. */
  gameId: string;
  sessionId: string;
  winnerUuid: string | null;
  reason: 'KO' | 'DECISION' | 'DRAW';
  durationMs: number;
  playerUuids: string[];
  recorder: ReplayRecorder;
}

/** Ids are minted here so the caller can announce one without awaiting a write. */
export function newGameId(): string {
  return randomUUID();
}

/**
 * Hardest punch of the fight, by health damage dealt. Ties break toward the
 * later punch, so a fight that ends on a knockout blow of equal weight
 * highlights the one that finished it.
 */
function strongestPunch(punches: readonly ReplayPunchRecord[]) {
  let best: ReplayPunchRecord | null = null;
  for (const punch of punches) {
    if (punch.healthDamage <= 0) continue;
    if (!best || punch.healthDamage >= best.healthDamage) best = punch;
  }
  if (!best) return null;
  return {
    by: best.by,
    type: best.punchType,
    hand: best.hand,
    damage: Math.round(best.healthDamage * 10) / 10,
    atMs: Math.round(best.atMs),
    speed: Math.round(best.speed * 100) / 100,
  };
}

async function namesFor(uuids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(uuids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const rows = await db
    .select({ uuid: users.uuid, name: users.name })
    .from(users)
    .where(inArray(users.uuid, unique));
  return new Map(rows.map((r) => [r.uuid, r.name]));
}

export async function persistCompletedGame({
  gameId,
  sessionId,
  winnerUuid,
  reason,
  durationMs,
  playerUuids,
  recorder,
}: PersistMatchOptions): Promise<void> {
  const label = `[replay:${gameId}]`;
  try {
    await db.insert(completedGames).values({
      id: gameId,
      sessionId,
      winnerUuid,
      strongestPunch: strongestPunch(recorder.punches),
    });
  } catch (err) {
    // Without a row there is nowhere to hang a replay key, so stop here.
    console.error(`${label} failed to write completed_games`, err);
    return;
  }

  let tape: Uint8Array | null = null;
  try {
    const names = await namesFor(playerUuids);
    tape = recorder.pack({ durationMs, winnerUuid, reason, names });
  } catch (err) {
    console.error(`${label} failed to pack tape`, err);
    return;
  }
  if (!tape) {
    console.log(`${label} no frames recorded, skipping tape`);
    return;
  }

  try {
    const key = await uploadReplay(gameId, tape);
    if (!key) return; // storage unconfigured; storage.ts has already warned
    await db.update(completedGames).set({ replayKey: key }).where(eq(completedGames.id, gameId));
    console.log(`${label} stored ${(tape.byteLength / 1024).toFixed(0)}KB tape at ${key}`);
  } catch (err) {
    console.error(`${label} failed to store tape`, err);
  }
}
