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
import { GAME_RULES, PUNCH_STATS, ZONE_MULTIPLIERS } from "./rules";

function defender(overrides: Partial<DefenderSnapshot> = {}): DefenderSnapshot {
  return {
    health: 100,
    block: 100,
    blocking: false,
    stunned: false,
    ...overrides,
  };
}

describe("resolvePunch", () => {
  it("lands for the punch's health damage on an open defender", () => {
    const out = resolvePunch("CROSS", "BODY", defender());
    expect(out.result).toBe("HIT");
    expect(out.zone).toBe("BODY");
    expect(out.healthDamage).toBe(PUNCH_STATS.CROSS.healthDamage);
    expect(out.defenderHealthAfter).toBe(100 - PUNCH_STATS.CROSS.healthDamage);
    expect(out.defenderBlockAfter).toBe(100);
    expect(out.stunsDefender).toBe(false);
  });

  it("is absorbed by a raised guard", () => {
    const out = resolvePunch("HOOK", "HEAD", defender({ blocking: true }));
    expect(out.result).toBe("BLOCKED");
    expect(out.healthDamage).toBe(0);
    expect(out.guardDamage).toBe(PUNCH_STATS.HOOK.guardDamage);
    expect(out.defenderBlockAfter).toBe(100 - PUNCH_STATS.HOOK.guardDamage);
  });

  it("breaks a depleted guard and stuns without health damage", () => {
    const out = resolvePunch("JAB", "HEAD", defender({ blocking: true, block: 10 }));
    expect(out.result).toBe("GUARD_BREAK");
    expect(out.healthDamage).toBe(0);
    expect(out.defenderBlockAfter).toBe(0);
    expect(out.stunsDefender).toBe(true);
  });

  it("takes nothing when the punch connected with no hitbox", () => {
    const out = resolvePunch("CROSS", null, defender());
    expect(out.result).toBe("MISS");
    expect(out.zone).toBeNull();
    expect(out.healthDamage).toBe(0);
    expect(out.guardDamage).toBe(0);
    expect(out.defenderHealthAfter).toBe(100);
    expect(out.defenderBlockAfter).toBe(100);
  });

  it("a miss costs a blocking defender no guard meter", () => {
    // Evasion resolves before the guard: a punch that never arrived must not
    // drain the block it never touched.
    const out = resolvePunch("HOOK", null, defender({ blocking: true }));
    expect(out.result).toBe("MISS");
    expect(out.defenderBlockAfter).toBe(100);
  });

  it("reports the zone it landed on", () => {
    expect(resolvePunch("JAB", "BODY", defender()).zone).toBe("BODY");
    expect(resolvePunch("JAB", "BODY", defender({ blocking: true })).zone).toBe("BODY");
  });

  it("a stunned defender cannot block", () => {
    const out = resolvePunch("UPPERCUT", "BODY", defender({ stunned: true, blocking: true }));
    expect(out.result).toBe("HIT");
    expect(out.healthDamage).toBe(PUNCH_STATS.UPPERCUT.healthDamage);
  });

  it("a stunned defender is still missable", () => {
    // Stun removes the guard, not the geometry.
    const out = resolvePunch("UPPERCUT", null, defender({ stunned: true }));
    expect(out.result).toBe("MISS");
  });

  it("clamps health at zero", () => {
    const out = resolvePunch("UPPERCUT", "HEAD", defender({ health: 3 }));
    expect(out.defenderHealthAfter).toBe(0);
  });
});

describe("zone damage multipliers", () => {
  it("a headshot deals 1.5x its punch's health damage", () => {
    const out = resolvePunch("CROSS", "HEAD", defender());
    expect(out.healthDamage).toBe(PUNCH_STATS.CROSS.healthDamage * 1.5);
    expect(out.defenderHealthAfter).toBe(100 - PUNCH_STATS.CROSS.healthDamage * 1.5);
  });

  it("a body shot deals its punch's health damage unmodified", () => {
    const out = resolvePunch("CROSS", "BODY", defender());
    expect(out.healthDamage).toBe(PUNCH_STATS.CROSS.healthDamage);
  });

  it("scales every punch type", () => {
    for (const type of ["JAB", "CROSS", "HOOK", "UPPERCUT"] as const) {
      expect(resolvePunch(type, "HEAD", defender()).healthDamage).toBe(
        PUNCH_STATS[type].healthDamage * ZONE_MULTIPLIERS.HEAD,
      );
    }
  });

  it("does not change guard damage — head-hunting breaks a guard no faster", () => {
    const head = resolvePunch("HOOK", "HEAD", defender({ blocking: true }));
    const body = resolvePunch("HOOK", "BODY", defender({ blocking: true }));
    expect(head.guardDamage).toBe(PUNCH_STATS.HOOK.guardDamage);
    expect(head.guardDamage).toBe(body.guardDamage);
    expect(head.defenderBlockAfter).toBe(body.defenderBlockAfter);
  });

  it("a blocked headshot still deals no health damage", () => {
    const out = resolvePunch("UPPERCUT", "HEAD", defender({ blocking: true }));
    expect(out.result).toBe("BLOCKED");
    expect(out.healthDamage).toBe(0);
  });

  it("reports nominal damage even when health clamps", () => {
    // The server counts nominal damage toward damageDealt — do not recompute
    // it from the health delta.
    const out = resolvePunch("UPPERCUT", "BODY", defender({ health: 3 }));
    expect(out.healthDamage).toBe(PUNCH_STATS.UPPERCUT.healthDamage);
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
