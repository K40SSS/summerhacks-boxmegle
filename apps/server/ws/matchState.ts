/**
 * The in-memory match state — one of these per session, holding both
 * fighters for as long as the session lives.
 *
 * Per player it owns exactly what the loop needs to answer a question about
 * them: the authoritative `PlayerState` (health, guard, stamina, and the
 * deadlines that drive them) and the `PlayerIngest` carrying their latest
 * pose and detector FSMs. Those two live together because resolving a punch
 * needs both — the attacker's action and the DEFENDER's pose.
 *
 * ## One clock, shared
 *
 * `advance` takes a single match-wide `now` from monotonic server time and
 * settles both fighters against it. It must not be driven from a
 * DetectedAction's timestamp: those are paced by each client's own camera and
 * the two streams can sit a second apart, so one player's frame would drag
 * the other's meters around. The per-client clock exists only to keep frame
 * spacing honest for velocity extraction — see poseIngest.ts.
 *
 * There is no tick. Every mutating path advances first, which is what keeps
 * a lazily-integrated meter indistinguishable from a ticked one.
 */

import {
  advanceMatch,
  advanceTo,
  applyPunch,
  decideWinner,
  endBlock,
  GAME_RULES,
  initialPlayerState,
  startBlock,
  type DetectedAction,
  type PlayerState,
  type PunchAction,
  type ResolvedPunch,
  type Slot,
} from 'game-mechanics';
import { PlayerIngest } from './poseIngest';

export interface MatchPlayer {
  readonly playerUuid: string;
  readonly state: PlayerState;
  readonly ingest: PlayerIngest;
}

export type MatchPhase = 'WAITING' | 'FIRST_HALF' | 'HALFTIME' | 'SECOND_HALF' | 'ENDED';

export interface MatchEndResult {
  reason: 'KO' | 'DECISION' | 'DRAW';
  winnerUuid: string | null;
  durationMs: number;
  players: MatchPlayer[];
}

// Cumulative elapsed-time thresholds (ms since matchStartedAt) at which the
// match transitions phase.
const HALFTIME_AT_MS = GAME_RULES.firstHalfDurationMs;
const SECOND_HALF_AT_MS = GAME_RULES.firstHalfDurationMs + GAME_RULES.halftimeDurationMs;
const MATCH_END_AT_MS = SECOND_HALF_AT_MS + GAME_RULES.secondHalfDurationMs;

export interface MatchAdvanceLog {
  /** Fighters whose guard drained to zero during this advance. */
  guardBroke: MatchPlayer[];
  /** Fighters whose stun expired during this advance. */
  stunEnded: MatchPlayer[];
}

export class MatchState {
  private readonly playersByUuid = new Map<string, MatchPlayer>();
  private matchStartedAtValue: number | null = null;
  private phaseValue: MatchPhase = 'WAITING';

  get matchStartedAt(): number | null {
    return this.matchStartedAtValue;
  }

  get phase(): MatchPhase {
    return this.phaseValue;
  }

  /**
   * Idempotent — a reconnect inside the grace window finds its existing
   * fighter, keeping meters, deadlines and detector state intact. Returns
   * null if a third uuid turns up for a two-player session.
   */
  join(playerUuid: string, now: number): MatchPlayer | null {
    const existing = this.playersByUuid.get(playerUuid);
    if (existing) return existing;
    if (this.playersByUuid.size >= 2) return null;

    const player: MatchPlayer = {
      playerUuid,
      state: initialPlayerState(playerUuid, this.playersByUuid.size as Slot, now),
      ingest: new PlayerIngest(playerUuid),
    };
    this.playersByUuid.set(playerUuid, player);

    if (this.playersByUuid.size === 2) {
      this.matchStartedAtValue = now;
      this.phaseValue = 'FIRST_HALF';
    }

    return player;
  }

  /**
   * Refresh `phase` against the clock. FIRST_HALF -> HALFTIME -> SECOND_HALF
   * on the cumulative thresholds; ENDED is only ever set by `checkMatchEnd`,
   * never rolled back here.
   */
  private updatePhase(now: number): void {
    if (this.matchStartedAtValue === null || this.phaseValue === 'ENDED') return;
    const elapsed = now - this.matchStartedAtValue;
    if (elapsed >= SECOND_HALF_AT_MS) {
      this.phaseValue = 'SECOND_HALF';
    } else if (elapsed >= HALFTIME_AT_MS) {
      this.phaseValue = 'HALFTIME';
    } else {
      this.phaseValue = 'FIRST_HALF';
    }
  }

  /** Milliseconds left in the current phase's clock segment. 0 before start or after end. */
  timeLeftMs(now: number): number {
    if (this.matchStartedAtValue === null || this.phaseValue === 'ENDED') return 0;
    this.updatePhase(now);
    const elapsed = now - this.matchStartedAtValue;
    switch (this.phaseValue) {
      case 'FIRST_HALF':
        return Math.max(0, HALFTIME_AT_MS - elapsed);
      case 'HALFTIME':
        return Math.max(0, SECOND_HALF_AT_MS - elapsed);
      case 'SECOND_HALF':
        return Math.max(0, MATCH_END_AT_MS - elapsed);
      default:
        return 0;
    }
  }

  /**
   * End-of-match check. Idempotent — returns null immediately once ENDED, so
   * this can be called every frame without double-firing a result.
   */
  checkMatchEnd(now: number): MatchEndResult | null {
    if (this.phaseValue === 'ENDED') return null;
    if (this.matchStartedAtValue === null) return null;

    this.updatePhase(now);

    const players = this.players();
    if (players.length < 2) return null;
    const [a, b] = players;
    const durationMs = now - this.matchStartedAtValue;

    const aDown = a.state.health <= 0;
    const bDown = b.state.health <= 0;

    if (aDown || bDown) {
      this.phaseValue = 'ENDED';
      if (aDown && bDown) {
        const verdict = decideWinner(a.state, b.state);
        return {
          reason: verdict === 'DRAW' ? 'DRAW' : 'KO',
          winnerUuid: verdict === 'DRAW' ? null : verdict === 'A' ? a.playerUuid : b.playerUuid,
          durationMs,
          players,
        };
      }
      const winner = aDown ? b : a;
      return { reason: 'KO', winnerUuid: winner.playerUuid, durationMs, players };
    }

    if (durationMs >= MATCH_END_AT_MS) {
      this.phaseValue = 'ENDED';
      const verdict = decideWinner(a.state, b.state);
      return {
        reason: verdict === 'DRAW' ? 'DRAW' : 'DECISION',
        winnerUuid: verdict === 'DRAW' ? null : verdict === 'A' ? a.playerUuid : b.playerUuid,
        durationMs,
        players,
      };
    }

    return null;
  }

  get(playerUuid: string): MatchPlayer | undefined {
    return this.playersByUuid.get(playerUuid);
  }

  /** Both fighters, in join order (index 0 = slot 0, index 1 = slot 1). */
  players(): MatchPlayer[] {
    return [...this.playersByUuid.values()];
  }

  opponentOf(playerUuid: string): MatchPlayer | undefined {
    for (const [uuid, player] of this.playersByUuid) {
      if (uuid !== playerUuid) return player;
    }
    return undefined;
  }

  get size(): number {
    return this.playersByUuid.size;
  }

  /**
   * Step 2 — settle every time-based meter up to `now`. Call before anything
   * reads or writes a fighter's guard, stamina or stun.
   */
  advance(now: number): MatchAdvanceLog {
    const log: MatchAdvanceLog = { guardBroke: [], stunEnded: [] };
    const [a, b] = [...this.playersByUuid.values()];

    if (a && b) {
      const out = advanceMatch(a.state, b.state, now);
      if (out.a.guardBroke) log.guardBroke.push(a);
      if (out.b.guardBroke) log.guardBroke.push(b);
      if (out.a.stunEnded) log.stunEnded.push(a);
      if (out.b.stunEnded) log.stunEnded.push(b);
      return log;
    }

    // Solo — one fighter warming up before the other connects. No opponent to
    // credit a guard break to, so advanceMatch's cross-credit is skipped.
    if (a) {
      const out = advanceTo(a.state, now);
      if (out.guardBroke) log.guardBroke.push(a);
      if (out.stunEnded) log.stunEnded.push(a);
    }
    return log;
  }

  /**
   * Fold this frame's block edges into the fighter's state.
   *
   * `now` is the match clock, deliberately not `action.timestamp` — see the
   * clock note above. The caller must have advanced to `now` already, so that
   * the interval before the edge is billed to the meter that was actually
   * running.
   *
   * Returns the edges that changed something; a BLOCK_START refused because
   * the fighter is stunned is dropped here.
   */
  applyBlockEdges(player: MatchPlayer, actions: DetectedAction[], now: number): DetectedAction[] {
    const applied: DetectedAction[] = [];
    for (const action of actions) {
      if (action.type === 'BLOCK_START' && startBlock(player.state, now)) {
        applied.push(action);
      } else if (action.type === 'BLOCK_END' && endBlock(player.state, now)) {
        applied.push(action);
      }
    }
    return applied;
  }

  /**
   * Step 3 — resolve this frame's punches against the opponent.
   *
   * The two things a punch reads both come from the DEFENDER: their latest
   * pose decides whether it connected at all, and their state decides what it
   * did. Neither is anything the attacker asserts.
   *
   * Requires `advance(now)` to have run first, so the guard and stun the
   * punch resolves against are the ones that exist at `now`.
   *
   * Punches thrown before an opponent joins are dropped: there is nobody to
   * hit, and charging stamina for shadowboxing into an empty session would
   * leave the fighter gassed when the match actually starts.
   */
  resolvePunches(attacker: MatchPlayer, actions: DetectedAction[], now: number): PunchResolution[] {
    const defender = this.opponentOf(attacker.playerUuid);
    if (!defender) return [];

    const resolutions: PunchResolution[] = [];
    for (const action of actions) {
      if (action.type !== 'PUNCH') continue;
      resolutions.push({
        punch: action,
        defender,
        resolved: applyPunch(
          attacker.state,
          defender.state,
          defender.ingest.pose,
          action,
          now,
        ),
      });
    }
    return resolutions;
  }
}

export interface PunchResolution {
  punch: PunchAction;
  defender: MatchPlayer;
  resolved: ResolvedPunch;
}

/** One-line rendering of a resolved punch, for session logs. */
export function describeResolution({ punch, defender, resolved }: PunchResolution): string {
  const { outcome } = resolved;
  const where = outcome.zone ? ` ${outcome.zone}` : '';
  const damage = outcome.healthDamage > 0 ? ` -${outcome.healthDamage.toFixed(1)}hp` : '';
  const guard = outcome.guardDamage > 0 ? ` -${outcome.guardDamage}guard` : '';
  return `${punch.punchType} ${punch.hand} → ${outcome.result}${where}${damage}${guard} | ${defender.playerUuid} ${summarize(defender.state)}`;
}

/** Compact meter readout for session logs. */
export function summarize(state: PlayerState): string {
  const meters = `hp=${state.health.toFixed(0)} block=${state.block.toFixed(0)} stam=${state.stamina.toFixed(0)}`;
  return `${meters} blocking=${state.blocking} stunned=${state.stunned}`;
}
