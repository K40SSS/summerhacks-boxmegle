/**
 * Hitbox resolution — the replacement for the old dodge system.
 *
 * The behavioural claim under test: evasion is head movement relative to the
 * shoulders (a slip or a roll), and it is computed from the defender's pose
 * rather than trusted from a client-reported flag.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_HITBOX_OPTIONS, hitboxTest } from "./hitbox";
import type { NormalizedPose } from "./types";

/**
 * Neutral stance in the body frame. normalize.ts puts the shoulder midpoint
 * at the origin and scales by shoulder width, so the shoulders sit at ±0.5.
 */
function pose(overrides: Partial<NormalizedPose> = {}): NormalizedPose {
  return {
    timestamp: 1000,
    nose: { x: 0, y: -0.9, z: -1.0 },
    leftShoulder: { x: -0.5, y: 0, z: 0 },
    rightShoulder: { x: 0.5, y: 0, z: 0 },
    leftElbow: { x: -0.6, y: 0.5, z: -0.3 },
    rightElbow: { x: 0.6, y: 0.5, z: -0.3 },
    leftWrist: { x: -0.3, y: -0.6, z: -1.6 },
    rightWrist: { x: 0.3, y: -0.6, z: -1.6 },
    leftHip: { x: -0.35, y: 0.8, z: 0 },
    rightHip: { x: 0.35, y: 0.8, z: 0 },
    confidence: 0.9,
    shoulderWidthImage: 0.25,
    ...overrides,
  };
}

const HEAD_HEIGHT = { x: 0, y: -0.9 };
const CHEST = { x: 0, y: 0.3 };

describe("hitboxTest", () => {
  it("lands a punch aimed at the head", () => {
    expect(hitboxTest(HEAD_HEIGHT, pose())).toBe("HEAD");
  });

  it("lands a punch aimed at the chest", () => {
    expect(hitboxTest(CHEST, pose())).toBe("BODY");
  });

  it("finds only air well outside the body", () => {
    expect(hitboxTest({ x: 2.0, y: -0.9 }, pose())).toBeNull();
  });

  it("misses below the hips", () => {
    expect(hitboxTest({ x: 0, y: 1.4 }, pose())).toBeNull();
  });

  it("misses wide of the torso", () => {
    expect(hitboxTest({ x: 0.9, y: 0.3 }, pose())).toBeNull();
  });
});

describe("evasion is head movement relative to the shoulders", () => {
  it("a slip makes a head-aimed punch miss", () => {
    // Head slipped to the fighter's own right; the punch was thrown at where
    // the head used to be.
    const slipped = pose({ nose: { x: 0.6, y: -0.9, z: -1.0 } });
    expect(hitboxTest(HEAD_HEIGHT, slipped)).toBeNull();
  });

  it("a slip does not protect the body", () => {
    const slipped = pose({ nose: { x: 0.6, y: -0.9, z: -1.0 } });
    expect(hitboxTest(CHEST, slipped)).toBe("BODY");
  });

  it("ducking evades a head-height punch", () => {
    // Head pulled down toward the shoulders — a roll under the punch.
    const ducked = pose({ nose: { x: 0, y: -0.3, z: -1.0 } });
    expect(hitboxTest(HEAD_HEIGHT, ducked)).toBeNull();
  });

  it("ducking into a body punch still gets hit", () => {
    const ducked = pose({ nose: { x: 0, y: -0.3, z: -1.0 } });
    expect(hitboxTest(CHEST, ducked)).toBe("BODY");
  });

  it("a punch tracking the slipped head still lands", () => {
    // Evasion is not a blanket immunity: aim where they actually are.
    const slipped = pose({ nose: { x: 0.6, y: -0.9, z: -1.0 } });
    expect(hitboxTest({ x: 0.6, y: -0.9 }, slipped)).toBe("HEAD");
  });
});

describe("zone geometry", () => {
  it("has no dead zone between the head and the torso", () => {
    // Sweep the whole centre line from above the head to below the hips; the
    // neck region must not fall through the gap between the two shapes.
    const p = pose();
    for (let y = -1.3; y <= 0.85; y += 0.05) {
      expect(hitboxTest({ x: 0, y }, p)).not.toBeNull();
    }
  });

  it("resolves the head/torso overlap as a headshot", () => {
    const p = pose();
    const neck = { x: 0, y: -0.45 };
    // Inside both shapes...
    const insideTorsoBand =
      neck.y >= Math.min(0, 0.8) - DEFAULT_HITBOX_OPTIONS.torsoTopPadding;
    expect(insideTorsoBand).toBe(true);
    // ...but the head wins.
    expect(hitboxTest(neck, p)).toBe("HEAD");
  });
});
