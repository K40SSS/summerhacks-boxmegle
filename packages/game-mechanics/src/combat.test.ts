/**
 * Combat resolution: the pure rules a server applies to incoming punches.
 * Semantics mirror the MVP's authoritative mock server exactly.
 */

import { describe, expect, it } from "vitest";
import {
  decideWinner,
  drainBlock,
  regenerateBlock,
  resolvePunch,
  type DefenderSnapshot,
} from "./combat";
import { GAME_RULES, PUNCH_STATS } from "./rules";

function defender(overrides: Partial<DefenderSnapshot> = {}): DefenderSnapshot {
  return {
    health: 100,
    block: 100,
    blocking: false,
    stunned: false,
    dodging: false,
    dodgeOffsetX: 0,
    dodgeOffsetY: 0,
    ...overrides,
  };
}

const CENTER_HEAD = { x: 0, y: -0.7 };

describe("resolvePunch", () => {
  it("lands for the punch's health damage on an open defender", () => {
    const out = resolvePunch("CROSS", CENTER_HEAD, defender());
    expect(out.result).toBe("HIT");
    expect(out.healthDamage).toBe(PUNCH_STATS.CROSS.healthDamage);
    expect(out.defenderHealthAfter).toBe(100 - PUNCH_STATS.CROSS.healthDamage);
    expect(out.defenderBlockAfter).toBe(100);
    expect(out.stunsDefender).toBe(false);
  });

  it("is absorbed by a raised guard", () => {
    const out = resolvePunch("HOOK", CENTER_HEAD, defender({ blocking: true }));
    expect(out.result).toBe("BLOCKED");
    expect(out.healthDamage).toBe(0);
    expect(out.guardDamage).toBe(PUNCH_STATS.HOOK.guardDamage);
    expect(out.defenderBlockAfter).toBe(100 - PUNCH_STATS.HOOK.guardDamage);
  });

  it("breaks a depleted guard and stuns without health damage", () => {
    const out = resolvePunch("JAB", CENTER_HEAD, defender({ blocking: true, block: 10 }));
    expect(out.result).toBe("GUARD_BREAK");
    expect(out.healthDamage).toBe(0);
    expect(out.defenderBlockAfter).toBe(0);
    expect(out.stunsDefender).toBe(true);
  });

  it("misses a defender who slipped away from the impact line", () => {
    const out = resolvePunch(
      "CROSS",
      CENTER_HEAD,
      defender({ dodging: true, dodgeOffsetX: 0.9 }),
    );
    expect(out.result).toBe("MISS");
    expect(out.defenderHealthAfter).toBe(100);
    expect(out.defenderBlockAfter).toBe(100);
  });

  it("still hits a dodger who slipped into the punch", () => {
    const out = resolvePunch(
      "CROSS",
      { x: 0.6, y: -0.7 },
      defender({ dodging: true, dodgeOffsetX: 0.5 }),
    );
    expect(out.result).toBe("HIT");
  });

  it("lets a duck evade a head-height punch but not a body punch", () => {
    const ducked = defender({ dodging: true, dodgeOffsetY: 0.5 });
    expect(resolvePunch("JAB", { x: 0, y: -0.8 }, ducked).result).toBe("MISS");
    expect(resolvePunch("JAB", { x: 0, y: -0.2 }, ducked).result).toBe("HIT");
  });

  it("blocking takes precedence over dodging", () => {
    const out = resolvePunch(
      "JAB",
      CENTER_HEAD,
      defender({ blocking: true, dodging: true, dodgeOffsetX: 2 }),
    );
    expect(out.result).toBe("BLOCKED");
  });

  it("a stunned defender cannot dodge or block", () => {
    const out = resolvePunch(
      "UPPERCUT",
      CENTER_HEAD,
      defender({ stunned: true, blocking: true, dodging: true, dodgeOffsetX: 2 }),
    );
    expect(out.result).toBe("HIT");
    expect(out.healthDamage).toBe(PUNCH_STATS.UPPERCUT.healthDamage);
  });

  it("clamps health at zero", () => {
    const out = resolvePunch("UPPERCUT", CENTER_HEAD, defender({ health: 3 }));
    expect(out.defenderHealthAfter).toBe(0);
  });
});

describe("block meter over time", () => {
  it("drains at blockDrainPerSecond while held", () => {
    const out = drainBlock(100, 1000);
    expect(out.block).toBe(100 - GAME_RULES.blockDrainPerSecond);
    expect(out.guardBroke).toBe(false);
  });

  it("draining to zero is a guard break", () => {
    const out = drainBlock(2, 1000);
    expect(out.block).toBe(0);
    expect(out.guardBroke).toBe(true);
  });

  it("an already-empty meter does not re-break every tick", () => {
    expect(drainBlock(0, 1000).guardBroke).toBe(false);
  });

  it("regenerates at blockRegenerationPerSecond", () => {
    expect(regenerateBlock(50, 1000)).toBe(50 + GAME_RULES.blockRegenerationPerSecond);
    expect(regenerateBlock(95, 1000)).toBe(100);
  });
});

describe("decideWinner", () => {
  const stats = (health: number, damageDealt = 0, guardBreaks = 0) => ({
    health,
    damageDealt,
    guardBreaks,
  });

  it("prefers remaining health", () => {
    expect(decideWinner(stats(40), stats(30))).toBe("A");
    expect(decideWinner(stats(10), stats(30))).toBe("B");
  });

  it("falls back to damage dealt, then guard breaks", () => {
    expect(decideWinner(stats(30, 80), stats(30, 60))).toBe("A");
    expect(decideWinner(stats(30, 60, 1), stats(30, 60, 2))).toBe("B");
  });

  it("declares a draw when everything ties", () => {
    expect(decideWinner(stats(30, 60, 1), stats(30, 60, 1))).toBe("DRAW");
  });
});
