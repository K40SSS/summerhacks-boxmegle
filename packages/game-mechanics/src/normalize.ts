/**
 * Body-relative normalization.
 *
 * origin = midpoint(leftShoulder, rightShoulder)
 * scale  = distance(leftShoulder, rightShoulder)
 * The frame is anatomical and assumes the player faces the camera: +x = the
 * player's anatomical RIGHT, +y = toward the feet (so the head is at
 * negative y). Because the raw feed is unmirrored, this frame is a
 * REFLECTION of image space, not a rotation — a pure rotation that lands
 * the shoulders on ±x would flip y upward and every absolute-sign consumer
 * (uppercut start height, punch impact height, hitbox zone heights) would
 * invert.
 */

import type { BodyPoint, NormalizedPose, RawLandmark } from "./types";
import { LM } from "./types";

export interface NormalizeResult {
  pose: NormalizedPose;
  confidence: number;
}

function toBody(
  p: RawLandmark,
  origin: { x: number; y: number; z: number },
  scale: number,
  cos: number,
  sin: number,
): BodyPoint {
  const dx = (p.x - origin.x) / scale;
  const dy = (p.y - origin.y) / scale;
  // x along the left→right shoulder direction; y along its perpendicular
  // chosen so image-down stays +y for a camera-facing subject (det = -1).
  return {
    x: dx * cos + dy * sin,
    y: dx * sin - dy * cos,
    z: (p.z - origin.z) / scale,
  };
}

export function normalizeLandmarks(
  landmarks: RawLandmark[],
  timestamp: number,
): NormalizeResult | null {
  const ls = landmarks[LM.LEFT_SHOULDER];
  const rs = landmarks[LM.RIGHT_SHOULDER];
  if (!ls || !rs) return null;

  const scale = Math.hypot(ls.x - rs.x, ls.y - rs.y);
  if (scale < 1e-4) return null;

  const origin = {
    x: (ls.x + rs.x) / 2,
    y: (ls.y + rs.y) / 2,
    z: (ls.z + rs.z) / 2,
  };

  // Shoulder line angle; the basis maps the ls→rs direction onto +x.
  const angle = Math.atan2(rs.y - ls.y, rs.x - ls.x);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  const pick = (i: number) => toBody(landmarks[i], origin, scale, cos, sin);

  const confidence =
    landmarks.reduce((sum, lm) => sum + (lm.visibility ?? 0), 0) / landmarks.length;

  return {
    pose: {
      timestamp,
      nose: pick(LM.NOSE),
      leftShoulder: pick(LM.LEFT_SHOULDER),
      rightShoulder: pick(LM.RIGHT_SHOULDER),
      leftElbow: pick(LM.LEFT_ELBOW),
      rightElbow: pick(LM.RIGHT_ELBOW),
      leftWrist: pick(LM.LEFT_WRIST),
      rightWrist: pick(LM.RIGHT_WRIST),
      leftHip: pick(LM.LEFT_HIP),
      rightHip: pick(LM.RIGHT_HIP),
      confidence,
      shoulderWidthImage: scale,
    },
    confidence,
  };
}
