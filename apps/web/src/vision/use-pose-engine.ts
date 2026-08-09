"use client";

/**
 * usePoseEngine — React lifecycle wrapper around the PoseEngine singleton.
 *
 * Boots the worker, attaches the given video element once it has a stream,
 * and forwards per-frame results. Kept deliberately dumb (no global store) —
 * step 4 (sending DetectedActions to the server) is not wired up yet.
 */

import { useEffect, useRef, useState, type RefObject } from "react";
import { getPoseEngine, type PoseResultMessage } from "./pose-engine";

export interface UsePoseEngineOptions {
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Only start capturing once this is true (e.g. once the stream is live). */
  active: boolean;
  onPoseResult?: (msg: PoseResultMessage) => void;
}

export function usePoseEngine({ videoRef, active, onPoseResult }: UsePoseEngineOptions) {
  const [engineReady, setEngineReady] = useState(() => getPoseEngine().isReady());
  const [engineError, setEngineError] = useState<string | null>(null);
  const onPoseResultRef = useRef(onPoseResult);
  onPoseResultRef.current = onPoseResult;

  useEffect(() => {
    const engine = getPoseEngine();
    let cancelled = false;

    engine.setCallbacks({
      onReady: () => {
        if (!cancelled) setEngineReady(true);
      },
      onInitError: (message) => {
        if (!cancelled) setEngineError(message);
      },
      onPoseResult: (msg) => onPoseResultRef.current?.(msg),
    });

    engine.init().catch((err: unknown) => {
      if (!cancelled) setEngineError(err instanceof Error ? err.message : "Pose engine failed to start");
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!engineReady || !active) return;
    const engine = getPoseEngine();
    const video = videoRef.current;
    if (!video) return;
    engine.attachVideo(video);
    engine.start();
    return () => {
      engine.stop();
    };
  }, [engineReady, active, videoRef]);

  return { engineReady, engineError };
}
