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
import { LM, UPPER_BODY_INDICES } from "./types";

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
  // Every joint the body frame is built from must be present: `pick` indexes
  // the array directly, so a gap here would throw rather than degrade. The
  // stream arrives from an untrusted client, so check before touching it.
  for (const index of UPPER_BODY_INDICES) {
    if (!landmarks[index]) return null;
  }

  const ls = landmarks[LM.LEFT_SHOULDER];
  const rs = landmarks[LM.RIGHT_SHOULDER];

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

  // Mean visibility across the UPPER-BODY set only — not the whole array.
  // MediaPipe returns 33 landmarks and scores the ones it cannot see (legs,
  // routinely out of frame at webcam range) near zero. Averaging those in
  // drags a perfectly tracked guard below GAME_RULES.minPunchConfidence and
  // silently disables every detector, since both gate on this value.
  const confidence =
    UPPER_BODY_INDICES.reduce<number>(
      (sum, index) => sum + (landmarks[index].visibility ?? 0),
      0,
    ) /
    UPPER_BODY_INDICES.length;

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
