/**
 * PoseEngine — main-thread owner of the pose worker.
 *
 * Grabs ImageBitmaps from a video element at a capped rate and forwards them
 * to the worker, republishing results (landmarks for the overlay, semantic
 * DetectedActions, tracking quality) to subscribers.
 */

import type { PoseWorkerInMessage, PoseWorkerOutMessage } from "./types";

const WASM_PATH = "/mediapipe/wasm";
const MODEL_PATH = "/models/pose_landmarker_lite.task";

export type PoseResultMessage = Extract<PoseWorkerOutMessage, { type: "POSE_RESULT" }>;

interface EngineCallbacks {
  onPoseResult?: (msg: PoseResultMessage) => void;
  onReady?: () => void;
  onInitError?: (message: string) => void;
}

export class PoseEngine {
  private worker: Worker | null = null;
  private video: HTMLVideoElement | null = null;
  private running = false;
  private busy = false;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private callbacks: EngineCallbacks = {};
  private ready = false;
  private readyPromise: Promise<void>;
  private readyResolve!: () => void;
  private readyReject!: (err: Error) => void;
  private targetFps = 24;

  constructor() {
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
  }

  setCallbacks(callbacks: EngineCallbacks): void {
    this.callbacks = callbacks;
  }

  async init(): Promise<void> {
    if (this.worker) return this.readyPromise;

    this.worker = new Worker(new URL("./pose.worker.ts", import.meta.url));
    this.worker.onmessage = (event: MessageEvent<PoseWorkerOutMessage>) => {
      this.handleMessage(event.data);
    };
    this.worker.onerror = (event) => {
      this.readyReject(new Error(event.message || "Pose worker failed"));
    };

    this.post({ type: "INIT", wasmPath: WASM_PATH, modelPath: MODEL_PATH });
    return this.readyPromise;
  }

  isReady(): boolean {
    return this.ready;
  }

  attachVideo(video: HTMLVideoElement): void {
    this.video = video;
  }

  start(targetFps = 24): void {
    this.targetFps = targetFps;
    if (this.running) return;
    this.running = true;
    const frameInterval = Math.max(16, Math.round(1000 / this.targetFps));

    this.intervalId = setInterval(() => {
      void this.captureFrame();
    }, frameInterval);
  }

  stop(): void {
    this.running = false;
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  reset(): void {
    this.post({ type: "RESET" });
  }

  dispose(): void {
    this.stop();
    this.worker?.terminate();
    this.worker = null;
    this.ready = false;
  }

  private async captureFrame(): Promise<void> {
    if (!this.video || this.busy || !this.ready) return;
    if (this.video.readyState < 2 || this.video.videoWidth === 0) return;

    this.busy = true;
    try {
      const bitmap = await createImageBitmap(this.video);
      this.post({ type: "PROCESS_FRAME", bitmap, timestamp: performance.now() }, [bitmap]);
    } catch {
      this.busy = false;
    }
  }

  private handleMessage(msg: PoseWorkerOutMessage): void {
    switch (msg.type) {
      case "READY":
        this.ready = true;
        this.readyResolve();
        this.callbacks.onReady?.();
        break;
      case "INIT_ERROR":
        this.readyReject(new Error(msg.message));
        this.callbacks.onInitError?.(msg.message);
        break;
      case "POSE_RESULT":
        this.busy = false;
        this.callbacks.onPoseResult?.(msg);
        break;
    }
  }

  private post(msg: PoseWorkerInMessage, transfer: Transferable[] = []): void {
    this.worker?.postMessage(msg, transfer);
  }
}

/** Singleton — one camera pipeline per client. */
let engine: PoseEngine | null = null;

export function getPoseEngine(): PoseEngine {
  if (!engine) {
    engine = new PoseEngine();
  }
  return engine;
}
