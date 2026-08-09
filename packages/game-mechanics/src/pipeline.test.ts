/**
 * End-to-end pipeline tests: synthetic MediaPipe landmarks in, actions out.
 *
 * detectors.test.ts drives the FSMs from hand-built FrameFeatures; these go
 * one layer out and check that normalize → smooth → extract → detect is wired
 * together correctly, using landmark arrays shaped like the real thing —
 * 33 points, with the legs scored near-invisible the way a webcam framing
 * from the waist up actually reports them.
 */

import { describe, expect, it } from "vitest";
import { hitboxTest } from "./hitbox";
import { PosePipeline } from "./pipeline";
import { LM, type BodyPoint, type DetectedAction, type RawLandmark } from "./types";

/**
 * Fixtures are authored in the body frame and projected back into image
 * space, which is the direction that keeps them readable. The inverse of
 * normalizeLandmarks for a camera-facing player: the shoulder line is
 * horizontal, so image x runs opposite body x (+x is the player's anatomical
 * right, which appears on the viewer's left) and image y runs with body y.
 */
const IMAGE_ORIGIN = { x: 0.5, y: 0.4, z: 0 };
const IMAGE_SCALE = 0.2;

function toImage(point: BodyPoint, visibility: number): RawLandmark {
  return {
    x: IMAGE_ORIGIN.x - point.x * IMAGE_SCALE,
    y: IMAGE_ORIGIN.y + point.y * IMAGE_SCALE,
    z: IMAGE_ORIGIN.z + point.z * IMAGE_SCALE,
    visibility,
  };
}

interface BodyPose {
  nose: BodyPoint;
  leftShoulder: BodyPoint;
  rightShoulder: BodyPoint;
  leftElbow: BodyPoint;
  rightElbow: BodyPoint;
  leftWrist: BodyPoint;
  rightWrist: BodyPoint;
  leftHip: BodyPoint;
  rightHip: BodyPoint;
}

const UPPER_BODY_VISIBILITY = 0.95;
/** Legs out of frame. Averaging these in is what used to kill confidence. */
const LEG_VISIBILITY = 0.05;

function landmarksFor(pose: BodyPose): RawLandmark[] {
  const landmarks: RawLandmark[] = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.95,
    z: 0,
    visibility: LEG_VISIBILITY,
  }));

  landmarks[LM.NOSE] = toImage(pose.nose, UPPER_BODY_VISIBILITY);
  landmarks[LM.LEFT_SHOULDER] = toImage(pose.leftShoulder, UPPER_BODY_VISIBILITY);
  landmarks[LM.RIGHT_SHOULDER] = toImage(pose.rightShoulder, UPPER_BODY_VISIBILITY);
  landmarks[LM.LEFT_ELBOW] = toImage(pose.leftElbow, UPPER_BODY_VISIBILITY);
  landmarks[LM.RIGHT_ELBOW] = toImage(pose.rightElbow, UPPER_BODY_VISIBILITY);
  landmarks[LM.LEFT_WRIST] = toImage(pose.leftWrist, UPPER_BODY_VISIBILITY);
  landmarks[LM.RIGHT_WRIST] = toImage(pose.rightWrist, UPPER_BODY_VISIBILITY);
  landmarks[LM.LEFT_HIP] = toImage(pose.leftHip, UPPER_BODY_VISIBILITY);
  landmarks[LM.RIGHT_HIP] = toImage(pose.rightHip, UPPER_BODY_VISIBILITY);

  return landmarks;
}

/** Both gloves at the head, elbows folded in. */
const GUARD: BodyPose = {
  nose: { x: 0, y: -0.55, z: 0 },
  leftShoulder: { x: -0.5, y: 0, z: 0 },
  rightShoulder: { x: 0.5, y: 0, z: 0 },
  leftElbow: { x: -0.6, y: 0.35, z: -0.05 },
  rightElbow: { x: 0.6, y: 0.35, z: -0.05 },
  leftWrist: { x: -0.28, y: -0.35, z: -0.15 },
  rightWrist: { x: 0.28, y: -0.35, z: -0.15 },
  leftHip: { x: -0.35, y: 1.4, z: 0 },
  rightHip: { x: 0.35, y: 1.4, z: 0 },
};

/** Arms hanging — outside every block gate. */
const HANDS_DOWN: BodyPose = {
  ...GUARD,
  leftElbow: { x: -0.55, y: 0.6, z: 0 },
  rightElbow: { x: 0.55, y: 0.6, z: 0 },
  leftWrist: { x: -0.5, y: 1.1, z: 0 },
  rightWrist: { x: 0.5, y: 1.1, z: 0 },
};

/** Right arm driven out toward the camera. */
const RIGHT_EXTENDED: BodyPose = {
  ...GUARD,
  rightElbow: { x: 0.5, y: 0.05, z: -0.5 },
  rightWrist: { x: 0.35, y: -0.5, z: -1.0 },
};

const FRAME_MS = 33;

/** Feeds `count` frames of one pose and returns everything detected. */
function feed(
  pipeline: PosePipeline,
  pose: BodyPose,
  count: number,
  startAt: number,
): { actions: DetectedAction[]; nextAt: number } {
  const actions: DetectedAction[] = [];
  let t = startAt;
  for (let i = 0; i < count; i++) {
    const frame = pipeline.update(landmarksFor(pose), t);
    if (frame) actions.push(...frame.actions);
    t += FRAME_MS;
  }
  return { actions, nextAt: t };
}

describe("PosePipeline", () => {
  it("scores confidence from the upper body, ignoring out-of-frame legs", () => {
    const pipeline = new PosePipeline();
    const frame = pipeline.update(landmarksFor(GUARD), 1000);

    // Averaged across all 33 landmarks this would be ~0.30 and every detector
    // would sit permanently below GAME_RULES.minPunchConfidence.
    expect(frame?.features.confidence).toBeCloseTo(UPPER_BODY_VISIBILITY, 5);
  });

  it("emits nothing while standing with hands down", () => {
    const pipeline = new PosePipeline();
    const { actions } = feed(pipeline, HANDS_DOWN, 60, 1000);
    expect(actions).toHaveLength(0);
  });

  it("emits BLOCK_START once a guard is held past the enter window", () => {
    const pipeline = new PosePipeline();
    const { actions } = feed(pipeline, GUARD, 20, 1000);

    expect(actions.filter((a) => a.type === "BLOCK_START")).toHaveLength(1);
    expect(pipeline.blocking).toBe(true);
  });

  it("emits BLOCK_END when the guard drops", () => {
    const pipeline = new PosePipeline();
    const guard = feed(pipeline, GUARD, 20, 1000);
    const dropped = feed(pipeline, HANDS_DOWN, 20, guard.nextAt);

    expect(dropped.actions.filter((a) => a.type === "BLOCK_END")).toHaveLength(1);
    expect(pipeline.blocking).toBe(false);
  });

  it("emits a single punch for one extension of the right arm", () => {
    const pipeline = new PosePipeline();
    // Throw from the guard, not from hands-down: extension is measured
    // against the resting reach, and a hanging arm is already at full reach.
    const idle = feed(pipeline, GUARD, 25, 1000);
    const thrown = feed(pipeline, RIGHT_EXTENDED, 5, idle.nextAt);
    const recovered = feed(pipeline, GUARD, 15, thrown.nextAt);

    const punches = [...thrown.actions, ...recovered.actions].filter((a) => a.type === "PUNCH");
    expect(punches).toHaveLength(1);
    expect(punches[0]).toMatchObject({ hand: "RIGHT" });
    // Mirrored into the defender's frame, so the attacker's right lands on
    // the defender's left.
    expect(punches[0].type === "PUNCH" && punches[0].impactX).toBeLessThan(0);
  });

  it("exposes a pose that hitboxTest can consume directly", () => {
    const pipeline = new PosePipeline();
    const frame = pipeline.update(landmarksFor(GUARD), 1000);

    expect(frame).not.toBeNull();
    expect(hitboxTest({ x: 0, y: -0.55 }, frame!.pose)).toBe("HEAD");
    expect(hitboxTest({ x: 0, y: 0.7 }, frame!.pose)).toBe("BODY");
    expect(hitboxTest({ x: 3, y: 0 }, frame!.pose)).toBeNull();
  });

  it("returns null for landmarks missing a required joint", () => {
    const pipeline = new PosePipeline();
    const landmarks = landmarksFor(GUARD);
    landmarks.length = LM.LEFT_HIP; // truncate below the hips

    expect(pipeline.update(landmarks, 1000)).toBeNull();
  });

  it("forceEndBlock closes a held guard exactly once", () => {
    const pipeline = new PosePipeline();
    feed(pipeline, GUARD, 20, 1000);

    expect(pipeline.forceEndBlock(2000).map((a) => a.type)).toEqual(["BLOCK_END"]);
    expect(pipeline.forceEndBlock(2100)).toHaveLength(0);
  });

  it("reset clears smoothing and both detectors", () => {
    const pipeline = new PosePipeline();
    feed(pipeline, GUARD, 20, 1000);
    pipeline.reset();

    expect(pipeline.pose).toBeNull();
    expect(pipeline.blocking).toBe(false);
  });
});
