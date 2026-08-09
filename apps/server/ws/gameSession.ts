import type { IncomingMessage } from 'http';
import { WebSocketServer, type WebSocket } from 'ws';
import { eq } from 'drizzle-orm';
import { db } from 'db/client';
import { gameSessions } from 'db/schema';

type Session = {
  sockets: Map<string, WebSocket>; // playerUuid -> socket
  ready: Set<string>; // playerUuids that have sent peer-ready
  cleanupTimer: NodeJS.Timeout | null;
};

const sessions = new Map<string, Session>();

// A socket can briefly drop to 0 without either player actually leaving
// (React StrictMode double-mounts the /fight effect in dev, causing a
// connect/disconnect/reconnect blip; the same can happen from a real
// network hiccup). Tearing the session down immediately on that blip wipes
// `ready` state and can permanently strand both players. Give reconnects a
// grace window before actually closing the session out.
const CLEANUP_GRACE_MS = 3000;

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
    session = { sockets: new Map(), ready: new Set(), cleanupTimer: null };
    sessions.set(sessionId, session);
  }
  if (session.cleanupTimer) {
    clearTimeout(session.cleanupTimer);
    session.cleanupTimer = null;
    console.log(`[game_session:${sessionId}] cancelled pending cleanup, ${playerUuid} reconnected`);
  }
  session.sockets.set(playerUuid, socket);
  console.log(
    `[game_session:${sessionId}] ${playerUuid} connected (${session.sockets.size}/2 in session)`,
  );

  // The opponent may have sent peer-ready before this socket registered
  // (e.g. it hadn't connected yet) -- replay it now instead of losing it.
  for (const readyUuid of session.ready) {
    if (readyUuid !== playerUuid) {
      socket.send(JSON.stringify({ type: 'peer-ready' }));
      console.log(`[game_session:${sessionId}] replayed peer-ready from ${readyUuid} to ${playerUuid}`);
      break;
    }
  }

  socket.on('message', (raw) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString());
    } catch {
      parsed = null;
    }
    if (typeof parsed === 'object' && parsed !== null && (parsed as { type?: unknown }).type === 'peer-ready') {
      session!.ready.add(playerUuid);
    }

    const relayed: string[] = [];
    for (const [uuid, peerSocket] of session!.sockets) {
      if (uuid !== playerUuid && peerSocket.readyState === peerSocket.OPEN) {
        peerSocket.send(raw.toString());
        relayed.push(uuid);
      }
    }
    console.log(
      `[game_session:${sessionId}] ${playerUuid} -> ${raw.toString()} (relayed to ${relayed.length ? relayed.join(', ') : 'nobody'})`,
    );
  });

  socket.on('close', () => {
    // A StrictMode double-mount (or fast reconnect) can register a second
    // socket for the same playerUuid before the first one's close event
    // fires. That overwrites this uuid's map entry, so only delete it if
    // it's still pointing at *this* socket -- otherwise we'd evict the
    // live reconnected socket and silently strand both players.
    if (session!.sockets.get(playerUuid) === socket) {
      session!.sockets.delete(playerUuid);
    }
    console.log(`[game_session:${sessionId}] ${playerUuid} disconnected`);
    if (session!.sockets.size === 0) {
      session!.cleanupTimer = setTimeout(() => {
        sessions.delete(sessionId);
        console.log(`[game_session:${sessionId}] cleaned up after grace period`);
        db.update(gameSessions)
          .set({ status: 'completed' })
          .where(eq(gameSessions.id, sessionId))
          .catch((err) => console.error('failed to close game_session', sessionId, err));
      }, CLEANUP_GRACE_MS);
    }
  });
});
