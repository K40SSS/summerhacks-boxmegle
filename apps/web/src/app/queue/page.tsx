"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Press_Start_2P } from "next/font/google";
import { QueueBackground } from "@/components/queue/QueueBackground";
import { ServerStatusCard } from "@/components/ui/ServerStatusCard";

const pixelFont = Press_Start_2P({
  weight: "400",
  subsets: ["latin"],
});

const MATCHMAKER_URL =
  process.env.NEXT_PUBLIC_MATCHMAKER_URL ?? "http://localhost:4000";

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

export default function QueuePage() {
  const [matchmakerUp, setMatchmakerUp] = useState<boolean | null>(null);

  useEffect(() => {
    fetch(`${MATCHMAKER_URL}/health`)
      .then((res) => setMatchmakerUp(res.ok))
      .catch(() => setMatchmakerUp(false));
  }, []);

  return (
    <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden font-sans">
      <QueueBackground />

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
            <span className="text-black">—</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-zinc-400">est. wait</span>
            <span className="text-black">—</span>
          </div>
        </div>

        <Link
          href="/"
          className="rounded-sm border border-black px-10 py-3 font-mono text-sm uppercase tracking-widest text-black transition-colors hover:bg-black hover:text-white"
        >
          Leave queue
        </Link>

        <p className="text-xs text-zinc-400">
          Waiting room etiquette: no shadowboxing in the ring. Your opponent
          is on their way.
        </p>
      </main>

      <ServerStatusCard online={matchmakerUp} />
    </div>
  );
}
