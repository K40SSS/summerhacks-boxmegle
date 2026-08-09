/**
 * Shared game constants and pure rule functions.
 *
 * Define these once; every runtime (browser client, authoritative server)
 * imports the same values. Clients use them only for presentation — the
 * server decides real outcomes via combat.ts.
 */

import type { PunchType } from "./types";

export const GAME_RULES = {
  maxHealth: 100,
  maxBlock: 100,

  firstHalfDurationMs: 60_000,
  halftimeDurationMs: 15_000,
  secondHalfDurationMs: 60_000,

  blockDrainPerSecond: 8,
  blockRegenerationPerSecond: 15,
  blockRegenerationDelayMs: 800,

  stunDurationMs: 2_250,

  blockEnterMs: 150,
  blockExitMs: 100,

  perHandCooldownMs: 400,
  globalAttackCooldownMs: 250,

  minPunchConfidence: 0.65,

  // Dodge resolution: a punch misses when the defender's whole-body offset
  // moved their head/torso away from the punch's predicted impact point.
  // Distances in shoulder widths.
  dodgeMissLateral: 0.7,
  dodgeDuckOffsetY: 0.35,
  dodgeDuckImpactY: -0.5,
  /** A dodge cannot be held longer than this — enforced on BOTH sides. */
  dodgeMaxHoldMs: 900,
} as const;

/** Normal attack table. */
export const PUNCH_STATS: Record<
  PunchType,
  { healthDamage: number; guardDamage: number; label: string }
> = {
  JAB: { healthDamage: 4, guardDamage: 12, label: "Jab" },
  CROSS: { healthDamage: 6, guardDamage: 16, label: "Cross" },
  HOOK: { healthDamage: 8, guardDamage: 20, label: "Hook" },
  UPPERCUT: { healthDamage: 9, guardDamage: 22, label: "Uppercut" },
};

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Dodge resolution: does a punch aimed at `impact` miss a defender whose
 * body is displaced by `dodge` from its neutral anchor? Both are in the
 * defender's body frame, in shoulder widths. A punch misses when the
 * defender slipped far enough sideways from the impact line, or ducked
 * under a head-height punch.
 */
export function punchMisses(
  impact: { x: number; y: number },
  dodge: { x: number; y: number },
): boolean {
  const lateralMiss = Math.abs(impact.x - dodge.x) > GAME_RULES.dodgeMissLateral;
  const duckMiss =
    dodge.y > GAME_RULES.dodgeDuckOffsetY && impact.y < GAME_RULES.dodgeDuckImpactY;
  return lateralMiss || duckMiss;
}

/** Basic Elo with K = 32. */
export function eloExpected(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

export function eloUpdate(
  rating: number,
  expected: number,
  actualScore: 0 | 0.5 | 1,
): number {
  return Math.round(rating + 32 * (actualScore - expected));
}
