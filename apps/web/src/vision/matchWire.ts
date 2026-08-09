/**
 * Client-side twin of the server's match-loop wire messages
 * (apps/server/ws/matchState.ts + gameSession.ts). `apps/server` and
 * `apps/web` are separate workspaces with no cross-import, so these types
 * are hand-duplicated to match the server's shapes exactly rather than
 * imported.
 */

export type MatchPhase = "WAITING" | "FIRST_HALF" | "HALFTIME" | "SECOND_HALF" | "ENDED";

export interface PlayerStateWire {
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

export type MatchStateEvent =
  | {
      kind: "punch";
      attackerUuid: string;
      defenderUuid: string;
      punchType: string;
      hand: string;
      result: string;
      zone: string | null;
      healthDamage: number;
      guardDamage: number;
      /** Impact point in the DEFENDER's body frame (shoulder widths, +y down). */
      impactX: number;
      impactY: number;
    }
  | { kind: "guard-break"; playerUuid: string }
  | { kind: "block-start" | "block-end"; playerUuid: string };

export interface MatchStateMessage {
  type: "match-state";
  now: number;
  matchStartedAt: number | null;
  phase: MatchPhase;
  timeLeftMs: number;
  players: PlayerStateWire[];
  lastEvent?: MatchStateEvent;
}

export interface MatchEndMessage {
  type: "match-end";
  reason: "KO" | "DECISION" | "DRAW";
  winnerUuid: string | null;
  durationMs: number;
  players: PlayerStateWire[];
}
