/**
 * Per-frame feature extraction. Exponential smoothing (alpha = 0.35) is
 * applied to normalized points; velocities are derived from smoothed
 * positions.
 */

import { angleAt, distance3D, midpoint, velocity } from "./geometry";
import type { BodyPoint, FrameFeatures, NormalizedPose } from "./types";

export const SMOOTHING_ALPHA = 0.35;

export interface SmoothedPose {
  timestamp: number;
  nose: BodyPoint;
  leftShoulder: BodyPoint;
  rightShoulder: BodyPoint;
  leftElbow: BodyPoint;
  rightElbow: BodyPoint;
  leftWrist: BodyPoint;
  rightWrist: BodyPoint;
  leftHip: BodyPoint;
  rightHip: BodyPoint;
  confidence: number;
  shoulderWidthImage: number;
}

function smoothPoint(prev: BodyPoint, next: BodyPoint): BodyPoint {
  return {
    x: SMOOTHING_ALPHA * next.x + (1 - SMOOTHING_ALPHA) * prev.x,
    y: SMOOTHING_ALPHA * next.y + (1 - SMOOTHING_ALPHA) * prev.y,
    z: SMOOTHING_ALPHA * next.z + (1 - SMOOTHING_ALPHA) * prev.z,
  };
}

export function smoothPose(prev: SmoothedPose, next: NormalizedPose): SmoothedPose {
  return {
    timestamp: next.timestamp,
    nose: smoothPoint(prev.nose, next.nose),
    leftShoulder: smoothPoint(prev.leftShoulder, next.leftShoulder),
    rightShoulder: smoothPoint(prev.rightShoulder, next.rightShoulder),
    leftElbow: smoothPoint(prev.leftElbow, next.leftElbow),
    rightElbow: smoothPoint(prev.rightElbow, next.rightElbow),
    leftWrist: smoothPoint(prev.leftWrist, next.leftWrist),
    rightWrist: smoothPoint(prev.rightWrist, next.rightWrist),
    leftHip: smoothPoint(prev.leftHip, next.leftHip),
    rightHip: smoothPoint(prev.rightHip, next.rightHip),
    confidence: next.confidence,
    shoulderWidthImage: next.shoulderWidthImage,
  };
}

export function poseFromNormalized(p: NormalizedPose): SmoothedPose {
  return { ...p };
}

/** Torso rotation from shoulder depth difference, in radians-ish units. */
function torsoRotationOf(p: SmoothedPose): number {
  const dz = p.leftShoulder.z - p.rightShoulder.z;
  const dx = p.leftShoulder.x - p.rightShoulder.x;
  const dy = p.leftShoulder.y - p.rightShoulder.y;
  const shoulderDist = Math.max(Math.hypot(dx, dy), 1e-4);
  return Math.atan2(dz, shoulderDist);
}

function torsoLeanOf(p: SmoothedPose): number {
  const shoulderMid = midpoint(p.leftShoulder, p.rightShoulder);
  const hipMid = midpoint(p.leftHip, p.rightHip);
  // Horizontal offset of shoulders over hips, in shoulder widths.
  return shoulderMid.x - hipMid.x;
}

export function extractFeatures(
  pose: SmoothedPose,
  prev: FrameFeatures | null,
): FrameFeatures {
  const dtMs = prev ? pose.timestamp - prev.timestamp : 16.7;

  const leftWristVelocity = prev
    ? velocity(prev.leftWrist, pose.leftWrist, dtMs)
    : { x: 0, y: 0, z: 0 };
  const rightWristVelocity = prev
    ? velocity(prev.rightWrist, pose.rightWrist, dtMs)
    : { x: 0, y: 0, z: 0 };

  const leftElbowAngle = angleAt(pose.leftShoulder, pose.leftElbow, pose.leftWrist);
  const rightElbowAngle = angleAt(pose.rightShoulder, pose.rightElbow, pose.rightWrist);
  const leftShoulderAngle = angleAt(pose.leftHip, pose.leftShoulder, pose.leftElbow);
  const rightShoulderAngle = angleAt(pose.rightHip, pose.rightShoulder, pose.rightElbow);

  const leftReach = distance3D(pose.leftShoulder, pose.leftWrist);
  const rightReach = distance3D(pose.rightShoulder, pose.rightWrist);

  const lv = Math.hypot(leftWristVelocity.x, leftWristVelocity.y, leftWristVelocity.z);
  const rv = Math.hypot(rightWristVelocity.x, rightWristVelocity.y, rightWristVelocity.z);

  // Motion energy: sum of squared wrist/elbow speeds — drives activity checks.
  const elbowVelL = prev ? velocity(prev.leftElbow, pose.leftElbow, dtMs) : { x: 0, y: 0, z: 0 };
  const elbowVelR = prev ? velocity(prev.rightElbow, pose.rightElbow, dtMs) : { x: 0, y: 0, z: 0 };
  const motionEnergy =
    lv * lv +
    rv * rv +
    0.5 * (elbowVelL.x ** 2 + elbowVelL.y ** 2 + elbowVelR.x ** 2 + elbowVelR.y ** 2);

  return {
    timestamp: pose.timestamp,
    leftWrist: pose.leftWrist,
    rightWrist: pose.rightWrist,
    leftElbow: pose.leftElbow,
    rightElbow: pose.rightElbow,
    leftWristVelocity,
    rightWristVelocity,
    leftWristSpeed: lv,
    rightWristSpeed: rv,
    leftElbowAngle,
    rightElbowAngle,
    leftShoulderAngle,
    rightShoulderAngle,
    leftReach,
    rightReach,
    leftWristDepthFromNose: pose.leftWrist.z - pose.nose.z,
    rightWristDepthFromNose: pose.rightWrist.z - pose.nose.z,
    torsoRotation: torsoRotationOf(pose),
    torsoLean: torsoLeanOf(pose),
    motionEnergy,
    confidence: pose.confidence,
  };
}
