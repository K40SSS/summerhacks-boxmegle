/**
 * Dodge detector fixtures: raw image-space shoulder-mid sequences.
 * Image coords are 0..1 with a shoulder width of 0.25 — a 0.16 image shift
 * is 0.64 shoulder widths. Reported offsets are in the BODY frame:
 * an image-RIGHT slip is the camera-facing player's anatomical LEFT, so
 * offsetX is negative; image-down (a duck) is positive offsetY.
 */

import { describe, expect, it } from "vitest";
import { DodgeDetector } from "./dodge-detector";
import type { DetectedAction } from "./types";

const SW = 0.25;

function run(
  detector: DodgeDetector,
  positions: { x: number; y: number; t: number; conf?: number }[],
): DetectedAction[] {
  const out: DetectedAction[] = [];
  for (const p of positions) {
    out.push(...detector.update(p.x, p.y, SW, p.t, p.conf ?? 0.9));
  }
  return out;
}

function still(x: number, y: number, from: number, frames: number, conf = 0.9) {
  return Array.from({ length: frames }, (_, i) => ({ x, y, t: from + i * 40, conf }));
}

const starts = (a: DetectedAction[]) => a.filter((x) => x.type === "DODGE_START");
const ends = (a: DetectedAction[]) => a.filter((x) => x.type === "DODGE_END");

describe("DodgeDetector", () => {
  it("emits nothing while standing still", () => {
    expect(run(new DodgeDetector(), still(0.5, 0.5, 1000, 60))).toHaveLength(0);
  });

  it("reports a lateral slip in body-frame handedness", () => {
    const detector = new DodgeDetector();
    const actions = run(detector, [
      ...still(0.5, 0.5, 1000, 20),
      // Slip 0.16 image units to the IMAGE right ≈ 0.64 sw anatomical left.
      ...still(0.66, 0.5, 1800, 6),
    ]);
    const s = starts(actions);
    expect(s).toHaveLength(1);
    if (s[0].type === "DODGE_START") {
      expect(s[0].offsetX).toBeLessThan(-0.5);
      expect(Math.abs(s[0].offsetY)).toBeLessThan(0.1);
    }
    expect(detector.isDodging()).toBe(true);
  });

  it("reports a duck as positive offsetY", () => {
    const detector = new DodgeDetector();
    const actions = run(detector, [
      ...still(0.5, 0.5, 1000, 20),
      ...still(0.5, 0.64, 1800, 6), // image-down 0.14 ≈ 0.56 sw
    ]);
    const s = starts(actions);
    expect(s).toHaveLength(1);
    if (s[0].type === "DODGE_START") {
      expect(s[0].offsetY).toBeGreaterThan(0.4);
    }
  });

  it("emits DODGE_END when the player returns to the anchor", () => {
    const detector = new DodgeDetector();
    const actions = run(detector, [
      ...still(0.5, 0.5, 1000, 20),
      ...still(0.66, 0.5, 1800, 6),
      ...still(0.5, 0.5, 2100, 8),
    ]);
    expect(starts(actions)).toHaveLength(1);
    expect(ends(actions)).toHaveLength(1);
    expect(detector.isDodging()).toBe(false);
  });

  it("re-reports the offset when the dodge keeps moving", () => {
    const detector = new DodgeDetector();
    const actions = run(detector, [
      ...still(0.5, 0.5, 1000, 20),
      ...still(0.66, 0.5, 1800, 4),
      // Slide further mid-dodge: 0.74 image ≈ 0.96 sw — ≥0.15 sw change.
      ...still(0.74, 0.5, 2000, 3),
    ]);
    const s = starts(actions);
    expect(s.length).toBeGreaterThanOrEqual(2);
    const last = s[s.length - 1];
    if (last.type === "DODGE_START") {
      expect(last.offsetX).toBeLessThan(-0.8);
    }
  });

  it("heartbeats the offset during a held dodge", () => {
    const detector = new DodgeDetector();
    const actions = run(detector, [
      ...still(0.5, 0.5, 1000, 20),
      ...still(0.66, 0.5, 1800, 20), // held ~800ms, within max hold
    ]);
    // Initial report plus ≥1 heartbeat every ~300ms.
    expect(starts(actions).length).toBeGreaterThanOrEqual(2);
    expect(ends(actions)).toHaveLength(0);
  });

  it("ends a dodge held past the maximum window and re-anchors", () => {
    const detector = new DodgeDetector();
    const actions = run(detector, [
      ...still(0.5, 0.5, 1000, 20),
      // Hold the lean ~1.6s — beyond maxDodgeMs (900).
      ...still(0.66, 0.5, 1800, 40),
    ]);
    expect(ends(actions)).toHaveLength(1);
    expect(detector.isDodging()).toBe(false);
    // The held position is the new anchor — no immediate second dodge.
    expect(run(detector, still(0.66, 0.5, 3800, 20))).toHaveLength(0);
  });

  it("does not dodge from slow drift (anchor follows)", () => {
    const detector = new DodgeDetector();
    const positions = Array.from({ length: 320 }, (_, i) => ({
      x: 0.4 + (i / 320) * 0.2,
      y: 0.5,
      t: 1000 + i * 40,
    }));
    expect(starts(run(detector, positions))).toHaveLength(0);
  });

  it("survives a single blurry frame mid-dodge", () => {
    const detector = new DodgeDetector();
    const actions = run(detector, [
      ...still(0.5, 0.5, 1000, 20),
      ...still(0.66, 0.5, 1800, 4),
      { x: 0.66, y: 0.5, t: 1960, conf: 0.3 }, // one bad frame
      ...still(0.66, 0.5, 2000, 4),
    ]);
    expect(ends(actions)).toHaveLength(0);
    expect(detector.isDodging()).toBe(true);
  });

  it("force-ends after sustained bad tracking", () => {
    const detector = new DodgeDetector();
    const actions = run(detector, [
      ...still(0.5, 0.5, 1000, 20),
      ...still(0.66, 0.5, 1800, 4),
      ...still(0.66, 0.5, 1960, 8, 0.3), // ~280ms of low confidence
    ]);
    expect(ends(actions)).toHaveLength(1);
    expect(detector.isDodging()).toBe(false);
  });

  it("drops the anchor on forceEnd so reacquisition mints no phantom dodge", () => {
    const detector = new DodgeDetector();
    run(detector, [...still(0.5, 0.5, 1000, 20), ...still(0.66, 0.5, 1800, 6)]);
    expect(detector.isDodging()).toBe(true);
    expect(ends(detector.forceEnd(2400))).toBeDefined();
    // Reappear somewhere else entirely: first frame re-seeds the anchor.
    const after = run(detector, still(0.9, 0.5, 3000, 10));
    expect(starts(after)).toHaveLength(0);
    expect(detector.isDodging()).toBe(false);
  });
});
