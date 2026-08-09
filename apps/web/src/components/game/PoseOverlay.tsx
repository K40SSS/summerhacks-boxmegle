"use client";

import { useEffect, useRef, type RefObject } from "react";
import { DEFAULT_HITBOX_OPTIONS, LM, type RawLandmark } from "game-mechanics";

const BONES: [number, number][] = [
  [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER],
  [LM.LEFT_SHOULDER, LM.LEFT_ELBOW],
  [LM.LEFT_ELBOW, LM.LEFT_WRIST],
  [LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW],
  [LM.RIGHT_ELBOW, LM.RIGHT_WRIST],
  [LM.LEFT_SHOULDER, LM.LEFT_HIP],
  [LM.RIGHT_SHOULDER, LM.RIGHT_HIP],
  [LM.LEFT_HIP, LM.RIGHT_HIP],
];

const KEY_JOINTS = [LM.LEFT_WRIST, LM.RIGHT_WRIST, LM.LEFT_ELBOW, LM.RIGHT_ELBOW];

/**
 * Skeleton overlay drawn on a canvas above a video element. Reads landmarks
 * from a ref (rather than props/state) so a new frame never triggers a React
 * re-render — the draw loop runs on its own requestAnimationFrame cadence.
 */
export function PoseOverlay({
  videoRef,
  landmarksRef,
  className,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  landmarksRef: RefObject<RawLandmark[] | null>;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const video = videoRef.current;
      const { width: cw, height: ch } = canvas;
      ctx.clearRect(0, 0, cw, ch);
      const landmarks = landmarksRef.current;
      if (!video || !landmarks) return;

      const vw = video.videoWidth || 1280;
      const vh = video.videoHeight || 720;
      // Reproduce object-fit: cover so landmarks sit on the body.
      const scale = Math.max(cw / vw, ch / vh);
      const offsetX = (cw - vw * scale) / 2;
      const offsetY = (ch - vh * scale) / 2;
      const px = (lm: RawLandmark) => ({
        x: lm.x * vw * scale + offsetX,
        y: lm.y * vh * scale + offsetY,
      });

      const lineColor = "rgba(244, 246, 248, 0.9)";
      const missingColor = "rgba(228, 75, 75, 0.95)";

      ctx.lineWidth = Math.max(2, cw / 480);
      ctx.lineCap = "round";

      for (const [a, b] of BONES) {
        const la = landmarks[a];
        const lb = landmarks[b];
        if (!la || !lb) continue;
        const visible = la.visibility > 0.5 && lb.visibility > 0.5;
        ctx.strokeStyle = visible ? lineColor : missingColor;
        const pa = px(la);
        const pb = px(lb);
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.stroke();
      }

      for (const joint of KEY_JOINTS) {
        const lm = landmarks[joint];
        if (!lm) continue;
        const p = px(lm);
        ctx.fillStyle = lm.visibility > 0.5 ? lineColor : missingColor;
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(3, cw / 320), 0, Math.PI * 2);
        ctx.fill();
      }

      const nose = landmarks[LM.NOSE];
      const leftShoulder = landmarks[LM.LEFT_SHOULDER];
      const rightShoulder = landmarks[LM.RIGHT_SHOULDER];
      if (
        nose &&
        nose.visibility > 0.5 &&
        leftShoulder &&
        rightShoulder &&
        leftShoulder.visibility > 0.5 &&
        rightShoulder.visibility > 0.5
      ) {
        const p = px(nose);
        const ls = px(leftShoulder);
        const rs = px(rightShoulder);
        const shoulderWidthPx = Math.hypot(rs.x - ls.x, rs.y - ls.y);
        const radiusX = shoulderWidthPx * DEFAULT_HITBOX_OPTIONS.headRadiusX;
        const radiusY = shoulderWidthPx * DEFAULT_HITBOX_OPTIONS.headRadiusY;

        // Thin, barely-visible dotted outline: this is the actual head
        // hitbox from hitboxTest(), not a pose landmark, so keep it subtle
        // rather than styled like the skeleton bones/joints above.
        ctx.save();
        ctx.strokeStyle = "rgba(244, 246, 248, 0.35)";
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 4]);
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, radiusX, radiusY, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [videoRef, landmarksRef]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={className ?? "absolute inset-0 h-full w-full"}
    />
  );
}
