"use client";

/**
 * Profile — career stats in a grid, with the full fight log underneath.
 *
 * The four stat panels are the ones that used to sit at the bottom of the
 * summary page. They belong here: they are per-player and identical no matter
 * which fight you just finished, so repeating them on every summary was
 * showing career data in a per-match context.
 *
 * The panels still read fixtures (nothing persists per-player aggregates yet).
 * The fight log below is the one part wired to a real query.
 */

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Press_Start_2P } from "next/font/google";
import { FightLog } from "@/components/summary/FightLog";
import {
  Leaderboard,
  PercentilePanel,
  PersonalBests,
  RecordStrip,
} from "@/components/summary/ProfilePanels";
import {
  DEMO_LEADERBOARD,
  DEMO_PROFILE,
  DEMO_STANDING,
} from "@/lib/summary-analytics";

const pixelFont = Press_Start_2P({ weight: "400", subsets: ["latin"] });

function ProfileContent() {
  const searchParams = useSearchParams();
  const userUuid = searchParams.get("u");

  return (
    <div className="relative flex flex-1 flex-col bg-white font-sans">
      <header className="flex items-center justify-between px-6 py-5 sm:px-10">
        <Link
          href="/"
          className={`${pixelFont.className} text-[10px] text-black [image-rendering:pixelated]`}
        >
          boxmegle
        </Link>
        <span className="font-mono text-xs font-medium uppercase tracking-widest text-zinc-700">
          profile
        </span>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 pb-16 pt-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-4xl font-bold uppercase leading-none tracking-tight text-black sm:text-5xl">
            Kai
          </h1>
          <p className="font-mono text-xs text-zinc-700">
            elo 1016 · #{DEMO_STANDING.rank} of{" "}
            {DEMO_STANDING.poolSize.toLocaleString()}
          </p>
        </div>

        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 font-mono text-[11px] text-amber-900">
          sample data — per-player aggregates are not persisted yet. The fight
          log below queries <code className="mx-0.5">completed_games</code> for real.
        </p>

        <div className="grid gap-5 lg:grid-cols-2">
          <RecordStrip
            results={DEMO_PROFILE.recentResults}
            longestStreak={DEMO_PROFILE.longestWinStreak}
            currentStreak={DEMO_PROFILE.currentStreak}
          />
          <PersonalBests bests={DEMO_PROFILE.personalBests} />
          <PercentilePanel
            stats={DEMO_PROFILE.percentiles}
            rank={DEMO_STANDING.rank}
            poolSize={DEMO_STANDING.poolSize}
            percentile={DEMO_STANDING.percentile}
          />
          <Leaderboard rows={DEMO_LEADERBOARD} />
        </div>

        <FightLog userUuid={userUuid} />

        <Link
          href="/"
          className="self-start rounded-sm border-2 border-black px-10 py-3 font-mono text-sm font-semibold uppercase tracking-widest text-black transition-colors hover:bg-black hover:text-white"
        >
          Back to start
        </Link>
      </main>
    </div>
  );
}

export default function ProfilePage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center font-mono text-sm font-medium uppercase tracking-widest text-zinc-700">
          loading profile…
        </div>
      }
    >
      <ProfileContent />
    </Suspense>
  );
}
