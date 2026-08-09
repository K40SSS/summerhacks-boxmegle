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

const NAME_PLACEHOLDERS = [
  "Enter your name",
  "Iron Mike Jr.",
  "The guy who skips leg day",
  "Your mom's favorite",
  "Definitely not a bot",
];

export default function Home() {
  const router = useRouter();
  const [matchmakerUp, setMatchmakerUp] = useState<boolean | null>(null);
  const [name, setName] = useState("");
  const [placeholder, setPlaceholder] = useState(NAME_PLACEHOLDERS[0]);
  const [entering, setEntering] = useState(false);

  useEffect(() => {
    setPlaceholder(
      NAME_PLACEHOLDERS[Math.floor(Math.random() * NAME_PLACEHOLDERS.length)],
    );
  }, []);

  useEffect(() => {
    fetch(`${MATCHMAKER_URL}/health`)
      .then((res) => setMatchmakerUp(res.ok))
      .catch(() => setMatchmakerUp(false));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || entering) return;

    setEntering(true);
    try {
      // TODO: replace with real matchmaking (/queue); stubbing a second
      // player here just to exercise /begin_fight end-to-end.
      const player1 = { uuid: crypto.randomUUID(), name: name.trim() };
      const player2 = { uuid: crypto.randomUUID(), name: "Test Opponent" };

      const res = await fetch(`${MATCHMAKER_URL}/begin_fight`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ player1, player2 }),
      });

      if (!res.ok) throw new Error(`begin_fight failed: ${res.status}`);
      const session = await res.json();

      const params = new URLSearchParams({
        session: session.sessionId,
        uuid: player1.uuid,
        opponent: player2.uuid,
        host: String(session.hostUuid === player1.uuid),
      });
      router.push(`/fight?${params.toString()}`);
    } catch (err) {
      console.error(err);
      setEntering(false);
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
        <p className="max-w-sm text-lg leading-6 text-zinc-600">
          Omegle for boxing. Get matched with a random stranger and fight.
          Therapy is expensive. This is free lol.
        </p>
        <form
          onSubmit={handleSubmit}
          className="flex w-full flex-col gap-3 sm:flex-row"
        >
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={placeholder}
            className="h-12 flex-1 rounded-full border border-zinc-300 bg-white/90 px-5 text-base text-black placeholder-zinc-400 shadow-sm outline-none backdrop-blur focus:border-black"
          />
          <button
            type="submit"
            disabled={entering}
            className="flex h-12 items-center justify-center gap-2 rounded-full bg-black px-6 text-base font-medium text-white shadow-sm transition-colors hover:bg-zinc-800 disabled:opacity-50"
          >
            {entering ? "Entering..." : "Enter!"}
          </button>
        </form>
        <p className="text-xs text-zinc-400">
          Mouthguard sold separately. We are not liable for lost teeth or
          lost pride.
        </p>
      </main>
      <ServerStatusCard online={matchmakerUp} />
    </div>
  );
}
