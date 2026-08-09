import { allowedOrigins } from "./env";
import http from "http";
import express from "express";
import { gameRouter } from "./routes/game";
import { queueRouter, startMatchmakerWorker } from "./routes/queue";
import { createPeerServer } from "./peer";
import { gameSocketServer } from "./ws/gameSession";

process.on("uncaughtException", (err) => {
  console.error("uncaughtException", err);
});
process.on("unhandledRejection", (err) => {
  console.error("unhandledRejection", err);
});

const app = express();
const port = Number(process.env.PORT ?? 4000);
const httpServer = http.createServer(app);
const { peerServer, peerSocketServer } = createPeerServer(httpServer);

app.use(express.json());

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/peerjs", peerServer);
app.use(gameRouter);
app.use(queueRouter);

// Both peer signaling and game-state websockets share this single
// httpServer/port; we dispatch the one 'upgrade' event by path ourselves.
httpServer.on("upgrade", (req, socket, head) => {
  const pathname = new URL(req.url ?? "", "http://localhost").pathname;

  if (pathname === "/game_session") {
    gameSocketServer.handleUpgrade(req, socket, head, (ws) => {
      gameSocketServer.emit("connection", ws, req);
    });
    return;
  }

  if (pathname.startsWith("/peerjs")) {
    peerSocketServer.handleUpgrade(req, socket, head, (ws) => {
      peerSocketServer.emit("connection", ws, req);
    });
    return;
  }

  socket.destroy();
});

httpServer.listen(port, "0.0.0.0", () => {
  console.log(`server listening on port ${port}`);
  startMatchmakerWorker();
});
