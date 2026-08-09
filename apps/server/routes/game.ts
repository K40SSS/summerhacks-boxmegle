import { Router } from 'express';
import { db } from 'db/client';
import { gameSessions, users } from 'db/schema';

export const gameRouter = Router();

gameRouter.post('/begin_fight', async (req, res) => {
  const { player1, player2 } = req.body ?? {};

  if (!player1?.uuid || !player2?.uuid) {
    res.status(400).json({ error: 'player1 and player2 are required' });
    return;
  }

  const hostUuid = player1.uuid as string;
  const token = crypto.randomUUID();

  await db
    .insert(users)
    .values([
      { uuid: player1.uuid, name: player1.name ?? 'Player' },
      { uuid: player2.uuid, name: player2.name ?? 'Player' },
    ])
    .onConflictDoNothing({ target: users.uuid });

  const [session] = await db
    .insert(gameSessions)
    .values({
      player1Uuid: player1.uuid,
      player2Uuid: player2.uuid,
      token,
      status: 'pending',
    })
    .returning({ id: gameSessions.id });

  const sessionId = session.id;

  res.json({
    sessionId,
    token,
    hostUuid,
    players: { player1, player2 },
    peerPath: '/peerjs',
    wsUrl: `/game_session?sessionId=${sessionId}`,
  });
});
