/**
 * Hitbox resolution — does a punch's endpoint actually land on the defender?
 *
 * This replaces the old dodge system. Evasion is no longer a claim the
 * defender's client makes ("I am dodging, my offset is X"); it is a geometric
 * fact the server computes from the defender's own streamed pose. There is
 * nothing to trust, so there is nothing to clamp, expire, or enforce — a punch
 * either lands inside the body or it doesn't.
 *
 * WHAT COUNTS AS EVASION (important):
 * `normalizeLandmarks` re-centres every frame on the shoulder midpoint, so the
 * shoulder mid is always exactly (0,0) and whole-body translation across the
 * room is erased by construction. Evasion is therefore measured as head
 * movement RELATIVE TO THE SHOULDERS — slipping and rolling, which is what
 * boxing evasion actually is. Ducking by bending at the waist moves the nose
 * down relative to the shoulders and reads correctly; squatting straight down
 * with a rigid torso does not move you in this frame and is not evasion.
 * Standing somewhere else in the room is not evasion either — which is exactly
 * why the old `dodgeMaxHoldMs` cap is no longer needed: leaning forever grants
 * nothing, so there is no exploit left to time out.
 *
 * Frame: the impact point is the attacker's fist mirrored into the defender's
 * body frame (see PunchDetector: `impactX = -wrist.x`), so both arguments are
 * already in the same space — shoulder widths, +x = defender's anatomical
 * right, +y = down, head at negative y.
 */

import { midpoint } from "./geometry";
import type { BodyPoint, NormalizedPose } from "./types";

export type HitZone = "HEAD" | "BODY";

export interface HitboxOptions {
  /** Horizontal radius of the head ellipse, in shoulder widths. */
  headRadiusX: number;
  /** Vertical radius of the head ellipse, in shoulder widths. */
  headRadiusY: number;
  /** Half-width of the torso box, in shoulder widths. */
  torsoHalfWidth: number;
  /**
   * How far above the shoulder line the torso box starts (shoulder widths).
   * Must be large enough to overlap the bottom of the head ellipse, or a
   * punch to the neck lands in a dead zone between the two shapes and reads
   * as a miss.
   */
  torsoTopPadding: number;
  /** How far below the hip line the torso box ends (shoulder widths). */
  torsoBottomPadding: number;
}

/**
 * Deliberately generous. A miss caused by pose jitter feels like the game is
 * broken, whereas a slightly forgiving hitbox just feels like boxing. These
 * are the numbers to tune first if evasion feels too easy or too hard — and
 * note that stun is only a real punish window if the stunned player is
 * reliably hittable, so err large.
 */
export const DEFAULT_HITBOX_OPTIONS: HitboxOptions = {
  headRadiusX: 0.45,
  headRadiusY: 0.5,
  torsoHalfWidth: 0.6,
  torsoTopPadding: 0.5,
  torsoBottomPadding: 0.1,
};

function insideHead(
  impact: { x: number; y: number },
  nose: BodyPoint,
  o: HitboxOptions,
): boolean {
  const dx = (impact.x - nose.x) / o.headRadiusX;
  const dy = (impact.y - nose.y) / o.headRadiusY;
  return dx * dx + dy * dy <= 1;
}

function insideTorso(
  impact: { x: number; y: number },
  pose: NormalizedPose,
  o: HitboxOptions,
): boolean {
  const shoulders = midpoint(pose.leftShoulder, pose.rightShoulder);
  const hips = midpoint(pose.leftHip, pose.rightHip);
  const top = Math.min(shoulders.y, hips.y) - o.torsoTopPadding;
  const bottom = Math.max(shoulders.y, hips.y) + o.torsoBottomPadding;
  const centreX = (shoulders.x + hips.x) / 2;
  return (
    Math.abs(impact.x - centreX) <= o.torsoHalfWidth &&
    impact.y >= top &&
    impact.y <= bottom
  );
}

/**
 * Which zone (if any) a punch endpoint lands on. `null` means the punch found
 * only air — the defender slipped it.
 *
 * Head is tested first so a punch landing in the overlap between the head
 * ellipse and the top of the torso box counts as the headshot.
 */
export function hitboxTest(
  impact: { x: number; y: number },
  pose: NormalizedPose,
  options: HitboxOptions = DEFAULT_HITBOX_OPTIONS,
): HitZone | null {
  if (insideHead(impact, pose.nose, options)) return "HEAD";
  if (insideTorso(impact, pose, options)) return "BODY";
  return null;
}
