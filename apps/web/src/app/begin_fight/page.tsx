"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

function BeginFightContent() {
  const searchParams = useSearchParams();
  const session = searchParams.get("session");
  const isHost = searchParams.get("host") === "true";

  return (
    <main className="relative z-10 flex w-full max-w-xl flex-col items-center gap-9 px-6 py-24 text-center">
      <p className="font-mono text-xs uppercase tracking-[0.3em] text-zinc-500">
        {"// status: matched"}
      </p>

      <h1 className="text-4xl font-bold uppercase leading-tight tracking-tight text-black sm:text-6xl">
        Match
        <br />
        found
      </h1>

      <div className="flex flex-col gap-2 font-mono text-sm uppercase tracking-widest text-zinc-600">
        <p>
          session: <span className="text-black">{session ?? "—"}</span>
        </p>
        <p>
          host: <span className="text-black">{isHost ? "yes" : "no"}</span>
        </p>
      </div>

      {/* STUB: the fight experience (peerjs video + websocket game session) lands here later */}
      <p className="text-xs text-zinc-400">
        Your opponent is warming up. The fight experience is coming soon.
      </p>

      <Link
        href="/"
        className="rounded-sm border border-black px-10 py-3 font-mono text-sm uppercase tracking-widest text-black transition-colors hover:bg-black hover:text-white"
      >
        Leave
      </Link>
    </main>
  );
}

export default function BeginFightPage() {
  return (
    <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden font-sans">
      <Suspense fallback={null}>
        <BeginFightContent />
      </Suspense>
    </div>
  );
}
