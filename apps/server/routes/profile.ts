import { Router } from 'express';
import { desc, eq, inArray, or } from 'drizzle-orm';
import { db } from 'db/client';
import { completedGames, gameSessions, users } from 'db/schema';
import { downloadReplay } from '../replay/storage';

/**
 * Fight log endpoints, backed by the real `completed_games` table.
 *
 * Rows are written by the match loop at the final bell (see
 * apps/server/replay/persist.ts), so the log fills up on its own. Fights that
 * ended before that writer existed are still in the table without a tape; the
 * client renders them from their metadata and omits the replay.
 *
 * The table has no column for a full match summary (only `winner_uuid`,
 * `strongest_punch` and `replay_key`), so a fight opened from the log shows
 * its real metadata and its real replay, but falls back to sample per-punch
 * stats. Persisting those needs a `summary jsonb` column added to the table —
 * deliberately not done here, because it needs a migration pushed to Supabase.
 */

export const profileRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type GameRow = {
  id: string;
  sessionId: string | null;
  winnerUuid: string | null;
  strongestPunch: unknown;
  replayKey: string | null;
  completedAt: Date | null;
  player1Uuid: string | null;
  player2Uuid: string | null;
};

/** Resolve player uuids to names in one round trip, not one per row. */
async function namesFor(uuids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(uuids.filter((u): u is string => !!u))];
  if (unique.length === 0) return new Map();
  const rows = await db
    .select({ uuid: users.uuid, name: users.name })
    .from(users)
    .where(inArray(users.uuid, unique));
  return new Map(rows.map((r) => [r.uuid, r.name]));
}

function shape(row: GameRow, viewerUuid: string | null, names: Map<string, string>) {
  const p1 = row.player1Uuid;
  const p2 = row.player2Uuid;
  // Without a viewer, slot 1 is arbitrarily "you" so the shape stays uniform.
  const youUuid = viewerUuid && p2 === viewerUuid ? p2 : p1;
  const oppUuid = youUuid === p1 ? p2 : p1;

  const result =
    row.winnerUuid === null
      ? 'D'
      : row.winnerUuid === youUuid
        ? 'W'
        : 'L';

  return {
    id: row.id,
    sessionId: row.sessionId,
    completedAt: row.completedAt,
    result,
    strongestPunch: row.strongestPunch ?? null,
    hasReplay: !!row.replayKey,
    you: youUuid ? { uuid: youUuid, name: names.get(youUuid) ?? 'Unknown' } : null,
    opponent: oppUuid ? { uuid: oppUuid, name: names.get(oppUuid) ?? 'Unknown' } : null,
  };
}

/** Fight log for one player, newest first. */
profileRouter.get('/profile/:userUuid/games', async (req, res) => {
  const userUuid = req.params.userUuid;
  if (!UUID_RE.test(userUuid)) {
    res.status(400).json({ error: 'valid userUuid is required' });
    return;
  }

  const limit = Math.min(Number(req.query.limit) || 25, 100);

  try {
    const rows = await db
      .select({
        id: completedGames.id,
        sessionId: completedGames.sessionId,
        winnerUuid: completedGames.winnerUuid,
        strongestPunch: completedGames.strongestPunch,
        replayKey: completedGames.replayKey,
        completedAt: completedGames.completedAt,
        player1Uuid: gameSessions.player1Uuid,
        player2Uuid: gameSessions.player2Uuid,
      })
      .from(completedGames)
      .innerJoin(gameSessions, eq(completedGames.sessionId, gameSessions.id))
      .where(
        or(
          eq(gameSessions.player1Uuid, userUuid),
          eq(gameSessions.player2Uuid, userUuid),
        ),
      )
      .orderBy(desc(completedGames.completedAt))
      .limit(limit);

    const names = await namesFor(rows.flatMap((r) => [r.player1Uuid, r.player2Uuid] as string[]));
    res.json({ games: rows.map((row) => shape(row, userUuid, names)) });
  } catch (err) {
    console.error('failed to load fight log for', userUuid, err);
    res.status(500).json({ error: 'could not load fight log' });
  }
});

/** One completed game, for the summary page to reopen. */
profileRouter.get('/games/:gameId', async (req, res) => {
  const gameId = req.params.gameId;
  if (!UUID_RE.test(gameId)) {
    res.status(400).json({ error: 'valid gameId is required' });
    return;
  }

  const viewer = typeof req.query.viewer === 'string' && UUID_RE.test(req.query.viewer)
    ? req.query.viewer
    : null;

  try {
    const [row] = await db
      .select({
        id: completedGames.id,
        sessionId: completedGames.sessionId,
        winnerUuid: completedGames.winnerUuid,
        strongestPunch: completedGames.strongestPunch,
        replayKey: completedGames.replayKey,
        completedAt: completedGames.completedAt,
        player1Uuid: gameSessions.player1Uuid,
        player2Uuid: gameSessions.player2Uuid,
      })
      .from(completedGames)
      .innerJoin(gameSessions, eq(completedGames.sessionId, gameSessions.id))
      .where(eq(completedGames.id, gameId))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: 'game not found' });
      return;
    }

    const names = await namesFor([row.player1Uuid, row.player2Uuid] as string[]);
    res.json({ game: shape(row, viewer, names) });
  } catch (err) {
    console.error('failed to load game', gameId, err);
    res.status(500).json({ error: 'could not load game' });
  }
});

/**
 * A fight's replay tape — the binary format from game-mechanics/replay, which
 * the client decodes and plays back.
 *
 * Proxied rather than redirected to Storage. The bucket is private, so serving
 * it directly would mean either making it public or minting signed URLs, and
 * both put a second origin (with its own CORS setup) in front of the one
 * request the summary page cannot render without.
 *
 * 202 is the interesting case: the row exists but the tape is still uploading,
 * which is the normal state for the few seconds right after a match, since the
 * row is written before the upload finishes. It means "ask again shortly",
 * where 404 means "there will never be one" — a fight recorded before replays
 * existed, or one whose upload failed.
 */
profileRouter.get('/games/:gameId/replay', async (req, res) => {
  const gameId = req.params.gameId;
  if (!UUID_RE.test(gameId)) {
    res.status(400).json({ error: 'valid gameId is required' });
    return;
  }

  try {
    const [row] = await db
      .select({ replayKey: completedGames.replayKey })
      .from(completedGames)
      .where(eq(completedGames.id, gameId))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: 'game not found' });
      return;
    }
    if (!row.replayKey) {
      res.status(202).json({ status: 'pending' });
      return;
    }

    const tape = await downloadReplay(row.replayKey);
    if (!tape) {
      res.status(404).json({ error: 'replay is no longer stored' });
      return;
    }

    // Tapes are written once and never edited, so they can be cached hard.
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(tape);
  } catch (err) {
    console.error('failed to load replay for', gameId, err);
    res.status(500).json({ error: 'could not load replay' });
  }
});
