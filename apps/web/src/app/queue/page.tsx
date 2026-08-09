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

  useEffect(() => {
    fetch(`${MATCHMAKER_URL}/health`)
      .then((res) => setMatchmakerUp(res.ok))
      .catch(() => setMatchmakerUp(false));
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

  return (
    <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden font-sans">
      <FighterModel withRing className="fixed inset-0 -z-10" />

      <header className="absolute left-0 right-0 top-0 z-10 flex items-center justify-between px-6 py-5 sm:px-10">
        <span
          className={`${pixelFont.className} text-[10px] text-black [image-rendering:pixelated]`}
        >
          boxmegle
        </span>
        <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
          public queue
        </span>
      </header>

      <main className="relative z-10 flex w-full max-w-xl flex-col items-center gap-9 px-6 py-24 text-center">
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-zinc-500">
          {"// status: awaiting opponent"}
        </p>

        <h1 className="text-4xl font-bold uppercase leading-tight tracking-tight text-black sm:text-6xl">
          Searching for
          <br />
          opponent
        </h1>

        <div className="flex flex-col items-center gap-4">
          <p className="font-mono text-sm uppercase tracking-widest text-zinc-600">
            scanning the void
            <AnimatedEllipsis />
          </p>
          <div className="relative h-1 w-60 overflow-hidden rounded-none bg-zinc-200">
            <div className="animate-queue-scan absolute top-0 left-0 h-full w-1/3 bg-black" />
          </div>
        </div>

        <div className="flex items-center gap-10 font-mono text-xs uppercase tracking-widest text-zinc-500">
          <div className="flex flex-col gap-1">
            <span className="text-zinc-400">players in queue</span>
            <span className="text-black">{playersInQueue}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-zinc-400">est. wait</span>
            <span className="text-black">—</span>
          </div>
        </div>

        {pollFailed && (
          <p className="font-mono text-xs uppercase tracking-widest text-red-600">
            lost connection to matchmaker — still trying
          </p>
        )}

        <button
          type="button"
          onClick={handleLeave}
          className="rounded-sm border border-black px-10 py-3 font-mono text-sm uppercase tracking-widest text-black transition-colors hover:bg-black hover:text-white"
        >
          Leave queue
        </button>

        <p className="text-xs text-zinc-400">
          Waiting room etiquette: no shadowboxing in the ring. Your opponent
          is on their way.
        </p>
      </main>

      <ServerStatusCard online={matchmakerUp} />
    </div>
  );
}

export default function QueuePage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center font-mono text-sm uppercase tracking-widest text-zinc-500">
          querying…
        </div>
      }
    >
      <QueueContent />
    </Suspense>
  );
}
