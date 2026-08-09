import { describe, expect, it } from "vitest";
import {
  angleAt,
  directionChange,
  distance2D,
  distance3D,
  magnitude,
  midpoint,
  subtract,
  velocity,
} from "./geometry";
import { normalizeLandmarks } from "./normalize";
import { LM, type RawLandmark } from "./types";

const p = (x: number, y: number, z = 0) => ({ x, y, z });

describe("geometry (TDD §25.1)", () => {
  it("distance2D ignores depth", () => {
    expect(distance2D(p(0, 0, 5), p(3, 4, -5))).toBeCloseTo(5, 10);
  });

  it("distance3D includes depth", () => {
    expect(distance3D(p(0, 0, 0), p(2, 3, 6))).toBeCloseTo(7, 10);
  });

  it("midpoint averages all axes", () => {
    expect(midpoint(p(0, 2, 4), p(2, 4, 6))).toEqual(p(1, 3, 5));
  });

  it("subtract and magnitude", () => {
    expect(subtract(p(3, 5, 7), p(1, 2, 3))).toEqual(p(2, 3, 4));
    expect(magnitude(p(2, 3, 6))).toBeCloseTo(7, 10);
  });

  it("angleAt returns 90° for a right angle and 180° for a straight arm", () => {
    expect(angleAt(p(1, 0), p(0, 0), p(0, 1))).toBeCloseTo(90, 6);
    expect(angleAt(p(-1, 0), p(0, 0), p(1, 0))).toBeCloseTo(180, 6);
  });

  it("angleAt is NaN for zero-length segments", () => {
    expect(Number.isNaN(angleAt(p(0, 0), p(0, 0), p(1, 1)))).toBe(true);
  });

  it("velocity is per second", () => {
    const v = velocity(p(0, 0), p(1, -2), 500);
    expect(v.x).toBeCloseTo(2, 10);
    expect(v.y).toBeCloseTo(-4, 10);
  });

  it("directionChange measures the angle between velocity vectors", () => {
    expect(directionChange(p(1, 0), p(-1, 0))).toBeCloseTo(180, 6);
    expect(directionChange(p(1, 0), p(0, 1))).toBeCloseTo(90, 6);
    expect(directionChange(p(1, 0), p(2, 0))).toBeCloseTo(0, 6);
    expect(directionChange(p(0, 0), p(1, 0))).toBe(0);
  });
});

describe("body-relative normalization (TDD §11.3)", () => {
  function landmarks33(overrides: Partial<Record<number, RawLandmark>>): RawLandmark[] {
    const base: RawLandmark[] = Array.from({ length: 33 }, () => ({
      x: 0.5,
      y: 0.5,
      z: 0,
      visibility: 1,
    }));
    for (const [index, lm] of Object.entries(overrides)) {
      base[Number(index)] = lm as RawLandmark;
    }
    return base;
  }

  // Unmirrored front-facing feed: the anatomical LEFT shoulder appears at
  // HIGHER image x. The body frame is +x = anatomical right, +y = down.
  it("puts the origin at the shoulder midpoint with shoulder-width scale", () => {
    const lms = landmarks33({
      [LM.LEFT_SHOULDER]: { x: 0.6, y: 0.5, z: 0, visibility: 1 },
      [LM.RIGHT_SHOULDER]: { x: 0.4, y: 0.5, z: 0, visibility: 1 },
      [LM.LEFT_WRIST]: { x: 0.6, y: 0.7, z: 0, visibility: 1 },
    });
    const result = normalizeLandmarks(lms, 0);
    expect(result).not.toBeNull();
    const pose = result!.pose;
    // Shoulders land at ±0.5 on a horizontal line.
    expect(pose.leftShoulder.x).toBeCloseTo(-0.5, 6);
    expect(pose.rightShoulder.x).toBeCloseTo(0.5, 6);
    expect(pose.leftShoulder.y).toBeCloseTo(0, 6);
    // Wrist 0.2 image-units below the left shoulder = 1 shoulder-width down.
    expect(pose.leftWrist.x).toBeCloseTo(-0.5, 6);
    expect(pose.leftWrist.y).toBeCloseTo(1, 6);
    expect(pose.shoulderWidthImage).toBeCloseTo(0.2, 10);
  });

  it("keeps the head at negative y for a camera-facing player", () => {
    const lms = landmarks33({
      [LM.LEFT_SHOULDER]: { x: 0.6, y: 0.5, z: 0, visibility: 1 },
      [LM.RIGHT_SHOULDER]: { x: 0.4, y: 0.5, z: 0, visibility: 1 },
      [LM.NOSE]: { x: 0.5, y: 0.32, z: 0, visibility: 1 },
      [LM.LEFT_HIP]: { x: 0.57, y: 0.85, z: 0, visibility: 1 },
      [LM.RIGHT_HIP]: { x: 0.43, y: 0.85, z: 0, visibility: 1 },
    });
    const pose = normalizeLandmarks(lms, 0)!.pose;
    expect(pose.nose.y).toBeLessThan(0);
    expect(pose.leftHip.y).toBeGreaterThan(0);
    // Hips keep the same left/right sides as the shoulders.
    expect(pose.leftHip.x).toBeLessThan(0);
    expect(pose.rightHip.x).toBeGreaterThan(0);
  });

  it("rotates a tilted shoulder line to horizontal", () => {
    const lms = landmarks33({
      [LM.LEFT_SHOULDER]: { x: 0.6, y: 0.45, z: 0, visibility: 1 },
      [LM.RIGHT_SHOULDER]: { x: 0.4, y: 0.55, z: 0, visibility: 1 },
    });
    const pose = normalizeLandmarks(lms, 0)!.pose;
    expect(pose.leftShoulder.y).toBeCloseTo(pose.rightShoulder.y, 6);
    expect(pose.rightShoulder.x - pose.leftShoulder.x).toBeCloseTo(1, 6);
  });

  it("is invariant to camera distance", () => {
    const near = normalizeLandmarks(
      landmarks33({
        [LM.LEFT_SHOULDER]: { x: 0.7, y: 0.5, z: 0, visibility: 1 },
        [LM.RIGHT_SHOULDER]: { x: 0.3, y: 0.5, z: 0, visibility: 1 },
        [LM.LEFT_WRIST]: { x: 0.7, y: 0.9, z: 0, visibility: 1 },
      }),
      0,
    )!.pose;
    const far = normalizeLandmarks(
      landmarks33({
        [LM.LEFT_SHOULDER]: { x: 0.55, y: 0.5, z: 0, visibility: 1 },
        [LM.RIGHT_SHOULDER]: { x: 0.45, y: 0.5, z: 0, visibility: 1 },
        [LM.LEFT_WRIST]: { x: 0.55, y: 0.6, z: 0, visibility: 1 },
      }),
      0,
    )!.pose;
    expect(near.leftWrist.y).toBeCloseTo(far.leftWrist.y, 6);
  });

  it("returns null when shoulders collapse", () => {
    const lms = landmarks33({
      [LM.LEFT_SHOULDER]: { x: 0.5, y: 0.5, z: 0, visibility: 1 },
      [LM.RIGHT_SHOULDER]: { x: 0.5, y: 0.5, z: 0, visibility: 1 },
    });
    expect(normalizeLandmarks(lms, 0)).toBeNull();
  });
});
