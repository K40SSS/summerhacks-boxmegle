"use client";

import { useEffect, useState } from "react";
import { decodeReplay, type ReplayTape } from "game-mechanics";

const MATCHMAKER_URL =
  process.env.NEXT_PUBLIC_MATCHMAKER_URL ?? "http://localhost:4000";

/**
 * `pending` is the normal state for the first seconds after a fight: the
 * server writes the row before it finishes uploading the tape, so the summary
 * can load immediately and the replay fills in behind it. `missing` is
 * terminal — a fight recorded before replays existed, or one whose upload
 * failed — and the page shows the fight without a replay rather than waiting.
 */
export type ReplayStatus = "idle" | "loading" | "pending" | "ready" | "missing" | "error";

const RETRY_MS = 1_500;
/** Stop polling eventually; an upload that hasn't landed by now isn't coming. */
const MAX_WAIT_MS = 45_000;

export interface ReplayLoad {
  tape: ReplayTape | null;
  status: ReplayStatus;
}

/**
 * Fetch and decode a fight's replay tape, polling while it uploads.
 *
 * The tape is a few hundred KB of binary, decoded once into typed arrays that
 * playback then reads directly — so this deliberately returns the decoded
 * `ReplayTape` and not React state per frame. Scrubbing reads the arrays; it
 * does not re-render this hook.
 */
export function useReplay(gameId: string | null): ReplayLoad {
  const [load, setLoad] = useState<ReplayLoad>({
    tape: null,
    status: gameId ? "loading" : "idle",
  });
  const [loadedFor, setLoadedFor] = useState(gameId);

  // Reset during render rather than in the effect: pointing the hook at a
  // different fight must not leave the previous tape visible for a frame, and
  // an effect would only clear it after that frame had already painted.
  if (loadedFor !== gameId) {
    setLoadedFor(gameId);
    setLoad({ tape: null, status: gameId ? "loading" : "idle" });
  }

  useEffect(() => {
    if (!gameId) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const startedAt = Date.now();

    const attempt = async () => {
      try {
        const res = await fetch(
          `${MATCHMAKER_URL}/games/${encodeURIComponent(gameId)}/replay`,
          { signal: controller.signal },
        );
        if (cancelled) return;

        if (res.status === 202) {
          if (Date.now() - startedAt > MAX_WAIT_MS) {
            setLoad({ tape: null, status: "missing" });
            return;
          }
          setLoad({ tape: null, status: "pending" });
          timer = setTimeout(() => void attempt(), RETRY_MS);
          return;
        }
        if (res.status === 404) {
          setLoad({ tape: null, status: "missing" });
          return;
        }
        if (!res.ok) {
          setLoad({ tape: null, status: "error" });
          return;
        }

        const tape = decodeReplay(await res.arrayBuffer());
        if (!cancelled) setLoad({ tape, status: "ready" });
      } catch (err) {
        // An abort is this effect being cleaned up, not a failure.
        if (cancelled || (err instanceof DOMException && err.name === "AbortError")) return;
        console.error("failed to load replay", err);
        setLoad({ tape: null, status: "error" });
      }
    };

    void attempt();
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [gameId]);

  return load;
}
