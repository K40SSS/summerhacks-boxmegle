import { describe, expect, it } from "vitest";
import { clamp, eloExpected, eloUpdate } from "./rules";

// Evasion used to live here as punchMisses(). It is now geometry rather than
// a rule over a claimed offset — see hitbox.test.ts.

describe("clamp", () => {
  it("bounds values", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
  });
});

describe("Elo (TDD §16.2, K = 32)", () => {
  it("gives 0.5 expectation for equal ratings", () => {
    expect(eloExpected(1000, 1000)).toBeCloseTo(0.5, 10);
  });

  it("updates symmetrically for a win at equal ratings", () => {
    const expected = eloExpected(1000, 1000);
    expect(eloUpdate(1000, expected, 1)).toBe(1016);
    expect(eloUpdate(1000, expected, 0)).toBe(984);
    expect(eloUpdate(1000, expected, 0.5)).toBe(1000);
  });

  it("gives the underdog more for a win", () => {
    const underdogGain = eloUpdate(900, eloExpected(900, 1100), 1) - 900;
    const favouriteGain = eloUpdate(1100, eloExpected(1100, 900), 1) - 1100;
    expect(underdogGain).toBeGreaterThan(favouriteGain);
    expect(underdogGain + favouriteGain).toBeLessThanOrEqual(32);
  });
});
