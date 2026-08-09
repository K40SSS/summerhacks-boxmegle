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
    proxied: true,
    createWebSocketServer: () => peerSocketServer,
  });

  peerServer.on('connection', (client) => {
    console.log(`[peer] connected: ${client.getId()}`);
  });
  peerServer.on('disconnect', (client) => {
    console.log(`[peer] disconnected: ${client.getId()}`);
  });
  peerServer.on('message', (client, message) => {
    console.log(`[peer] message ${message.type} ${client.getId()} -> ${message.dst}`);
  });
  peerServer.on('error', (err) => {
    console.error('[peer] server error', err);
  });

  return { peerServer, peerSocketServer };
}
