/**
 * Pure geometry helpers shared by normalization, feature extraction and the
 * detectors.
 */

import type { BodyPoint } from "./types";

export function distance2D(a: BodyPoint, b: BodyPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function distance3D(a: BodyPoint, b: BodyPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function midpoint(a: BodyPoint, b: BodyPoint): BodyPoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}

export function subtract(a: BodyPoint, b: BodyPoint): BodyPoint {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function magnitude(v: BodyPoint): number {
  return Math.hypot(v.x, v.y, v.z);
}

/**
 * Angle at vertex `b` formed by points a–b–c, in degrees (0..180).
 * Returns NaN if either segment has zero length.
 */
export function angleAt(a: BodyPoint, b: BodyPoint, c: BodyPoint): number {
  const abx = a.x - b.x;
  const aby = a.y - b.y;
  const abz = a.z - b.z;
  const cbx = c.x - b.x;
  const cby = c.y - b.y;
  const cbz = c.z - b.z;

  const abLen = Math.hypot(abx, aby, abz);
  const cbLen = Math.hypot(cbx, cby, cbz);
  if (abLen === 0 || cbLen === 0) return NaN;

  const dot = (abx * cbx + aby * cby + abz * cbz) / (abLen * cbLen);
  const clamped = Math.max(-1, Math.min(1, dot));
  return (Math.acos(clamped) * 180) / Math.PI;
}

/** Per-second velocity between two samples. */
export function velocity(prev: BodyPoint, next: BodyPoint, dtMs: number): BodyPoint {
  const dt = Math.max(dtMs, 1) / 1000;
  return {
    x: (next.x - prev.x) / dt,
    y: (next.y - prev.y) / dt,
    z: (next.z - prev.z) / dt,
  };
}

/** Unsigned horizontal direction change between two velocity vectors, degrees. */
export function directionChange(a: BodyPoint, b: BodyPoint): number {
  const ma = Math.hypot(a.x, a.y);
  const mb = Math.hypot(b.x, b.y);
  if (ma === 0 || mb === 0) return 0;
  const dot = (a.x * b.x + a.y * b.y) / (ma * mb);
  const clamped = Math.max(-1, Math.min(1, dot));
  return (Math.acos(clamped) * 180) / Math.PI;
}
