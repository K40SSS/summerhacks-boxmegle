/**
 * Stamina — the punch-output budget. Pure functions, server-authoritative,
 * same pattern as the block meter in combat.ts.
 *
 * Stamina is a HARD GATE, not a damage modifier. Every punch spends stamina
 * (PUNCH_STATS[type].staminaCost — jabs cheap, hooks/uppercuts expensive) and
 * lands at full power. At zero you cannot throw at all until the meter comes
 * back; emptying the tank makes the fighter "winded", so regeneration takes
 * staminaWindedDelayMs (1.2s) to start instead of the usual
 * staminaRegenDelayMs (0.5s).
 *
 * The gate is self-enforcing: a player who spams cannot out-damage one who
 * paces, because spamming simply stops. That is why there is no tired-punch
 * damage multiplier to balance against the attack cooldown.
 *
 * IMPORTANT — a blocked punch must never be silent. The player physically
 * threw it, so if the server drops it without a word the game reads as
 * broken. `resolvePunch` returns `NO_STAMINA` for exactly this reason: it is
 * a result the client is forced to handle, not an absence of one.
 *
 * Server loop contract:
 * - Before accepting a punch: `canThrow(stamina)`. If false, resolve it (the
 *   result will be NO_STAMINA) and tell the client — do not drop it.
 * - On every ACCEPTED punch: `spendStamina`, store the new value, and
 *   restart the regen clock for `staminaRecoveryDelayMs(newValue)`.
 * - Per tick, once the delay has passed: `regenerateStamina`.
 * - The delay anchors on the last spend only — blocking and stun do not gate
 *   stamina regeneration.
 */

import { GAME_RULES, PUNCH_STATS, clamp } from "./rules";
import type { PunchType } from "./types";

/**
 * Can this fighter throw at all? Stamina gates on being empty, not on
 * affording a specific punch — so your last few points always buy one more
 * punch, whatever it is, and then you are locked out until you recover.
 */
export function canThrow(stamina: number): boolean {
  return stamina > 0;
}

export interface SpendOutcome {
  /** Stamina after the spend (never below 0). */
  stamina: number;
  /**
   * True when this spend emptied the tank. Restart the regen clock with the
   * longer winded delay (staminaRecoveryDelayMs already handles this), and
   * expect the next punch to be gated until the meter recovers.
   */
  winded: boolean;
}

/** Spend the stamina cost of one punch. Costs may overdraw to zero. */
export function spendStamina(stamina: number, punchType: PunchType): SpendOutcome {
  const cost = PUNCH_STATS[punchType].staminaCost;
  const after = clamp(stamina - cost, 0, GAME_RULES.maxStamina);
  return { stamina: after, winded: stamina > 0 && after <= 0 };
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
