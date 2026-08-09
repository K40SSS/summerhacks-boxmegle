/**
 * Pose worker — runs MediaPipe Pose Landmarker off the main thread and pipes
 * every frame through the game-mechanics pipeline (normalize → smooth →
 * features → punch/block detectors). The main thread only ever sees
 * semantic DetectedActions plus raw landmarks for the debug overlay.
 */

import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import {
  BlockDetector,
  extractFeatures,
  LM,
  normalizeLandmarks,
  poseFromNormalized,
  PunchDetector,
  smoothPose,
  UPPER_BODY_INDICES,
  type DetectedAction,
  type FrameFeatures,
  type RawLandmark,
} from "game-mechanics";
import type { SmoothedPose } from "game-mechanics";
import type { PoseWorkerInMessage, PoseWorkerOutMessage, TrackingQuality } from "./types";

declare const self: DedicatedWorkerGlobalScope;

let landmarker: PoseLandmarker | null = null;

let smoothed: SmoothedPose | null = null;
let prevFeatures: FrameFeatures | null = null;
const punchDetector = new PunchDetector();
const blockDetector = new BlockDetector();

// Pose-loss bookkeeping — end a held block after 250ms without a pose.
let lastPoseAt = 0;
let blockForcedOff = false;

let fpsEma = 0;
let lastFrameAt = 0;

function post(msg: PoseWorkerOutMessage, transfer: Transferable[] = []): void {
  self.postMessage(msg, transfer);
}

async function init(wasmPath: string, modelPath: string): Promise<void> {
  const fileset = await FilesetResolver.forVisionTasks(wasmPath);
  landmarker = await PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: modelPath },
    runningMode: "VIDEO",
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    outputSegmentationMasks: false,
  });
  post({ type: "READY" });
}

function buildTracking(landmarks: RawLandmark[] | null, confidence: number): TrackingQuality {
  const poseDetected = landmarks !== null;
  const vis = (i: number) => (landmarks ? (landmarks[i]?.visibility ?? 0) : 0);

  const upperBodyVisible =
    poseDetected &&
    vis(LM.LEFT_SHOULDER) > 0.5 &&
    vis(LM.RIGHT_SHOULDER) > 0.5 &&
    vis(LM.LEFT_ELBOW) > 0.5 &&
    vis(LM.RIGHT_ELBOW) > 0.5 &&
    vis(LM.LEFT_HIP) > 0.5 &&
    vis(LM.RIGHT_HIP) > 0.5;
  const bothWristsVisible =
    poseDetected && vis(LM.LEFT_WRIST) > 0.5 && vis(LM.RIGHT_WRIST) > 0.5;

  let instruction: string | null = null;
  if (!poseDetected) instruction = "Move into frame";
  else if (!upperBodyVisible) instruction = "Fit your upper body in frame";
  else if (!bothWristsVisible) instruction = "Both wrists must be visible";

  return { confidence, poseDetected, upperBodyVisible, bothWristsVisible, instruction };
}

function reset(): void {
  smoothed = null;
  prevFeatures = null;
  punchDetector.reset();
  blockDetector.reset();
  lastPoseAt = 0;
  blockForcedOff = false;
}

function processFrame(bitmap: ImageBitmap, timestamp: number): void {
  if (!landmarker) {
    bitmap.close();
    return;
  }

  if (lastFrameAt > 0) {
    const inst = 1000 / Math.max(1, timestamp - lastFrameAt);
    fpsEma = fpsEma === 0 ? inst : fpsEma * 0.9 + inst * 0.1;
  }
  lastFrameAt = timestamp;

  let landmarks: RawLandmark[] | null = null;
  try {
    const result = landmarker.detectForVideo(bitmap, timestamp);
    const lm = result.landmarks?.[0];
    if (lm && lm.length >= 33) {
      landmarks = lm.map((p) => ({
        x: p.x,
        y: p.y,
        z: p.z,
        visibility: p.visibility ?? 0,
      }));
    }
  } catch {
    // A single bad inference frame must not kill the pipeline.
  } finally {
    bitmap.close();
  }

  const actions: DetectedAction[] = [];
  let confidence = 0;

  if (landmarks) {
    lastPoseAt = timestamp;
    blockForcedOff = false;

    // Gate on upper-body confidence, mirroring the summer-box pipeline.
    confidence =
      UPPER_BODY_INDICES.reduce((s: number, i) => s + (landmarks![i]?.visibility ?? 0), 0) /
      UPPER_BODY_INDICES.length;

    const normalized = normalizeLandmarks(landmarks, timestamp);
    if (normalized) {
      smoothed = smoothed
        ? smoothPose(smoothed, normalized.pose)
        : poseFromNormalized(normalized.pose);
      const features = extractFeatures(smoothed, prevFeatures);
      prevFeatures = features;

      actions.push(...punchDetector.update(features));
      actions.push(...blockDetector.update(features, smoothed.nose));
    }
  } else if (!blockForcedOff && timestamp - lastPoseAt > 250) {
    // Pose lost for a sustained stretch — force any held block off.
    blockForcedOff = true;
    smoothed = null;
    prevFeatures = null;
  }

  post({
    type: "POSE_RESULT",
    timestamp,
    landmarks,
    actions,
    tracking: buildTracking(landmarks, confidence),
    fps: Math.round(fpsEma),
  });
}

self.onmessage = (event: MessageEvent<PoseWorkerInMessage>) => {
  const msg = event.data;

  switch (msg.type) {
    case "INIT":
      init(msg.wasmPath, msg.modelPath).catch((err: unknown) => {
        post({
          type: "INIT_ERROR",
          message: err instanceof Error ? err.message : String(err),
        });
      });
      break;

    case "PROCESS_FRAME":
      processFrame(msg.bitmap, msg.timestamp);
      break;

    case "RESET":
      reset();
      break;
  }
};

export {};
