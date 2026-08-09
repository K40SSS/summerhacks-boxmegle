/**
 * Step 2 of the match loop: settle a player's time-based state up to `now`.
 *
 * This is what the server has instead of a fixed-rate tick. Guard drain,
 * guard regeneration, stamina regeneration and stun expiry all advance with
 * wall time, and a tick's only real job would be to integrate them on a
 * schedule. `advanceTo` does the same arithmetic on demand, over whatever
 * interval has actually elapsed, so the meters are correct at the moment
 * something reads them and untouched the rest of the time.
 *
 * ## The rule that makes it correct
 *
 * Never read or write a player's guard, stamina or stun without advancing
 * them first. A guard that drained to zero five milliseconds ago must already
 * be broken before a punch is resolved against it — otherwise the punch lands
 * on a guard the fighter no longer has.
 *
 * ## Gates are intervals, not flags
 *
 * A meter resumes at whichever of its gates clears LAST, and each meter is
 * integrated only over the part of the interval it was actually free. A stun
 * that expires halfway through the elapsed time credits half the regen, not
 * all of it — integrating the whole interval would hand back time the player
 * spent locked, which is exactly the bug a lazy integrator invites.
 *
 * ## Clock
 *
 * `now` must come from a single match-wide clock shared by both players —
 * monotonic server time. It is NOT the timestamp on a DetectedAction: those
 * are paced by each client's own camera (see apps/server/ws/poseIngest.ts)
 * and two players' streams can sit over a second apart, which would let one
 * player's frame drag the other's meters backwards.
 */

import { drainBlock, regenerateBlock } from "./combat";
import type { PlayerState } from "./playerState";
import { GAME_RULES } from "./rules";
import { regenerateStamina } from "./stamina";

export interface AdvanceOutcome {
  /** Passive drain emptied the guard during this interval. */
  guardBroke: boolean;
  /** A stun that was running at the start of the interval has now expired. */
  stunEnded: boolean;
}

/**
 * Apply every consequence of a broken guard, from either cause — drained to
 * zero here, or punched through in `resolvePunch`.
 *
 * Does NOT credit the opponent's `guardBreaks`: that needs the other player,
 * so it belongs to the caller (see `advanceMatch`).
 */
export function applyGuardBreak(player: PlayerState, now: number): void {
  player.block = 0;
  // Cleared deliberately: a fresh BLOCK_START is required to guard again, so
  // a player cannot ride a held pose straight back into a block.
  player.blocking = false;
  player.stunnedUntil = now + GAME_RULES.stunDurationMs;
  player.stunned = true;
  player.blockRegenAt = now + GAME_RULES.blockRegenerationDelayMs;
}

/** Settle one player's meters up to `now`. Mutates `player`. */
export function advanceTo(player: PlayerState, now: number): AdvanceOutcome {
  const from = player.lastAdvancedAt;

  // A clock that did not move integrates nothing, but the derived stun flag
  // still has to reflect `now` — callers rely on it being current.
  if (now <= from) {
    player.stunned = now < player.stunnedUntil;
    return { guardBroke: false, stunEnded: false };
  }

  const wasStunned = from < player.stunnedUntil;

  // Stun freezes the guard meter in both directions, so both branches below
  // start no earlier than the moment it lifted.
  const guardFreeFrom = Math.max(from, player.stunnedUntil);
  let guardBroke = false;

  if (player.blocking) {
    const drainMs = now - guardFreeFrom;
    if (drainMs > 0) {
      const drained = drainBlock(player.block, drainMs);
      player.block = drained.block;
      // Holding the guard is block activity, so the regen delay keeps being
      // pushed out for as long as it is held.
      player.blockRegenAt = now + GAME_RULES.blockRegenerationDelayMs;
      guardBroke = drained.guardBroke;
    }
  } else {
    const regenMs = now - Math.max(guardFreeFrom, player.blockRegenAt);
    if (regenMs > 0) player.block = regenerateBlock(player.block, regenMs);
  }

  // Stamina answers only to its own spend clock — neither stun nor the guard
  // gates it (see stamina.ts's server contract).
  const staminaMs = now - Math.max(from, player.staminaRegenAt);
  if (staminaMs > 0) player.stamina = regenerateStamina(player.stamina, staminaMs);

  // Timed to `now` rather than to the instant mid-interval the meter actually
  // hit zero. Worth knowing, not worth fixing: it is generous to the defender
  // by less than one frame.
  if (guardBroke) applyGuardBreak(player, now);

  player.stunned = now < player.stunnedUntil;
  player.lastAdvancedAt = now;

  return { guardBroke, stunEnded: wasStunned && !player.stunned };
}

export interface MatchAdvanceOutcome {
  a: AdvanceOutcome;
  b: AdvanceOutcome;
}

/**
 * Advance both fighters to the same instant and settle the one consequence
 * that needs both of them: a guard drained to zero is a guard break like any
 * other, so it pays the opponent the same decision tiebreaker that punching
 * through a guard does.
 */
export function advanceMatch(a: PlayerState, b: PlayerState, now: number): MatchAdvanceOutcome {
  const outA = advanceTo(a, now);
  const outB = advanceTo(b, now);

  if (outA.guardBroke) b.guardBreaks += 1;
  if (outB.guardBroke) a.guardBreaks += 1;

  return { a: outA, b: outB };
}

/**
 * Raise the guard. Rejected while stunned — that is what makes a guard break
 * a real punish window rather than something you can hold through.
 *
 * Advance the player first: this only flips the flag, so calling it before
 * the meters are settled would bill the time before the block to the block.
 * Returns whether the state actually changed.
 */
export function startBlock(player: PlayerState, now: number): boolean {
  if (player.blocking || player.stunned) return false;
  player.blocking = true;
  player.blockRegenAt = now + GAME_RULES.blockRegenerationDelayMs;
  return true;
}

/** Drop the guard. Advance first, for the same reason as `startBlock`. */
export function endBlock(player: PlayerState, now: number): boolean {
  if (!player.blocking) return false;
  player.blocking = false;
  player.blockRegenAt = now + GAME_RULES.blockRegenerationDelayMs;
  return true;
}
