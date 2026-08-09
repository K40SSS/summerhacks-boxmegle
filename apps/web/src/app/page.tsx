"use client";

import { useEffect, useState } from "react";
import { ServerStatusCard } from "@/components/ui/ServerStatusCard";

const MATCHMAKER_URL =
  process.env.NEXT_PUBLIC_MATCHMAKER_URL ?? "http://localhost:4000";

export default function Home() {
  const [matchmakerUp, setMatchmakerUp] = useState<boolean | null>(null);

  useEffect(() => {
    fetch(`${MATCHMAKER_URL}/health`)
      .then((res) => setMatchmakerUp(res.ok))
      .catch(() => setMatchmakerUp(false));
  }, []);

  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex flex-1 w-full max-w-3xl flex-col items-center justify-between py-32 px-16 bg-white dark:bg-black sm:items-start">
        <span className="text-lg font-semibold tracking-tight text-black dark:text-zinc-50">
          Boxmegle
        </span>
        <div className="flex flex-col items-center gap-6 text-center sm:items-start sm:text-left">
          <h1 className="max-w-xs text-3xl font-semibold leading-10 tracking-tight text-black dark:text-zinc-50">
            Omegle for boxing.
          </h1>
          <p className="max-w-md text-lg leading-8 text-zinc-600 dark:text-zinc-400">
            Get matched with a random stranger and fight. No sign-up, no
            names, just you and whoever&apos;s next in the queue.
          </p>
        </div>
        <div className="flex flex-col gap-4 text-base font-medium sm:flex-row">
          <a
            className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-foreground px-5 text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc] md:w-[158px]"
            href="#"
          >
            Start fighting
          </a>
        </div>
      </main>
      <ServerStatusCard online={matchmakerUp} />
    </div>
  );
}
