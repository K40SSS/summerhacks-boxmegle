import type { IncomingMessage } from 'http';
import { WebSocketServer, type WebSocket } from 'ws';
import { eq } from 'drizzle-orm';
import { db } from 'db/client';
import { gameSessions } from 'db/schema';
import { describeAction, parsePoseMessage } from './poseIngest';
import {
  MatchState,
  describeResolution,
  summarize,
  type MatchPhase,
  type MatchPlayer,
} from './matchState';

interface PlayerStateWire {
  playerUuid: string;
  slot: 0 | 1;
  health: number;
  block: number;
  stamina: number;
  blocking: boolean;
  stunned: boolean;
  damageDealt: number;
  guardBreaks: number;
}

type MatchStateEvent =
  | {
      kind: 'punch';
      attackerUuid: string;
      defenderUuid: string;
      punchType: string;
      hand: string;
      result: string;
      zone: string | null;
      healthDamage: number;
      guardDamage: number;
    }
  | { kind: 'guard-break'; playerUuid: string }
  | { kind: 'block-start' | 'block-end'; playerUuid: string };

interface MatchStateMessage {
  type: 'match-state';
  now: number;
  matchStartedAt: number | null;
  phase: MatchPhase;
  timeLeftMs: number;
  players: PlayerStateWire[];
  lastEvent?: MatchStateEvent;
}

function toPlayerStateWire(player: MatchPlayer): PlayerStateWire {
  const { state, playerUuid } = player;
  return {
    playerUuid,
    slot: state.slot,
    health: state.health,
    block: state.block,
    stamina: state.stamina,
    blocking: state.blocking,
    stunned: state.stunned,
    damageDealt: state.damageDealt,
    guardBreaks: state.guardBreaks,
  };
}

type Session = {
  sockets: Map<string, WebSocket>; // playerUuid -> socket
  ready: Set<string>; // playerUuids that have sent peer-ready
  // Both fighters' authoritative state and pose pipelines. Keyed by player
  // rather than by socket so a reconnect inside the grace window keeps its
  // meters, deadlines, punch cooldowns and guard hysteresis instead of
  // starting from a blank FSM with full health.
  match: MatchState;
  cleanupTimer: NodeJS.Timeout | null;
};

// Detected actions are rare enough to log individually; frames get a periodic summary.
const FRAME_LOG_INTERVAL = 150;

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
    session = {
      sockets: new Map(),
      ready: new Set(),
      match: new MatchState(),
      cleanupTimer: null,
    };
    sessions.set(sessionId, session);
  }
  if (session.cleanupTimer) {
    clearTimeout(session.cleanupTimer);
    session.cleanupTimer = null;
    console.log(`[game_session:${sessionId}] cancelled pending cleanup, ${playerUuid} reconnected`);
  }
  // Claim a fighter slot before registering the socket, so a third uuid is
  // turned away instead of landing in the socket map with nowhere to fight.
  const joined = session.match.join(playerUuid, performance.now());
  if (!joined) {
    console.warn(`[game_session:${sessionId}] rejected ${playerUuid}, session already has two fighters`);
    socket.close(4001, 'session is full');
    return;
  }

  session.sockets.set(playerUuid, socket);
  console.log(
    `[game_session:${sessionId}] ${playerUuid} connected as slot ${joined.state.slot} (${session.sockets.size}/2 in session)`,
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

    // Step 1 — ingest. Pose frames terminate here: they are the server's
    // input, not something the opponent needs. The peer renders from the
    // authoritative snapshot (step 4), so relaying raw landmarks on would
    // double the session's bandwidth to say the same thing twice.
    const pose = parsePoseMessage(parsed);
    if (pose) {
      const player = session!.match.get(playerUuid);
      if (!player) return;

      // One reading of the clock for the whole frame: the ingest stamp and
      // the advance have to describe the same instant.
      const now = performance.now();
      const frame = player.ingest.handle(pose, now);
      if (!frame) return;

      // Step 2 — settle both fighters' meters BEFORE anything reads them. A
      // guard that drained to zero since the last frame is broken here, not
      // on some later tick, so the block edges below and (step 3) the punch
      // resolution see the state as it truly is at `now`.
      const advanced = session!.match.advance(now);
      for (const broken of advanced.guardBroke) {
        console.log(
          `[game_session:${sessionId}] ${broken.playerUuid} GUARD_BREAK (drained) ${summarize(broken.state)}`,
        );
      }
      for (const recovered of advanced.stunEnded) {
        console.log(`[game_session:${sessionId}] ${recovered.playerUuid} stun expired`);
      }

      // Block edges first: they are state, and a guard raised or dropped on
      // this frame has to be in place before anything resolves against it.
      const applied = session!.match.applyBlockEdges(player, frame.actions, now);
      for (const action of applied) {
        console.log(
          `[game_session:${sessionId}] ${playerUuid} ${describeAction(action)} ${summarize(player.state)}`,
        );
      }

      // Step 3 — resolve this frame's punches against the opponent's pose
      // and state.
      const resolutions = session!.match.resolvePunches(player, frame.actions, now);
      for (const resolution of resolutions) {
        console.log(
          `[game_session:${sessionId}] ${playerUuid} ${describeResolution(resolution)}`,
        );
      }

      const { accepted, dropped } = player.ingest.stats;
      if (accepted % FRAME_LOG_INTERVAL === 0) {
        console.log(
          `[game_session:${sessionId}] ${playerUuid} frames accepted=${accepted} dropped=${dropped} ${summarize(player.state)}`,
        );
      }

      // Step 4 — broadcast the authoritative snapshot to both sockets, so
      // each client's HUD reflects real match state rather than a guess.
      // Priority for the single-event summary: a punch is the most
      // informative thing that can happen on a frame, then a guard break,
      // then a block edge.
      let lastEvent: MatchStateEvent | undefined;
      const punchResolution = resolutions[0];
      if (punchResolution) {
        lastEvent = {
          kind: 'punch',
          attackerUuid: playerUuid,
          defenderUuid: punchResolution.defender.playerUuid,
          punchType: punchResolution.punch.punchType,
          hand: punchResolution.punch.hand,
          result: punchResolution.resolved.outcome.result,
          zone: punchResolution.resolved.outcome.zone,
          healthDamage: punchResolution.resolved.outcome.healthDamage,
          guardDamage: punchResolution.resolved.outcome.guardDamage,
        };
      } else if (advanced.guardBroke.length > 0) {
        lastEvent = { kind: 'guard-break', playerUuid: advanced.guardBroke[0].playerUuid };
      } else {
        const blockEdge = applied.find((a) => a.type === 'BLOCK_START' || a.type === 'BLOCK_END');
        if (blockEdge) {
          lastEvent = {
            kind: blockEdge.type === 'BLOCK_START' ? 'block-start' : 'block-end',
            playerUuid,
          };
        }
      }

      const matchStateMessage: MatchStateMessage = {
        type: 'match-state',
        now,
        matchStartedAt: session!.match.matchStartedAt,
        phase: session!.match.phase,
        timeLeftMs: session!.match.timeLeftMs(now),
        players: session!.match.players().map(toPlayerStateWire),
        ...(lastEvent ? { lastEvent } : {}),
      };
      const matchStatePayload = JSON.stringify(matchStateMessage);
      for (const [, peerSocket] of session!.sockets) {
        if (peerSocket.readyState === peerSocket.OPEN) peerSocket.send(matchStatePayload);
      }

      // Step 5 — end-of-match check. Idempotent, so calling it every frame is
      // fine; it only ever fires once.
      const ended = session!.match.checkMatchEnd(now);
      if (ended) {
        const endMessage = {
          type: 'match-end',
          reason: ended.reason,
          winnerUuid: ended.winnerUuid,
          durationMs: ended.durationMs,
          players: ended.players.map(toPlayerStateWire),
        };
        const endPayload = JSON.stringify(endMessage);
        for (const [, peerSocket] of session!.sockets) {
          if (peerSocket.readyState === peerSocket.OPEN) peerSocket.send(endPayload);
        }
        console.log(
          `[game_session:${sessionId}] match ended: ${ended.reason}, winner=${ended.winnerUuid ?? 'draw'}`,
        );
      }

      return;
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
