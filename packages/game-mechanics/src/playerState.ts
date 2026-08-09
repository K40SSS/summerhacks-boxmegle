/**
 * A player's full state for one match: identity plus everything
 * `combat.ts` needs to resolve a punch against them (`DefenderSnapshot`),
 * plus the running totals `decideWinner` compares when nobody is knocked out.
 *
 * This is a data shape, not a stateful class — the server owns the match
 * loop and holds one of these per player (see combat.ts's module doc), and
 * calls resolvePunch/drainBlock/regenerateBlock against it directly, since
 * PlayerState is structurally a DefenderSnapshot.
 */

import type { DefenderSnapshot } from "./combat";
import { GAME_RULES } from "./rules";

export type Slot = 0 | 1;

export interface PlayerState extends DefenderSnapshot {
  userUuid: string;
  slot: Slot;
  /** Nominal damage dealt BY this player — decideWinner's first tiebreaker. */
  damageDealt: number;
  /** Guard breaks credited TO this player — decideWinner's second tiebreaker. */
  guardBreaks: number;
}

export function initialPlayerState(userUuid: string, slot: Slot): PlayerState {
  return {
    userUuid,
    slot,
    health: GAME_RULES.maxHealth,
    block: GAME_RULES.maxBlock,
    blocking: false,
    stunned: false,
    dodging: false,
    dodgeOffsetX: 0,
    dodgeOffsetY: 0,
    damageDealt: 0,
    guardBreaks: 0,
  };
}
