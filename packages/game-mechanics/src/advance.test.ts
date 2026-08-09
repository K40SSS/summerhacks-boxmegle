/**
 * advanceTo is the server's replacement for a fixed tick, so these tests care
 * most about the things a tick would have got right for free: integrating
 * only the portion of an interval a meter was actually free to move, and
 * settling a guard break that happens between two reads.
 */

import { describe, expect, it } from "vitest";
import { advanceMatch, advanceTo, endBlock, startBlock } from "./advance";
import { initialPlayerState, type PlayerState } from "./playerState";
import { GAME_RULES } from "./rules";

function player(overrides: Partial<PlayerState> = {}): PlayerState {
  return { ...initialPlayerState("p", 0, 0), ...overrides };
}

describe("advanceTo — guard drain", () => {
  it("drains a held guard at the rule rate", () => {
    const p = player({ blocking: true });
    advanceTo(p, 1000);

    expect(p.block).toBeCloseTo(GAME_RULES.maxBlock - GAME_RULES.blockDrainPerSecond, 6);
    expect(p.lastAdvancedAt).toBe(1000);
  });

  it("holding the guard keeps pushing the regen delay out", () => {
    const p = player({ blocking: true });
    advanceTo(p, 1000);

    expect(p.blockRegenAt).toBe(1000 + GAME_RULES.blockRegenerationDelayMs);
  });

  it("draining to zero breaks the guard, stuns, and clears blocking", () => {
    const p = player({ blocking: true, block: 4 });
    const out = advanceTo(p, 1000);

    expect(out.guardBroke).toBe(true);
    expect(p.block).toBe(0);
    expect(p.blocking).toBe(false);
    expect(p.stunned).toBe(true);
    expect(p.stunnedUntil).toBe(1000 + GAME_RULES.stunDurationMs);
  });

  it("does not break again on the next advance", () => {
    const p = player({ blocking: true, block: 4 });
    advanceTo(p, 1000);

    expect(advanceTo(p, 2000).guardBroke).toBe(false);
  });

  it("settles a break that happened between two reads", () => {
    // The point of the whole design: nothing ran between 0 and 1000, and the
    // guard is still broken by the time anything looks at it.
    const p = player({ blocking: true, block: 1 });
    expect(p.block).toBe(1);

    advanceTo(p, 1000);
    expect(p.block).toBe(0);
    expect(p.stunned).toBe(true);
  });
});

describe("advanceTo — guard regeneration", () => {
  it("waits out the regen delay", () => {
    const p = player({ block: 50, blockRegenAt: 800 });
    advanceTo(p, 700);

    expect(p.block).toBe(50);
  });

  it("credits only the interval after the delay expired, not the whole gap", () => {
    const p = player({ block: 50, blockRegenAt: 800 });
    advanceTo(p, 1000);

    // 200ms of regen, not 1000ms.
    expect(p.block).toBeCloseTo(50 + (GAME_RULES.blockRegenerationPerSecond * 200) / 1000, 6);
  });

  it("does not regenerate while stunned, and resumes when the stun lifts", () => {
    const p = player({ block: 0, stunned: true, stunnedUntil: 1000, blockRegenAt: 0 });
    advanceTo(p, 2000);

    // Only the 1000ms after the stun expired counts.
    expect(p.block).toBeCloseTo(GAME_RULES.blockRegenerationPerSecond, 6);
    expect(p.stunned).toBe(false);
  });

  it("clamps at full", () => {
    const p = player({ block: 99, blockRegenAt: 0 });
    advanceTo(p, 100_000);

    expect(p.block).toBe(GAME_RULES.maxBlock);
  });
});

describe("advanceTo — stamina", () => {
  it("waits out the spend clock, then credits only the remainder", () => {
    const p = player({ stamina: 0, staminaRegenAt: 500 });
    advanceTo(p, 1000);

    expect(p.stamina).toBeCloseTo((GAME_RULES.staminaRegenPerSecond * 500) / 1000, 6);
  });

  it("regenerates through a stun — stamina answers only to its own clock", () => {
    const p = player({ stamina: 0, staminaRegenAt: 0, stunned: true, stunnedUntil: 5000 });
    advanceTo(p, 1000);

    expect(p.stamina).toBeCloseTo(GAME_RULES.staminaRegenPerSecond, 6);
    expect(p.stunned).toBe(true);
  });

  it("regenerates while the guard is up", () => {
    const p = player({ stamina: 0, staminaRegenAt: 0, blocking: true });
    advanceTo(p, 1000);

    expect(p.stamina).toBeCloseTo(GAME_RULES.staminaRegenPerSecond, 6);
  });
});

describe("advanceTo — stun expiry", () => {
  it("reports the expiry exactly once", () => {
    const p = player({ stunned: true, stunnedUntil: 500 });

    expect(advanceTo(p, 1000).stunEnded).toBe(true);
    expect(advanceTo(p, 1500).stunEnded).toBe(false);
  });

  it("keeps the derived flag current without integrating on a still clock", () => {
    const p = player({ stunned: true, stunnedUntil: 500, lastAdvancedAt: 1000 });
    const out = advanceTo(p, 1000);

    expect(out.guardBroke).toBe(false);
    expect(p.stunned).toBe(false);
    expect(p.lastAdvancedAt).toBe(1000);
  });

  it("ignores a clock that moved backwards", () => {
    const p = player({ blocking: true, lastAdvancedAt: 1000 });
    advanceTo(p, 500);

    expect(p.block).toBe(GAME_RULES.maxBlock);
    expect(p.lastAdvancedAt).toBe(1000);
  });
});

describe("advanceMatch", () => {
  it("credits a drained-out guard break to the opponent", () => {
    const a = player({ blocking: true, block: 4 });
    const b = { ...player(), slot: 1 as const, userUuid: "q" };

    const out = advanceMatch(a, b, 1000);

    expect(out.a.guardBroke).toBe(true);
    expect(b.guardBreaks).toBe(1);
    expect(a.guardBreaks).toBe(0);
  });

  it("advances both fighters to the same instant", () => {
    const a = player({ blocking: true });
    const b = { ...player(), slot: 1 as const, userUuid: "q", block: 50, blockRegenAt: 0 };

    advanceMatch(a, b, 1000);

    expect(a.lastAdvancedAt).toBe(1000);
    expect(b.lastAdvancedAt).toBe(1000);
    expect(a.block).toBeLessThan(GAME_RULES.maxBlock);
    expect(b.block).toBeGreaterThan(50);
  });
});

describe("block edges", () => {
  it("startBlock raises the guard and restarts the regen delay", () => {
    const p = player();

    expect(startBlock(p, 1000)).toBe(true);
    expect(p.blocking).toBe(true);
    expect(p.blockRegenAt).toBe(1000 + GAME_RULES.blockRegenerationDelayMs);
  });

  it("startBlock is refused while stunned", () => {
    const p = player({ stunned: true, stunnedUntil: 5000 });

    expect(startBlock(p, 1000)).toBe(false);
    expect(p.blocking).toBe(false);
  });

  it("startBlock on an already-raised guard is a no-op", () => {
    const p = player({ blocking: true, blockRegenAt: 42 });

    expect(startBlock(p, 1000)).toBe(false);
    expect(p.blockRegenAt).toBe(42);
  });

  it("endBlock drops the guard and restarts the regen delay", () => {
    const p = player({ blocking: true });

    expect(endBlock(p, 1000)).toBe(true);
    expect(p.blocking).toBe(false);
    expect(p.blockRegenAt).toBe(1000 + GAME_RULES.blockRegenerationDelayMs);
  });

  it("a guard released then re-raised bills each interval to the right meter", () => {
    // Hold 1s (drain), release, wait past the delay, regen 1s, raise again.
    const p = player({ blocking: true });
    advanceTo(p, 1000);
    const afterDrain = p.block;

    endBlock(p, 1000);
    advanceTo(p, 2800); // 800ms delay, then 1000ms of regen
    const afterRegen = p.block;

    expect(afterDrain).toBeCloseTo(GAME_RULES.maxBlock - GAME_RULES.blockDrainPerSecond, 6);
    expect(afterRegen).toBeCloseTo(
      Math.min(GAME_RULES.maxBlock, afterDrain + GAME_RULES.blockRegenerationPerSecond),
      6,
    );
  });
});
