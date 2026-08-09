/**
 * Authoritative combat resolution — pure functions, no timers, no transport.
 *
 * A server owns the match loop and player state; this module answers the
 * rules questions deterministically so client and server can never disagree
 * about what a punch does. Clients send semantic actions (see DetectedAction)
 * and NEVER damage numbers.
 */

import { GAME_RULES, PUNCH_STATS, clamp, punchMisses } from "./rules";
import type { PunchType } from "./types";

/** The defender's state at the instant a punch arrives. */
export interface DefenderSnapshot {
  health: number;
  block: number;
  blocking: boolean;
  stunned: boolean;
  dodging: boolean;
  /** Whole-body offset from neutral, body frame, shoulder widths. */
  dodgeOffsetX: number;
  dodgeOffsetY: number;
}

export type PunchResult = "HIT" | "BLOCKED" | "GUARD_BREAK" | "MISS";

export interface PunchOutcome {
  result: PunchResult;
  /**
   * NOMINAL damage of the punch (0 unless HIT). The reference server counts
   * this full value toward damageDealt/damageReceived even when health
   * clamps at 0 — do not recompute it as `health - defenderHealthAfter`.
   */
  healthDamage: number;
  /** Damage applied to the block meter (0 unless BLOCKED/GUARD_BREAK). */
  guardDamage: number;
  defenderHealthAfter: number;
  defenderBlockAfter: number;
  /**
   * True when the guard broke. The server must then: put the defender in
   * STUNNED for GAME_RULES.stunDurationMs, CLEAR their blocking AND dodging
   * flags (a fresh block-start/dodge-start is required afterwards), credit
   * the attacker one guardBreak (decision tiebreaker), and restart the
   * guard-regeneration delay clock.
   */
  stunsDefender: boolean;
}

/**
 * Resolve one punch against the defender's current state.
 *
 * Inputs must already be server-sanitized: clamp client-supplied impact and
 * dodge offsets to [-2.5, 2.5] (never trust client aim) and default a
 * missing aim to { x: 0, y: -0.7 } before calling.
 *
 * Order of rules:
 * 1. An evading (non-blocking, non-stunned) defender whose body moved away
 *    from the punch's impact point takes nothing — MISS.
 * 2. A blocking defender absorbs the punch on the guard meter; reaching zero
 *    breaks the guard and stuns (the breaking punch deals no health damage —
 *    the break itself is the opening).
 * 3. Otherwise the punch lands for its health damage.
 */
export function resolvePunch(
  punchType: PunchType,
  impact: { x: number; y: number },
  defender: DefenderSnapshot,
): PunchOutcome {
  const stats = PUNCH_STATS[punchType];

  if (
    defender.dodging &&
    !defender.blocking &&
    !defender.stunned &&
    punchMisses(impact, { x: defender.dodgeOffsetX, y: defender.dodgeOffsetY })
  ) {
    return {
      result: "MISS",
      healthDamage: 0,
      guardDamage: 0,
      defenderHealthAfter: defender.health,
      defenderBlockAfter: defender.block,
      stunsDefender: false,
    };
  }

  if (defender.blocking && !defender.stunned) {
    const blockAfter = clamp(defender.block - stats.guardDamage, 0, GAME_RULES.maxBlock);
    const broke = blockAfter <= 0;
    return {
      result: broke ? "GUARD_BREAK" : "BLOCKED",
      healthDamage: 0,
      guardDamage: stats.guardDamage,
      defenderHealthAfter: defender.health,
      defenderBlockAfter: blockAfter,
      stunsDefender: broke,
    };
  }

  const healthAfter = clamp(defender.health - stats.healthDamage, 0, GAME_RULES.maxHealth);
  return {
    result: "HIT",
    healthDamage: stats.healthDamage,
    guardDamage: 0,
    defenderHealthAfter: healthAfter,
    defenderBlockAfter: defender.block,
    stunsDefender: false,
  };
}

export interface DrainOutcome {
  block: number;
  /**
   * True when this tick's drain emptied the meter. Draining to zero IS a
   * guard break — apply exactly the stunsDefender consequences from
   * PunchOutcome (stun, clear blocking/dodging, credit the OPPONENT a
   * guardBreak, restart the regen delay). Holding block at 0 forever must
   * not be possible.
   */
  guardBroke: boolean;
}

/** Passive guard drain while the block is held (per tick). */
export function drainBlock(block: number, dtMs: number): DrainOutcome {
  const after = clamp(block - (GAME_RULES.blockDrainPerSecond * dtMs) / 1000, 0, GAME_RULES.maxBlock);
  return { block: after, guardBroke: block > 0 && after <= 0 };
}

/**
 * Guard regeneration per tick. The server must gate this: no regeneration
 * while the defender is STUNNED (a broken guard exits stun at 0 block,
 * since stunDurationMs > blockRegenerationDelayMs), and the
 * blockRegenerationDelayMs clock restarts on every guard-damage
 * application and on block activity (block-start/end, drain ticks).
 */
export function regenerateBlock(block: number, dtMs: number): number {
  return clamp(
    block + (GAME_RULES.blockRegenerationPerSecond * dtMs) / 1000,
    0,
    GAME_RULES.maxBlock,
  );
}

/** Per-player totals a decision compares when nobody was knocked out. */
export interface DecisionStats {
  health: number;
  damageDealt: number;
  guardBreaks: number;
}

/**
 * End-of-match decision cascade: higher remaining health, then higher total
 * damage dealt, then more guard breaks, else a draw.
 */
export function decideWinner(a: DecisionStats, b: DecisionStats): "A" | "B" | "DRAW" {
  if (a.health !== b.health) return a.health > b.health ? "A" : "B";
  if (a.damageDealt !== b.damageDealt) return a.damageDealt > b.damageDealt ? "A" : "B";
  if (a.guardBreaks !== b.guardBreaks) return a.guardBreaks > b.guardBreaks ? "A" : "B";
  return "DRAW";
}
