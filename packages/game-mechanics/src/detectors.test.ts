/**
 * Computer-vision fixture tests (TDD §25.2): synthetic FrameFeatures
 * sequences drive the punch and block detectors directly — no camera needed.
 *
 * Expected assertions:
 *   Idle sequence  → no punch
 *   Wave           → no punch
 *   Jab sequence   → exactly one punch
 *   Block sequence → one BLOCK_START, then one BLOCK_END on release
 */

import { describe, expect, it } from "vitest";
import { BlockDetector } from "./block-detector";
import { PunchDetector } from "./punch-detector";
import type { DetectedAction, FrameFeatures } from "./types";

function frame(timestamp: number, overrides: Partial<FrameFeatures> = {}): FrameFeatures {
  return {
    timestamp,
    leftWrist: { x: -0.4, y: 0.2, z: 0 },
    rightWrist: { x: 0.4, y: 0.2, z: 0 },
    leftElbow: { x: -0.6, y: 0.5, z: 0 },
    rightElbow: { x: 0.6, y: 0.5, z: 0 },
    leftWristVelocity: { x: 0, y: 0, z: 0 },
    rightWristVelocity: { x: 0, y: 0, z: 0 },
    leftWristSpeed: 0,
    rightWristSpeed: 0,
    leftElbowAngle: 70,
    rightElbowAngle: 70,
    leftShoulderAngle: 30,
    rightShoulderAngle: 30,
    leftReach: 0.8,
    rightReach: 0.8,
    leftWristDepthFromNose: 0,
    rightWristDepthFromNose: 0,
    torsoRotation: 0,
    torsoLean: 0,
    motionEnergy: 0.2,
    confidence: 0.9,
    ...overrides,
  };
}

function runPunches(frames: FrameFeatures[]): DetectedAction[] {
  const detector = new PunchDetector();
  const out: DetectedAction[] = [];
  for (const f of frames) out.push(...detector.update(f));
  return out.filter((a) => a.type === "PUNCH");
}

describe("PunchDetector (TDD §12.4–§12.6)", () => {
  it("emits nothing while standing still", () => {
    const frames = Array.from({ length: 60 }, (_, i) => frame(1000 + i * 40));
    expect(runPunches(frames)).toHaveLength(0);
  });

  it("emits nothing for a wave (speed without real extension)", () => {
    const frames: FrameFeatures[] = [];
    for (let i = 0; i < 60; i++) {
      const t = 1000 + i * 40;
      const wobble = Math.sin(i / 3) * 0.08;
      frames.push(
        frame(t, {
          rightWrist: { x: 0.4 + wobble, y: -0.6, z: 0 },
          rightWristSpeed: 2.0,
          rightWristVelocity: { x: Math.cos(i / 3) * 2, y: 0, z: 0 },
          rightReach: 0.82 + wobble,
        }),
      );
    }
    expect(runPunches(frames)).toHaveLength(0);
  });

  it("emits exactly one punch for a jab sequence", () => {
    const frames: FrameFeatures[] = [];
    let t = 1000;
    // Settle in guard.
    for (let i = 0; i < 10; i++, t += 40) frames.push(frame(t));
    // Fast forward extension.
    const reaches = [0.95, 1.1, 1.28, 1.42, 1.5];
    for (const reach of reaches) {
      frames.push(
        frame(t, {
          rightReach: reach,
          rightWristSpeed: 3.2,
          rightWristVelocity: { x: 0.2, y: -0.3, z: -3 },
          rightElbowAngle: 100 + reach * 40,
        }),
      );
      t += 40;
    }
    // Peak passed → retraction back to guard.
    const retract = [1.35, 1.1, 0.92, 0.84, 0.8];
    for (const reach of retract) {
      frames.push(frame(t, { rightReach: reach, rightWristSpeed: 1.8 }));
      t += 40;
    }
    // Idle tail.
    for (let i = 0; i < 20; i++, t += 40) frames.push(frame(t));

    const punches = runPunches(frames);
    expect(punches).toHaveLength(1);
    expect(punches[0]).toMatchObject({ type: "PUNCH", hand: "RIGHT" });
  });

  it("respects the per-hand cooldown for back-to-back extensions", () => {
    const frames: FrameFeatures[] = [];
    let t = 1000;
    for (let i = 0; i < 10; i++, t += 40) frames.push(frame(t));
    // Two immediate consecutive jabs — the second starts inside the 400ms
    // cooldown window and must not double-fire from a single extension.
    for (let rep = 0; rep < 2; rep++) {
      for (const reach of [1.0, 1.3, 1.5]) {
        frames.push(frame(t, { rightReach: reach, rightWristSpeed: 3.2 }));
        t += 40;
      }
      for (const reach of [1.2, 0.9, 0.8]) {
        frames.push(frame(t, { rightReach: reach, rightWristSpeed: 1.5 }));
        t += 40;
      }
    }
    const punches = runPunches(frames);
    expect(punches.length).toBeLessThanOrEqual(1);
  });

  function punchWithVelocity(velocity: { x: number; y: number; z: number }, elbowAngle: number) {
    const frames: FrameFeatures[] = [];
    let t = 1000;
    for (let i = 0; i < 10; i++, t += 40) frames.push(frame(t));
    for (const reach of [0.95, 1.1, 1.28, 1.42, 1.5]) {
      frames.push(
        frame(t, {
          rightReach: reach,
          rightWristSpeed: 3.2,
          rightWristVelocity: velocity,
          rightElbowAngle: elbowAngle,
        }),
      );
      t += 40;
    }
    // Classification fires on the first retraction frame, which the detector
    // still folds into the accumulators — keep the elbow angle there too.
    for (const reach of [1.35, 1.1, 0.92, 0.8]) {
      frames.push(
        frame(t, { rightReach: reach, rightWristSpeed: 1.8, rightElbowAngle: elbowAngle }),
      );
      t += 40;
    }
    return runPunches(frames);
  }

  it("classifies a forward punch with lateral drift as a jab, not a hook", () => {
    // Dominant drive is toward the camera (z); the sideways component alone
    // used to satisfy the 2D hook test.
    const punches = punchWithVelocity({ x: 1.0, y: -0.3, z: -3.5 }, 120);
    expect(punches).toHaveLength(1);
    expect(punches[0]).toMatchObject({ punchType: "JAB" });
  });

  it("classifies a lateral bent-elbow swing as a hook", () => {
    const punches = punchWithVelocity({ x: 3.0, y: -0.4, z: -0.6 }, 110);
    expect(punches).toHaveLength(1);
    expect(punches[0]).toMatchObject({ punchType: "HOOK" });
  });

  it("does not call a straight-arm lateral swing a hook", () => {
    const punches = punchWithVelocity({ x: 3.0, y: -0.4, z: -0.6 }, 175);
    expect(punches).toHaveLength(1);
    expect(punches[0]).toMatchObject({ punchType: "JAB" });
  });
});

describe("BlockDetector (TDD §13, §25.2)", () => {
  // Realistic normalized magnitudes: normalize.ts divides raw z by the image
  // shoulder width (~0.2–0.35), so depth values are amplified. The nose sits
  // around one shoulder width in front of the shoulder plane; guard wrists
  // roughly half a width in front of the nose.
  const NOSE = { x: 0, y: -0.9, z: -1.0 };

  const guardUp = (t: number) =>
    frame(t, {
      leftWrist: { x: -0.3, y: -0.6, z: -1.6 },
      rightWrist: { x: 0.3, y: -0.6, z: -1.6 },
      leftWristDepthFromNose: -0.6,
      rightWristDepthFromNose: -0.6,
      leftElbowAngle: 60,
      rightElbowAngle: 60,
    });

  const guardDown = (t: number) => frame(t); // wrists low, arms relaxed

  it("emits one BLOCK_START after 150ms of a held guard", () => {
    const detector = new BlockDetector();
    const actions: DetectedAction[] = [];
    for (let i = 0; i < 10; i++) {
      actions.push(...detector.update(guardUp(1000 + i * 40), NOSE));
    }
    const starts = actions.filter((a) => a.type === "BLOCK_START");
    expect(starts).toHaveLength(1);
    expect(detector.isBlocking()).toBe(true);
  });

  it("emits one BLOCK_END after 100ms of release", () => {
    const detector = new BlockDetector();
    const actions: DetectedAction[] = [];
    let t = 1000;
    for (let i = 0; i < 10; i++, t += 40) {
      actions.push(...detector.update(guardUp(t), NOSE));
    }
    for (let i = 0; i < 10; i++, t += 40) {
      actions.push(...detector.update(guardDown(t), NOSE));
    }
    expect(actions.filter((a) => a.type === "BLOCK_START")).toHaveLength(1);
    expect(actions.filter((a) => a.type === "BLOCK_END")).toHaveLength(1);
    expect(detector.isBlocking()).toBe(false);
  });

  it("does not flicker from a single bad frame", () => {
    const detector = new BlockDetector();
    const actions: DetectedAction[] = [];
    let t = 1000;
    for (let i = 0; i < 8; i++, t += 40) {
      actions.push(...detector.update(guardUp(t), NOSE));
    }
    // One dropped frame inside an otherwise held block.
    actions.push(...detector.update(guardDown(t), NOSE));
    t += 40;
    for (let i = 0; i < 8; i++, t += 40) {
      actions.push(...detector.update(guardUp(t), NOSE));
    }
    expect(actions.filter((a) => a.type === "BLOCK_START")).toHaveLength(1);
    expect(actions.filter((a) => a.type === "BLOCK_END")).toHaveLength(0);
  });

  it("ignores a guard pose at low confidence", () => {
    const detector = new BlockDetector();
    const actions: DetectedAction[] = [];
    for (let i = 0; i < 10; i++) {
      const f = guardUp(1000 + i * 40);
      actions.push(...detector.update({ ...f, confidence: 0.4 }, NOSE));
    }
    expect(actions).toHaveLength(0);
  });

  it("rejects arms reaching toward the camera at face height", () => {
    // In 2D the wrists overlap the head region and the elbows are bent, but
    // the wrists sit far in front of the head plane — not a guard.
    const detector = new BlockDetector();
    const actions: DetectedAction[] = [];
    for (let i = 0; i < 10; i++) {
      actions.push(
        ...detector.update(
          frame(1000 + i * 40, {
            leftWrist: { x: -0.3, y: -0.6, z: -3.4 },
            rightWrist: { x: 0.3, y: -0.6, z: -3.4 },
            leftWristDepthFromNose: -2.4,
            rightWristDepthFromNose: -2.4,
            leftElbowAngle: 110,
            rightElbowAngle: 110,
          }),
          NOSE,
        ),
      );
    }
    expect(actions).toHaveLength(0);
    expect(detector.isBlocking()).toBe(false);
  });

  it("forceEnd emits BLOCK_END when tracking is lost mid-block", () => {
    const detector = new BlockDetector();
    for (let i = 0; i < 10; i++) {
      detector.update(guardUp(1000 + i * 40), NOSE);
    }
    expect(detector.isBlocking()).toBe(true);
    const ended = detector.forceEnd(2000);
    expect(ended).toHaveLength(1);
    expect(ended[0].type).toBe("BLOCK_END");
  });
});
