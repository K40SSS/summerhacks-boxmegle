import http from 'http';
import express from 'express';
import { gameRouter } from './routes/game';
import { createPeerServer } from './peer';
import { gameSocketServer } from './ws/gameSession';

const app = express();
const port = process.env.PORT ?? 4000;
const httpServer = http.createServer(app);
const { peerServer, peerSocketServer } = createPeerServer(httpServer);

app.use(express.json());

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/peerjs', peerServer);
app.use(gameRouter);

// Both peer signaling and game-state websockets share this single
// httpServer/port; we dispatch the one 'upgrade' event by path ourselves.
httpServer.on('upgrade', (req, socket, head) => {
  const pathname = new URL(req.url ?? '', 'http://localhost').pathname;

  if (pathname === '/game_session') {
    gameSocketServer.handleUpgrade(req, socket, head, (ws) => {
      gameSocketServer.emit('connection', ws, req);
    });
    return;
  }

  if (pathname.startsWith('/peerjs')) {
    peerSocketServer.handleUpgrade(req, socket, head, (ws) => {
      peerSocketServer.emit('connection', ws, req);
    });
    return;
  }

  socket.destroy();
});

httpServer.listen(port, () => {
  console.log(`server listening on port ${port}`);
});
