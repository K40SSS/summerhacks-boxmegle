import type { Server } from 'http';
import { WebSocketServer } from 'ws';
import { ExpressPeerServer } from 'peer';

// ExpressPeerServer normally attaches its own WebSocketServer directly to
// the shared httpServer's 'upgrade' event, which rejects (400) any upgrade
// whose path it doesn't own -- that would swallow our /game_session
// upgrades too. `createWebSocketServer` lets us build it in `noServer`
// mode instead, so we can dispatch upgrades to it ourselves in index.ts.
export function createPeerServer(httpServer: Server) {
  const peerSocketServer = new WebSocketServer({ noServer: true });

  const peerServer = ExpressPeerServer(httpServer, {
    path: '/',
    allow_discovery: false,
    createWebSocketServer: () => peerSocketServer,
  });

  return { peerServer, peerSocketServer };
}
