import { describe, expect, it } from "vitest";
import { clamp, eloExpected, eloUpdate, punchMisses } from "./rules";

describe("punchMisses (dodge resolution)", () => {
  it("hits a defender who has not moved", () => {
    expect(punchMisses({ x: 0, y: -0.7 }, { x: 0, y: 0 })).toBe(false);
  });

  it("misses when the defender slipped away from the impact line", () => {
    expect(punchMisses({ x: 0, y: -0.7 }, { x: 0.9, y: 0 })).toBe(true);
    expect(punchMisses({ x: 0, y: -0.7 }, { x: -0.9, y: 0 })).toBe(true);
  });

  it("still hits when the defender slipped into the punch", () => {
    // Punch aimed to the defender's right, defender slipped right too.
    expect(punchMisses({ x: 0.6, y: -0.7 }, { x: 0.5, y: 0 })).toBe(false);
  });

  it("misses a head-height punch when the defender ducked", () => {
    expect(punchMisses({ x: 0, y: -0.8 }, { x: 0, y: 0.5 })).toBe(true);
  });

  it("does not let a duck evade a body-height punch", () => {
    expect(punchMisses({ x: 0, y: -0.2 }, { x: 0, y: 0.5 })).toBe(false);
  });

  it("small shuffles are not dodges", () => {
    expect(punchMisses({ x: 0, y: -0.7 }, { x: 0.3, y: 0.1 })).toBe(false);
  });
});

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
