/**
 * Authoritative combat resolution — pure functions, no timers, no transport.
 *
 * A server owns the match loop and player state; this module answers the
 * rules questions deterministically so client and server can never disagree
 * about what a punch does. Clients send semantic actions (see DetectedAction)
 * and NEVER damage numbers.
 */

import { GAME_RULES, PUNCH_STATS, ZONE_MULTIPLIERS, clamp } from "./rules";
import { canThrow } from "./stamina";
import type { HitZone } from "./hitbox";
import type { PunchType } from "./types";

/** The defender's state at the instant a punch arrives. */
export interface DefenderSnapshot {
  health: number;
  block: number;
  blocking: boolean;
  stunned: boolean;
}

/**
 * NO_STAMINA is a first-class result rather than the server silently
 * dropping the punch: the player really threw it, so the client must be able
 * to show them why nothing happened.
 */
export type PunchResult = "HIT" | "BLOCKED" | "GUARD_BREAK" | "MISS" | "NO_STAMINA";

export interface PunchOutcome {
  result: PunchResult;
  /** Where the punch connected, or null on a MISS. */
  zone: HitZone | null;
  /**
   * NOMINAL damage of the punch (0 unless HIT), already scaled by the zone
   * multiplier. The reference server counts this full value toward
   * damageDealt/damageReceived even when health clamps at 0 — do not
   * recompute it as `health - defenderHealthAfter`.
   */
  healthDamage: number;
  /** Damage applied to the block meter (0 unless BLOCKED/GUARD_BREAK). */
  guardDamage: number;
  defenderHealthAfter: number;
  defenderBlockAfter: number;
  /**
   * True when the guard broke. The server must then: put the defender in
   * STUNNED for GAME_RULES.stunDurationMs, CLEAR their blocking flag (a fresh
   * block-start is required afterwards), credit the attacker one guardBreak
   * (decision tiebreaker), and restart the guard-regeneration delay clock.
   */
  stunsDefender: boolean;
}

/**
 * Resolve one punch against the defender's current state.
 *
 * `zone` comes from `hitboxTest(impact, defenderPose)` — geometry the caller
 * computes from the defender's OWN streamed pose, never a flag the defender
 * asserts about themselves. A null zone means the punch found only air.
 *
 * The caller should still clamp client-supplied impact coordinates (a
 * plausible reach is roughly [-2.5, 2.5] shoulder widths) and default a
 * missing aim to { x: 0, y: -0.7 } before hit-testing.
 *
 * Order of rules:
 * 1. An empty attacker cannot throw at all — NO_STAMINA, nothing changes.
 *    Stamina is a hard gate: above zero every punch lands at full power, and
 *    at zero none do. It never scales damage.
 * 2. A punch that landed on no hitbox takes nothing — MISS. Evasion is
 *    geometric, so it applies regardless of blocking or stun: you cannot hit
 *    someone who is not there.
 * 3. A blocking defender absorbs the punch on the guard meter; reaching zero
 *    breaks the guard and stuns (the breaking punch deals no health damage —
 *    the break itself is the opening).
 * 4. Otherwise the punch lands for its health damage.
 *
 * Pass `attacker` to enforce the stamina gate. Omitting it resolves the punch
 * ungated, which is what the client's local prediction wants when it is only
 * asking "would this have landed?".
 */
export function resolvePunch(
  punchType: PunchType,
  zone: HitZone | null,
  defender: DefenderSnapshot,
  attacker?: { stamina: number },
): PunchOutcome {
  const stats = PUNCH_STATS[punchType];
  const guardDamage = stats.guardDamage;

  if (attacker && !canThrow(attacker.stamina)) {
    return {
      result: "NO_STAMINA",
      zone: null,
      healthDamage: 0,
      guardDamage: 0,
      defenderHealthAfter: defender.health,
      defenderBlockAfter: defender.block,
      stunsDefender: false,
    };
  }

  if (zone === null) {
    return {
      result: "MISS",
      zone: null,
      healthDamage: 0,
      guardDamage: 0,
      defenderHealthAfter: defender.health,
      defenderBlockAfter: defender.block,
      stunsDefender: false,
    };
  }

  if (defender.blocking && !defender.stunned) {
    const blockAfter = clamp(defender.block - guardDamage, 0, GAME_RULES.maxBlock);
    const broke = blockAfter <= 0;
    return {
      result: broke ? "GUARD_BREAK" : "BLOCKED",
      zone,
      healthDamage: 0,
      guardDamage,
      defenderHealthAfter: defender.health,
      defenderBlockAfter: blockAfter,
      stunsDefender: broke,
    };
  }

  const healthDamage = stats.healthDamage * ZONE_MULTIPLIERS[zone];
  const healthAfter = clamp(defender.health - healthDamage, 0, GAME_RULES.maxHealth);
  return {
    result: "HIT",
    zone,
    healthDamage,
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
   * PunchOutcome (stun, clear blocking, credit the OPPONENT a guardBreak,
   * restart the regen delay). Holding block at 0 forever must not be
   * possible.
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
