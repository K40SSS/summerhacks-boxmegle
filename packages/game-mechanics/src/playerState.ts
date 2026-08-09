/**
 * A player's full state for one match: identity plus everything
 * `combat.ts` needs to resolve a punch against them (`DefenderSnapshot`),
 * plus the running totals `decideWinner` compares when nobody is knocked out.
 *
 * This is a data shape, not a stateful class — the server owns the match
 * loop and holds one of these per player (see combat.ts's module doc), and
 * calls resolvePunch/drainBlock/regenerateBlock against it directly, since
 * PlayerState is structurally a DefenderSnapshot.
 *
 * ## Everything time-based is stored as a DEADLINE
 *
 * `stunnedUntil`, `blockRegenAt` and `staminaRegenAt` are absolute times on
 * the match clock, not countdowns, and `lastAdvancedAt` records how far the
 * meters have been integrated. That is what lets the server run without a
 * fixed tick: `advanceTo` brings a player up to any later instant in one
 * step, so time-based state is settled on demand — before a punch reads it —
 * rather than nudged forward 60 times a second. See advance.ts.
 */

import type { DefenderSnapshot } from "./combat";
import { GAME_RULES } from "./rules";

export type Slot = 0 | 1;

export interface PlayerState extends DefenderSnapshot {
  userUuid: string;
  slot: Slot;
  /**
   * Punch budget. At zero this fighter cannot throw (see canThrow) — stamina
   * gates output, it never scales damage.
   */
  stamina: number;
  /**
   * Match clock time at which stamina regeneration may resume. Set to
   * `now + staminaRecoveryDelayMs(after)` on every spend.
   */
  staminaRegenAt: number;
  /**
   * Match clock time the stun expires. This is the source of truth; the
   * inherited `stunned` boolean is a cache `advanceTo` refreshes so that
   * `resolvePunch` can keep taking a plain DefenderSnapshot. Never set
   * `stunned` directly — set this and advance.
   */
  stunnedUntil: number;
  /**
   * Match clock time guard regeneration may resume. Pushed to
   * `now + GAME_RULES.blockRegenerationDelayMs` by every piece of block
   * activity: guard damage, block start/end, and each drain of a held guard.
   */
  blockRegenAt: number;
  /**
   * How far the meters above have been integrated. `advanceTo` reads this as
   * the lower bound of the interval it settles and then moves it to `now`.
   */
  lastAdvancedAt: number;
  /** Nominal damage dealt BY this player — decideWinner's first tiebreaker. */
  damageDealt: number;
  /** Guard breaks credited TO this player — decideWinner's second tiebreaker. */
  guardBreaks: number;
}

/**
 * `now` seeds the deadline fields, so pass the same match clock the server
 * will later advance against. Seeding from zero against a clock that starts
 * anywhere else would make the first advance integrate the whole epoch.
 */
export function initialPlayerState(userUuid: string, slot: Slot, now: number): PlayerState {
  return {
    userUuid,
    slot,
    health: GAME_RULES.maxHealth,
    block: GAME_RULES.maxBlock,
    stamina: GAME_RULES.maxStamina,
    staminaRegenAt: now,
    stunnedUntil: now,
    blockRegenAt: now,
    lastAdvancedAt: now,
    blocking: false,
    stunned: false,
    damageDealt: 0,
    guardBreaks: 0,
  };
}
