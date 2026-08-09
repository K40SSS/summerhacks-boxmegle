/**
 * Shared game constants and pure rule functions.
 *
 * Define these once; every runtime (browser client, authoritative server)
 * imports the same values. Clients use them only for presentation — the
 * server decides real outcomes via combat.ts.
 */

import type { HitZone } from "./hitbox";
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

  // Stamina: every punch spends from a 100-point pool. Because each spend
  // restarts the regen-delay clock, the steady sustainable rate is
  // regen / (cost + regen × delay): ~1.1 jabs/s or ~0.8 hooks/s forever.
  // Faster output draws down the bank — a full bar funds a ~10-jab or
  // ~5-hook flurry — and emptying it locks you out of throwing until the
  // meter comes back (empty → full ≈ 5.2s worst case). Burst-and-breathe.
  //
  // Stamina does NOT scale damage. It is a hard gate: at zero you cannot
  // throw at all, and above zero every punch lands at full power. That makes
  // the meter self-enforcing — spamming does not out-damage pacing because
  // spamming simply stops — so no damage multiplier needs balancing against
  // the cooldown ceiling.
  maxStamina: 100,
  staminaRegenPerSecond: 25,
  /** Regen starts this long after the last spend… */
  staminaRegenDelayMs: 500,
  /** …but takes this long when the spend emptied the tank (winded). */
  staminaWindedDelayMs: 1_200,
} as const;

/** Normal attack table. */
export const PUNCH_STATS: Record<
  PunchType,
  { healthDamage: number; guardDamage: number; staminaCost: number; label: string }
> = {
  JAB: { healthDamage: 4, guardDamage: 12, staminaCost: 10, label: "Jab" },
  CROSS: { healthDamage: 6, guardDamage: 16, staminaCost: 14, label: "Cross" },
  HOOK: { healthDamage: 8, guardDamage: 20, staminaCost: 18, label: "Hook" },
  UPPERCUT: { healthDamage: 9, guardDamage: 22, staminaCost: 20, label: "Uppercut" },
};

/**
 * Health-damage multiplier by where the punch landed (see hitbox.ts).
 *
 * Applies to HEALTH damage only — guard damage is unchanged, so head-hunting
 * does not break a guard any faster than body work. That keeps guard-break
 * pacing exactly as tuned; move the multiplier into the BLOCKED branch of
 * resolvePunch if you want headshots to chew through guard as well.
 */
export const ZONE_MULTIPLIERS: Record<HitZone, number> = {
  HEAD: 1.5,
  BODY: 1,
};

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
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
