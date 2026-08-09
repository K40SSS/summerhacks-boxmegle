/**
 * Step 3 of the match loop: settle one punch against the fighter it was
 * thrown at, and write both sides of the result.
 *
 * `combat.ts` answers the rules question purely — given a zone and a
 * snapshot, what does this punch do? This module is the other half the
 * reference server owns: sanitizing the aim, hit-testing it against the
 * DEFENDER's own pose, applying the outcome to both PlayerStates, and paying
 * the stamina. Keeping it here rather than in the socket handler means the
 * order-sensitive parts are tested instead of re-derived.
 *
 * ## Preconditions the caller owes this function
 *
 * Both fighters must already be advanced to `now` (step 2). `resolvePunch`
 * reads `defender.blocking`, `defender.stunned` and `defender.block`, and all
 * three are only true-at-`now` after `advanceTo` has settled them. Resolving
 * against un-advanced state lands punches on guards that already collapsed.
 *
 * ## Order that matters
 *
 * Resolve BEFORE spending. The stamina gate has to read the meter the punch
 * was thrown with, not the meter after paying for it — otherwise the punch
 * that empties the tank gates itself.
 *
 * ## Evasion is geometry
 *
 * There is no dodge to honour and nothing to trust: `hitboxTest` asks whether
 * the fist's endpoint landed inside the defender's head or torso, using the
 * pose the defender's own camera produced. Missing pose means the defender
 * cannot be located at all, which reads as a MISS — see the note there.
 */

import { applyGuardBreak } from "./advance";
import { resolvePunch, type PunchOutcome } from "./combat";
import { hitboxTest, type HitboxOptions } from "./hitbox";
import type { PlayerState } from "./playerState";
import { GAME_RULES, clamp } from "./rules";
import { spendStamina, staminaRecoveryDelayMs } from "./stamina";
import type { DetectedAction, NormalizedPose } from "./types";

export type PunchAction = Extract<DetectedAction, { type: "PUNCH" }>;

/**
 * Plausible reach, in shoulder widths. Under the current architecture the
 * impact point comes from the server's own PunchDetector rather than a client
 * claim, so this is not guarding against a liar — it is guarding against
 * degenerate normalization. `normalizeLandmarks` divides by shoulder width,
 * so a player at the far edge of the frame can produce coordinates far
 * outside any real reach.
 */
export const MAX_IMPACT_REACH = 2.5;

/** Chest height — where a punch with no usable aim is assumed to go. */
export const DEFAULT_IMPACT = { x: 0, y: -0.7 } as const;

export interface ResolvedPunch {
  outcome: PunchOutcome;
  /** The aim actually used, after clamping and defaulting. */
  impact: { x: number; y: number };
  /** Whether the attacker paid for it. False only on NO_STAMINA. */
  spent: boolean;
}

function sanitizeImpact(punch: PunchAction): { x: number; y: number } {
  const axis = (value: number, fallback: number) =>
    Number.isFinite(value) ? clamp(value, -MAX_IMPACT_REACH, MAX_IMPACT_REACH) : fallback;

  return {
    x: axis(punch.impactX, DEFAULT_IMPACT.x),
    y: axis(punch.impactY, DEFAULT_IMPACT.y),
  };
}

/**
 * Resolve `punch` thrown by `attacker` at `defender`, mutating both.
 *
 * `defenderPose` is the defender's most recent smoothed pose. Pass null when
 * there isn't one: the punch then finds air. That is the lenient reading —
 * it means a fighter whose pose stream has stopped cannot be hit — so a
 * stalled stream needs handling as a connection problem, not here.
 */
export function applyPunch(
  attacker: PlayerState,
  defender: PlayerState,
  defenderPose: NormalizedPose | null,
  punch: PunchAction,
  now: number,
  hitboxOptions?: HitboxOptions,
): ResolvedPunch {
  const impact = sanitizeImpact(punch);
  const zone = defenderPose ? hitboxTest(impact, defenderPose, hitboxOptions) : null;

  const outcome = resolvePunch(punch.punchType, zone, defender, { stamina: attacker.stamina });

  // A gated punch changes nothing and costs nothing — but it is still a
  // result the client has to be told about, or the game reads as frozen.
  if (outcome.result === "NO_STAMINA") {
    return { outcome, impact, spent: false };
  }

  defender.health = outcome.defenderHealthAfter;
  defender.block = outcome.defenderBlockAfter;

  // Guard damage restarts the regen delay, so pressure on a guard keeps it
  // from recovering between punches.
  if (outcome.guardDamage > 0) {
    defender.blockRegenAt = now + GAME_RULES.blockRegenerationDelayMs;
  }

  // The NOMINAL damage, already zone-scaled — counted in full even when
  // health clamped at zero, so decideWinner's tiebreaker sees overkill.
  if (outcome.healthDamage > 0) {
    attacker.damageDealt += outcome.healthDamage;
  }

  if (outcome.stunsDefender) {
    applyGuardBreak(defender, now);
    attacker.guardBreaks += 1;
  }

  // Blocked and missed punches still cost stamina; only a gated one is free.
  const spend = spendStamina(attacker.stamina, punch.punchType);
  attacker.stamina = spend.stamina;
  attacker.staminaRegenAt = now + staminaRecoveryDelayMs(spend.stamina);

  return { outcome, impact, spent: true };
}
