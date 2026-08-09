/**
 * Stamina — the punch-output budget. Pure functions, server-authoritative,
 * same pattern as the block meter in combat.ts.
 *
 * Every punch spends stamina (PUNCH_STATS[type].staminaCost — jabs cheap,
 * hooks/uppercuts expensive). A punch is NEVER rejected for lack of stamina:
 * in a camera game the player really threw it, so an unaffordable punch
 * lands as a "tired" punch at tiredPunchDamageMultiplier instead (pass
 * `tired` to resolvePunch). Emptying the tank makes the fighter "winded" —
 * regeneration takes staminaWindedDelayMs (1.2s) to start instead of the
 * usual staminaRegenDelayMs (0.5s).
 *
 * Server loop contract:
 * - On every ACCEPTED punch: `spendStamina`, store the new value, and
 *   restart the regen clock for `staminaRecoveryDelayMs(newValue)`.
 * - Per tick, once the delay has passed: `regenerateStamina`.
 * - The delay anchors on the last spend only — blocking, dodging and stun
 *   do not gate stamina regeneration.
 */

import { GAME_RULES, PUNCH_STATS, clamp } from "./rules";
import type { PunchType } from "./types";

export interface SpendOutcome {
  /** Stamina after the spend (never below 0). */
  stamina: number;
  /**
   * True when the punch could not be fully afforded — apply
   * tiredPunchDamageMultiplier by passing { tired: true } to resolvePunch.
   */
  tired: boolean;
  /**
   * True when this spend emptied the tank. Restart the regen clock with the
   * longer winded delay (staminaRecoveryDelayMs already handles this).
   */
  winded: boolean;
}

/** Spend the stamina cost of one punch. */
export function spendStamina(stamina: number, punchType: PunchType): SpendOutcome {
  const cost = PUNCH_STATS[punchType].staminaCost;
  const tired = stamina < cost;
  const after = clamp(stamina - cost, 0, GAME_RULES.maxStamina);
  return { stamina: after, tired, winded: stamina > 0 && after <= 0 };
}

/**
 * How long after a spend regeneration may begin, given the meter's value
 * right after that spend: 1.2s when winded (at zero), 0.5s otherwise.
 */
export function staminaRecoveryDelayMs(stamina: number): number {
  return stamina <= 0 ? GAME_RULES.staminaWindedDelayMs : GAME_RULES.staminaRegenDelayMs;
}

/** Stamina regeneration per tick, once the recovery delay has passed. */
export function regenerateStamina(stamina: number, dtMs: number): number {
  return clamp(
    stamina + (GAME_RULES.staminaRegenPerSecond * dtMs) / 1000,
    0,
    GAME_RULES.maxStamina,
  );
}
