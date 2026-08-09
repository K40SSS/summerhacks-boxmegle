import { Router } from "express";
import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, inArray, lt, ne, or } from "drizzle-orm";
import { db } from "db/client";
import { gameSessions, publicQueue, users } from "db/schema";

const PAIR_INTERVAL_MS = 1000;
// The queue page polls /queue/status every 1500ms and that refreshes
// lastSeenAt. A tab closed, refreshed, or navigated away without hitting
// /queue/leave stops refreshing it -- prune it so it can't get matched
// against a client that no longer exists, stranding the real opponent.
const PRUNE_STALE_MS = 8000;
const NAME_MAX_LENGTH = 24;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export const queueRouter = Router();

queueRouter.post("/queue", async (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  if (name.length > NAME_MAX_LENGTH) {
    res
      .status(400)
      .json({ error: `name must be ${NAME_MAX_LENGTH} characters or fewer` });
    return;
  }

  try {
    const [user] = await db
      .insert(users)
      .values({ name })
      .returning({ uuid: users.uuid });
    const [entry] = await db
      .insert(publicQueue)
      .values({ userUuid: user.uuid })
      .returning({ id: publicQueue.id });
    res.json({ userUuid: user.uuid, queueId: entry.id });
  } catch (err) {
    console.error("POST /queue failed:", err);
    res.status(500).json({ error: "failed to join queue" });
  }
});

queueRouter.get("/queue/status", async (req, res) => {
  const userUuid = req.query.userUuid;
  if (!validUuid(userUuid)) {
    res.status(400).json({ error: "valid userUuid is required" });
    return;
  }

  try {
    const [session] = await db
      .select()
      .from(gameSessions)
      .where(
        and(
          or(
            eq(gameSessions.player1Uuid, userUuid),
            eq(gameSessions.player2Uuid, userUuid),
          ),
          ne(gameSessions.status, "completed"),
        ),
      )
      .orderBy(desc(gameSessions.createdAt))
      .limit(1);

    if (session) {
      const isHost = session.player1Uuid === userUuid;
      res.json({
        matched: true,
        sessionId: session.id,
        isHost,
        opponentUuid: isHost ? session.player2Uuid : session.player1Uuid,
      });
      return;
    }

    // A tab that's polling is still around; refresh its heartbeat so the
    // matchmaker doesn't sweep it as abandoned (see PRUNE_STALE_MS below).
    // No-op if the row was already deleted (e.g. it just got paired).
    await db
      .update(publicQueue)
      .set({ lastSeenAt: new Date() })
      .where(eq(publicQueue.userUuid, userUuid));

    const [{ total }] = await db.select({ total: count() }).from(publicQueue);
    const queue = await db
      .select({ userUuid: publicQueue.userUuid })
      .from(publicQueue)
      .orderBy(asc(publicQueue.joinedAt));
    const position = queue.findIndex((row) => row.userUuid === userUuid);

    res.json({
      matched: false,
      playersInQueue: total,
      queuePosition: position === -1 ? null : position + 1,
    });
  } catch (err) {
    console.error("GET /queue/status failed:", err);
    res.status(500).json({ error: "failed to check queue status" });
  }
});

queueRouter.post("/queue/leave", async (req, res) => {
  const userUuid = req.query.userUuid;
  if (!validUuid(userUuid)) {
    res.status(400).json({ error: "valid userUuid is required" });
    return;
  }

  try {
    await db.delete(publicQueue).where(eq(publicQueue.userUuid, userUuid));
    res.json({ ok: true });
  } catch (err) {
    console.error("POST /queue/leave failed:", err);
    res.status(500).json({ error: "failed to leave queue" });
  }
});

async function pairPlayers() {
  try {
    await db
      .delete(publicQueue)
      .where(lt(publicQueue.lastSeenAt, new Date(Date.now() - PRUNE_STALE_MS)));

    await db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(publicQueue)
        .orderBy(asc(publicQueue.joinedAt))
        .limit(2)
        .for("update", { skipLocked: true });
      const waiting = rows.filter(
        (row): row is typeof row & { userUuid: string } =>
          row.userUuid !== null,
      );
      if (waiting.length < 2) return;

      const [first, second] = waiting;
      await tx.insert(gameSessions).values({
        player1Uuid: first.userUuid,
        player2Uuid: second.userUuid,
        token: randomUUID(),
        status: "pending",
      });
      await tx
        .delete(publicQueue)
        .where(inArray(publicQueue.id, [first.id, second.id]));
      console.log(`paired ${first.userUuid} with ${second.userUuid}`);
    });
  } catch (err) {
    console.error("matchmaker pairing failed:", err);
  }
}

export function startMatchmakerWorker() {
  setInterval(pairPlayers, PAIR_INTERVAL_MS);
  console.log(`matchmaker worker running every ${PAIR_INTERVAL_MS}ms`);
}
