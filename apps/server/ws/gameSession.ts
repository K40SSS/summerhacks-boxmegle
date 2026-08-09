import type { IncomingMessage } from 'http';
import { WebSocketServer, type WebSocket } from 'ws';
import { eq } from 'drizzle-orm';
import { db } from 'db/client';
import { gameSessions } from 'db/schema';

type Session = {
  sockets: Map<string, WebSocket>; // playerUuid -> socket
};

const sessions = new Map<string, Session>();

export const gameSocketServer = new WebSocketServer({ noServer: true });

gameSocketServer.on('connection', (socket, req: IncomingMessage) => {
  const url = new URL(req.url ?? '', 'http://localhost');
  const sessionId = url.searchParams.get('sessionId');
  const playerUuid = url.searchParams.get('playerUuid');

  if (!sessionId || !playerUuid) {
    socket.close(4000, 'sessionId and playerUuid are required');
    return;
  }

  let session = sessions.get(sessionId);
  if (!session) {
    session = { sockets: new Map() };
    sessions.set(sessionId, session);
  }
  session.sockets.set(playerUuid, socket);

  socket.on('message', (raw) => {
    for (const [uuid, peerSocket] of session!.sockets) {
      if (uuid !== playerUuid && peerSocket.readyState === peerSocket.OPEN) {
        peerSocket.send(raw.toString());
      }
    }
  });

  socket.on('close', () => {
    session!.sockets.delete(playerUuid);
    if (session!.sockets.size === 0) {
      sessions.delete(sessionId);
      db.update(gameSessions)
        .set({ status: 'completed' })
        .where(eq(gameSessions.id, sessionId))
        .catch((err) => console.error('failed to close game_session', sessionId, err));
    }
  });
});
