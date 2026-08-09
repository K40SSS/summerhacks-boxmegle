"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Press_Start_2P } from "next/font/google";
import { FighterModel } from "@/components/fighter/FighterModel";
import { ServerStatusCard } from "@/components/ui/ServerStatusCard";

const pixelFont = Press_Start_2P({
  weight: "400",
  subsets: ["latin"],
});

const MATCHMAKER_URL =
  process.env.NEXT_PUBLIC_MATCHMAKER_URL ?? "http://localhost:4000";

const POLL_INTERVAL_MS = 1500;

type QueueStatus =
  | {
      matched: true;
      sessionId: string;
      isHost: boolean;
      opponentUuid: string | null;
    }
  | { matched: false; playersInQueue: number; queuePosition: number | null };

function formatElapsed(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function AnimatedEllipsis() {
  const [dots, setDots] = useState(".");

  useEffect(() => {
    const id = setInterval(() => {
      setDots((current) => (current.length >= 3 ? "." : `${current}.`));
    }, 450);
    return () => clearInterval(id);
  }, []);

  return <span className="inline-block w-8 text-left">{dots}</span>;
}

function QueueContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const userUuid = searchParams.get("u");
  const [matchmakerUp, setMatchmakerUp] = useState<boolean | null>(null);
  const [status, setStatus] = useState<QueueStatus | null>(null);
  const [pollFailed, setPollFailed] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    fetch(`${MATCHMAKER_URL}/health`)
      .then((res) => setMatchmakerUp(res.ok))
      .catch(() => setMatchmakerUp(false));
  }, []);

  // A moving clock is the one honest signal here: there is no ETA to give,
  // but "how long have I been waiting" is what the question really is.
  useEffect(() => {
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!userUuid) {
      router.replace("/");
      return;
    }

    let cancelled = false;
    const poll = async () => {
      const startedAt = Date.now();
      try {
        const res = await fetch(
          `${MATCHMAKER_URL}/queue/status?userUuid=${encodeURIComponent(userUuid)}`,
        );
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = (await res.json()) as QueueStatus;
        if (cancelled) return;
        console.log(`[queue:${userUuid}] poll at ${new Date(startedAt).toISOString()} ->`, data);
        if (data.matched) {
          const params = new URLSearchParams({
            session: data.sessionId,
            host: String(data.isHost),
            uuid: userUuid,
          });
          if (data.opponentUuid) params.set("opponent", data.opponentUuid);
          console.log(`[queue:${userUuid}] matched, navigating to /begin_fight?${params.toString()}`);
          router.push(`/begin_fight?${params.toString()}`);
          return;
        }
        setStatus(data);
        setPollFailed(false);
      } catch (err) {
        console.error(`[queue:${userUuid}] poll failed at ${new Date(startedAt).toISOString()}`, err);
        if (!cancelled) setPollFailed(true);
      }
    };

    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [userUuid, router]);

  const handleLeave = async () => {
    if (userUuid) {
      try {
        await fetch(
          `${MATCHMAKER_URL}/queue/leave?userUuid=${encodeURIComponent(userUuid)}`,
          { method: "POST" },
        );
      } catch {
        // best effort; leave the page regardless
      }
    }
    router.push("/");
  };

  if (!userUuid) return null;

  const playersInQueue = status && !status.matched ? status.playersInQueue : "—";
  const queuePosition =
    status && !status.matched && status.queuePosition !== null
      ? `#${status.queuePosition}`
      : "—";

  return (
    <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden font-sans">
      <FighterModel withRing className="fixed inset-0 -z-10" />

      <header className="absolute left-0 right-0 top-0 z-10 flex items-center justify-between px-6 py-5 sm:px-10">
        <span
          className={`${pixelFont.className} text-[10px] text-black [image-rendering:pixelated]`}
        >
          boxmegle
        </span>
        <span className="font-mono text-xs font-medium uppercase tracking-widest text-zinc-700">
          public queue
        </span>
      </header>

      <main className="relative z-10 flex w-full max-w-xl flex-col items-center px-6 py-24 text-center">
        {/* Everything readable lives in one lightly tinted panel. No blur, so
            the ring stays visible through it — the text carries its own
            contrast instead (black headings, zinc-800 labels). */}
        <div className="flex w-full flex-col items-center gap-6 rounded-2xl border border-black/10 bg-white/40 px-8 py-8 shadow-sm">
          <h1 className="text-4xl font-bold uppercase leading-tight tracking-tight text-black sm:text-6xl">
            Searching for
            <br />
            opponent
          </h1>

          <div className="flex w-full max-w-md flex-col items-center gap-3">
            <p className="font-mono text-sm font-semibold uppercase tracking-widest text-zinc-800">
              scanning the void
              <AnimatedEllipsis />
            </p>
            <div className="relative h-3 w-full overflow-hidden rounded-full border border-black/25 bg-white/70">
              <div className="animate-queue-scan absolute inset-y-0 left-0 w-2/5 rounded-full bg-black" />
            </div>
          </div>

          <div className="flex w-full items-start justify-center gap-8 border-t border-black/10 pt-6 font-mono text-xs uppercase tracking-widest sm:gap-12">
            <div className="flex flex-col gap-1.5">
              <span className="font-medium text-zinc-800">in queue</span>
              <span className="text-lg font-bold normal-case tracking-normal text-black">
                {playersInQueue}
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="font-medium text-zinc-800">your position</span>
              <span className="text-lg font-bold normal-case tracking-normal text-black">
                {queuePosition}
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="font-medium text-zinc-800">searching</span>
              <span className="text-lg font-bold normal-case tracking-normal tabular-nums text-black">
                {formatElapsed(elapsed)}
              </span>
            </div>
          </div>

          {pollFailed && (
            <p
              role="alert"
              className="font-mono text-sm font-semibold uppercase tracking-widest text-red-700"
            >
              lost connection to matchmaker — still trying
            </p>
          )}

          <button
            type="button"
            onClick={handleLeave}
            className="rounded-sm border-2 border-black bg-white/60 px-10 py-3 font-mono text-sm font-semibold uppercase tracking-widest text-black transition-colors hover:bg-black hover:text-white"
          >
            Leave queue
          </button>
        </div>
      </main>

      <ServerStatusCard online={matchmakerUp} />
    </div>
  );
}

export default function QueuePage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center font-mono text-sm font-medium uppercase tracking-widest text-zinc-700">
          querying…
        </div>
      }
    >
      <QueueContent />
    </Suspense>
  );
}
