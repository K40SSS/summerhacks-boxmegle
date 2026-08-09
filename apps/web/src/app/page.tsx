"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Press_Start_2P } from "next/font/google";
import { ServerStatusCard } from "@/components/ui/ServerStatusCard";
import { LandingBackground } from "@/components/landing/LandingBackground";

const pixelFont = Press_Start_2P({
  weight: "400",
  subsets: ["latin"],
});

const MATCHMAKER_URL =
  process.env.NEXT_PUBLIC_MATCHMAKER_URL ?? "http://localhost:4000";

export default function Home() {
  const router = useRouter();
  const [matchmakerUp, setMatchmakerUp] = useState<boolean | null>(null);
  const [name, setName] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${MATCHMAKER_URL}/health`)
      .then((res) => setMatchmakerUp(res.ok))
      .catch(() => setMatchmakerUp(false));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setJoinError("Enter a name first.");
      return;
    }

    setJoining(true);
    setJoinError(null);
    try {
      const res = await fetch(`${MATCHMAKER_URL}/queue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmedName }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.userUuid) {
        setJoinError(data?.error ?? "Couldn't join the queue.");
        return;
      }
      router.push(`/queue?u=${encodeURIComponent(data.userUuid)}`);
    } catch {
      setJoinError("Matchmaker unreachable. Is the server running?");
    } finally {
      setJoining(false);
    }
  };

  return (
    <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden font-sans">
      <LandingBackground />
      <main className="relative z-10 flex w-full max-w-md flex-col items-center gap-10 px-6 py-32 text-center">
        <h1
          className={`${pixelFont.className} text-4xl leading-relaxed tracking-tight text-black [image-rendering:pixelated] sm:text-6xl`}
          style={{ textShadow: "3px 3px 0 rgba(0,0,0,0.15)" }}
        >
          boxmegle
        </h1>
        <form
          onSubmit={handleSubmit}
          className="flex w-full flex-col gap-3 sm:flex-row"
        >
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter your name"
            className="h-12 flex-1 rounded-full border border-zinc-300 bg-white/90 px-5 text-base text-black placeholder-zinc-400 shadow-sm outline-none backdrop-blur focus:border-black"
          />
          <button
            type="submit"
            disabled={joining}
            className="flex h-12 items-center justify-center gap-2 rounded-full bg-black px-6 text-base font-medium text-white shadow-sm transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {joining ? "Joining…" : "Enter!"}
          </button>
        </form>
        {joinError && <p className="text-xs text-red-600">{joinError}</p>}
      </main>
      <ServerStatusCard online={matchmakerUp} />
    </div>
  );
}
