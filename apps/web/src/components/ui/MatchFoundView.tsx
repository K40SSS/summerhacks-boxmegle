"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Press_Start_2P } from "next/font/google";
import { FighterModel } from "@/components/fighter/FighterModel";

const pixelFont = Press_Start_2P({
  weight: "400",
  subsets: ["latin"],
});

const DUCK_ART = String.raw`   __
<(o )___
 ( ._> /
  \___/`;

const TAGLINES = [
  "certified quackfluent opponent",
  "waddles like a butterfly, stings like a bee",
  "this duck has never lost a fight (unverified)",
  "beware: known to bite below the belt",
  "100% duck, 0% mercy",
];

const COUNTDOWN_FROM = 3;
const RING_SIZE = 84;
const RING_STROKE = 4;
const RING_RADIUS = RING_SIZE / 2 - RING_STROKE;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function CountdownRing({ seconds }: { seconds: number }) {
  return (
    <div
      className="relative"
      style={{ width: RING_SIZE, height: RING_SIZE }}
    >
      <svg
        width={RING_SIZE}
        height={RING_SIZE}
        className="-rotate-90"
      >
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          fill="none"
          stroke="#e4e4e7"
          strokeWidth={RING_STROKE}
        />
        <circle
          key={seconds}
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          fill="none"
          stroke="#e01834"
          strokeWidth={RING_STROKE}
          strokeLinecap="round"
          strokeDasharray={RING_CIRCUMFERENCE}
          className="animate-countdown-ring"
          style={{ ["--ring-circumference" as string]: RING_CIRCUMFERENCE }}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-mono text-2xl font-bold text-black">
        {seconds}
      </span>
    </div>
  );
}

export interface MatchFoundViewProps {
  session: string | null;
  isHost: boolean;
}

export function MatchFoundView({ session, isHost }: MatchFoundViewProps) {
  const [count, setCount] = useState(COUNTDOWN_FROM);
  const [tagline, setTagline] = useState(TAGLINES[0]);

  useEffect(() => {
    setTagline(TAGLINES[Math.floor(Math.random() * TAGLINES.length)]);
  }, []);

  useEffect(() => {
    if (count <= 0) return;
    const id = setTimeout(() => setCount((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [count]);

  const ringing = count > 0;

  return (
    <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden font-sans">
      <FighterModel withRing sparring spinSeconds={18} className="fixed inset-0 -z-10" />

      <header className="absolute left-0 right-0 top-0 z-10 flex items-center justify-between px-6 py-5 sm:px-10">
        <span
          className={`${pixelFont.className} text-[10px] text-black [image-rendering:pixelated]`}
        >
          boxmegle
        </span>
        <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
          {isHost ? "host" : "guest"}
        </span>
      </header>

      <main className="relative z-10 flex w-full max-w-xl flex-col items-center gap-8 px-6 py-24 text-center">
        <p className="rounded-md bg-white px-4 py-2 font-mono text-sm uppercase tracking-[0.3em] text-zinc-500">
          status: matched
        </p>

        <h1 className="text-4xl font-bold uppercase leading-tight tracking-tight text-black sm:text-6xl">
          Match
          <br />
          found
        </h1>

        <div className="flex items-center gap-6 font-mono text-sm uppercase tracking-widest">
          <div className="flex flex-col items-center gap-1">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: "#e01834" }}
            />
            <span className="text-black">you</span>
          </div>
          <span className="text-lg font-bold text-zinc-400">vs</span>
          <div className="flex flex-col items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-zinc-800" />
            <span className="text-black">stranger</span>
          </div>
        </div>

        <div className="flex w-full max-w-xs flex-col items-center gap-2 rounded-sm border border-black/10 bg-white px-6 py-4 shadow-lg">
          <pre className="animate-duck-bob font-mono text-sm leading-tight text-black">
            {DUCK_ART}
          </pre>
          <p className="font-mono text-[11px] uppercase tracking-widest text-zinc-500">
            {tagline}
          </p>
        </div>

        <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-400">
          session {session ?? "—"} · {isHost ? "host" : "guest"}
        </p>

        {ringing ? (
          <div className="flex flex-col items-center gap-2">
            <CountdownRing seconds={count} />
            <p className="font-mono text-sm uppercase tracking-widest text-zinc-600">
              entering ring
            </p>
          </div>
        ) : (
          <p className="font-mono text-sm uppercase tracking-widest text-zinc-600">
            your opponent is warming up
          </p>
        )}

        <p className="text-xs text-zinc-400">
          The fight experience is coming soon.
        </p>

        <Link
          href="/"
          className="rounded-sm border border-black px-10 py-3 font-mono text-sm uppercase tracking-widest text-black transition-colors hover:bg-black hover:text-white"
        >
          Leave
        </Link>
      </main>
    </div>
  );
}
