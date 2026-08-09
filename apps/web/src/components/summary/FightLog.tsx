"use client";

/**
 * Fight log — every completed game for this player, newest first.
 *
 * Reads the real `/profile/:uuid/games` endpoint, which queries the
 * `completed_games` table. Nothing writes that table yet, so a live account
 * comes back with zero rows; rather than showing an empty box the log falls
 * back to sample rows behind an explicit marker, so it is never ambiguous
 * whether you are looking at your fights or at a placeholder.
 *
 * A row links to /summary?game=<id>, which reopens that fight.
 */

import { useEffect, useState } from "react";
import Link from "next/link";

const MATCHMAKER_URL =
  process.env.NEXT_PUBLIC_MATCHMAKER_URL ?? "http://localhost:4000";

export interface LoggedGame {
  id: string;
  sessionId: string | null;
  completedAt: string | null;
  result: "W" | "L" | "D";
  hasReplay: boolean;
  you: { uuid: string; name: string } | null;
  opponent: { uuid: string; name: string } | null;
}

const RESULT_STYLE: Record<LoggedGame["result"], string> = {
  W: "bg-black text-white",
  L: "bg-white text-zinc-500 border border-zinc-300",
  D: "bg-zinc-300 text-zinc-800",
};

/** Sample rows, used only when the account has no recorded fights. */
const SAMPLE_GAMES: LoggedGame[] = [
  { id: "sample-1", sessionId: null, completedAt: null, result: "W", hasReplay: true, you: null, opponent: { uuid: "", name: "Andrew" } },
  { id: "sample-2", sessionId: null, completedAt: null, result: "W", hasReplay: false, you: null, opponent: { uuid: "", name: "Mira" } },
  { id: "sample-3", sessionId: null, completedAt: null, result: "L", hasReplay: true, you: null, opponent: { uuid: "", name: "Sol" } },
  { id: "sample-4", sessionId: null, completedAt: null, result: "D", hasReplay: false, you: null, opponent: { uuid: "", name: "Yuki" } },
  { id: "sample-5", sessionId: null, completedAt: null, result: "W", hasReplay: false, you: null, opponent: { uuid: "", name: "Ren" } },
];

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const mins = Math.floor((Date.now() - then) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function FightLog({ userUuid }: { userUuid: string | null }) {
  const [fetched, setFetched] = useState<LoggedGame[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!userUuid) return;
    let cancelled = false;
    fetch(`${MATCHMAKER_URL}/profile/${encodeURIComponent(userUuid)}/games`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`status ${res.status}`))))
      .then((data: { games?: LoggedGame[] }) => {
        if (!cancelled) setFetched(data.games ?? []);
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
          setFetched([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [userUuid]);

  // With no uuid there is nothing to fetch, so the log is already resolved and
  // empty — derived rather than written, so the effect only ever runs for a
  // real request.
  const games = userUuid ? fetched : [];

  const isSample = games !== null && games.length === 0;
  const rows = isSample ? SAMPLE_GAMES : (games ?? []);

  return (
    <section className="flex w-full flex-col gap-4 rounded-xl border border-black/10 bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="font-mono text-xs font-semibold uppercase tracking-widest text-zinc-800">
          fight log
        </h2>
        <span className="font-mono text-[11px] text-zinc-600">
          {games === null
            ? "loading…"
            : isSample
              ? "sample — no recorded fights yet"
              : `${rows.length} fight${rows.length === 1 ? "" : "s"}`}
        </span>
      </div>

      {failed && (
        <p role="alert" className="font-mono text-[11px] font-semibold text-red-700">
          couldn&apos;t reach the matchmaker — showing sample fights
        </p>
      )}

      {games === null ? (
        <p className="font-mono text-[11px] text-zinc-600">loading fight log…</p>
      ) : (
        <ol className="flex flex-col">
          {rows.map((game) => (
            <li key={game.id}>
              <Link
                href={
                  isSample
                    ? "/summary"
                    : `/summary?game=${encodeURIComponent(game.id)}${userUuid ? `&u=${encodeURIComponent(userUuid)}` : ""}`
                }
                className="flex items-center gap-3 border-t border-black/5 py-3 transition-colors hover:bg-zinc-50"
              >
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md font-mono text-xs font-bold ${RESULT_STYLE[game.result]}`}
                >
                  {game.result}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-black">
                    vs {game.opponent?.name ?? "Unknown"}
                  </span>
                  <span className="block font-mono text-[11px] text-zinc-600">
                    {formatWhen(game.completedAt)}
                    {game.hasReplay && " · replay saved"}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-[11px] uppercase tracking-widest text-zinc-600">
                  view →
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}

      {isSample && (
        <p className="font-mono text-[11px] leading-5 text-zinc-600">
          Finished fights will appear here once matches are written to
          <code className="mx-1 rounded-sm bg-zinc-100 px-1">completed_games</code>.
        </p>
      )}
    </section>
  );
}
