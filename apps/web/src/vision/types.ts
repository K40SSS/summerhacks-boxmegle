/**
 * Vision-layer wire format between the main thread and the pose worker.
 * The worker owns the full pipeline (MediaPipe → normalize → smooth →
 * features → detectors, all from `game-mechanics`) and only reports back
 * semantic results, so the main thread never touches raw landmarks.
 */

import type { DetectedAction, RawLandmark } from "game-mechanics";

export interface TrackingQuality {
  /** 0..1 mean visibility of the upper-body set. */
  confidence: number;
  poseDetected: boolean;
  upperBodyVisible: boolean;
  bothWristsVisible: boolean;
  /** Human-readable corrective instruction, if any. */
  instruction: string | null;
}

export type PoseWorkerInMessage =
  | { type: "INIT"; wasmPath: string; modelPath: string }
  | { type: "PROCESS_FRAME"; bitmap: ImageBitmap; timestamp: number }
  | { type: "RESET" };

export type PoseWorkerOutMessage =
  | { type: "READY" }
  | { type: "INIT_ERROR"; message: string }
  | {
      type: "POSE_RESULT";
      timestamp: number;
      /** Raw landmarks for the overlay canvas (null when no pose). */
      landmarks: RawLandmark[] | null;
      actions: DetectedAction[];
      tracking: TrackingQuality;
      fps: number;
    };
