"use client";

import { useEffect, useState } from "react";

const MAX_HEALTH = 100;
const MAX_STAMINA = 100;
const MAX_BLOCK = 100;
const BURST_COOLDOWN_S = 12;

function formatClock(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const PIXEL_SHADOW = "shadow-[4px_4px_0_0_rgba(0,0,0,0.9)]";
const SEGMENTED_BAR_BG = {
  backgroundImage:
    "repeating-linear-gradient(90deg, transparent 0 6px, rgba(0,0,0,0.55) 6px 8px)",
};

/** One segmented status bar (health/stamina/block), mirrored for the right-side player. */
function StatusBar({
  value,
  max,
  colorClass,
  heightClass,
  mirrored,
}: {
  value: number;
  max: number;
  colorClass: string;
  heightClass: string;
  mirrored: boolean;
}) {
  return (
    <div
      className={`${heightClass} w-full overflow-hidden border-2 border-white bg-black`}
      style={SEGMENTED_BAR_BG}
    >
      <div
        className={`h-full ${colorClass} transition-[width] duration-300 ${mirrored ? "ml-auto" : ""}`}
        style={{ width: `${(value / max) * 100}%` }}
      />
    </div>
  );
}

/**
 * Top status bar (health/stamina/block per player) + burst meter for the
 * fight screen. All values here are mocked locally (no server state yet) so
 * the layout can be wired up before real match state exists.
 */
export function FightHud() {
  const [timeLeft, setTimeLeft] = useState(72);
  const [round] = useState(1);
  const [leftHealth] = useState(40);
  const [rightHealth] = useState(46);
  const [leftStamina] = useState(70);
  const [rightStamina] = useState(85);
  const [leftBlock] = useState(100);
  const [rightBlock] = useState(28);
  const [burstCharges] = useState(2);
  const [burstCooldown, setBurstCooldown] = useState(12);

  useEffect(() => {
    const id = setInterval(() => {
      setTimeLeft((t) => (t > 0 ? t - 1 : 0));
      setBurstCooldown((c) => (c > 0 ? Math.max(0, c - 1) : BURST_COOLDOWN_S));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const burstProgress = burstCooldown / BURST_COOLDOWN_S;

  return (
    <>
      {/* top status bar */}
      <div className="absolute top-0 left-0 right-0 z-10 px-4 pt-4 sm:px-8 sm:pt-6">
        <div className="grid grid-cols-3 items-start gap-3 font-mono">
          <div className="flex justify-start">
            <div
              className={`border-2 border-white bg-black/80 px-3 py-1.5 ${PIXEL_SHADOW}`}
            >
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 border border-white bg-blue-500" />
                <span className="text-sm font-bold tracking-[0.25em] text-blue-400 sm:text-base">
                  YOU
                </span>
              </div>
            </div>
          </div>

          <div className="flex justify-center">
            <div
              className={`flex flex-col items-center border-2 border-white bg-black/80 px-4 py-1.5 ${PIXEL_SHADOW}`}
            >
              <span className="text-2xl font-bold tabular-nums tracking-widest text-white sm:text-3xl">
                {formatClock(timeLeft)}
              </span>
              <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-yellow-400 sm:text-xs">
                round {round}
              </span>
            </div>
          </div>

          <div className="flex justify-end">
            <div
              className={`border-2 border-white bg-black/80 px-3 py-1.5 ${PIXEL_SHADOW}`}
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold tracking-[0.25em] text-red-400 sm:text-base">
                  OPPONENT
                </span>
                <span className="h-3 w-3 border border-white bg-red-500" />
              </div>
            </div>
          </div>
        </div>

        <div className="mt-3 flex items-start gap-4">
          <div className="flex-1 space-y-1.5">
            <div>
              <StatusBar
                value={leftHealth}
                max={MAX_HEALTH}
                colorClass="bg-blue-500"
                heightClass="h-5 sm:h-6"
                mirrored={false}
              />
              <span className="mt-1 block font-mono text-lg font-bold text-white sm:text-xl">
                {leftHealth}
              </span>
            </div>
            <StatusBar
              value={leftStamina}
              max={MAX_STAMINA}
              colorClass="bg-emerald-500"
              heightClass="h-2 sm:h-2.5"
              mirrored={false}
            />
            <StatusBar
              value={leftBlock}
              max={MAX_BLOCK}
              colorClass="bg-yellow-400"
              heightClass="h-2 sm:h-2.5"
              mirrored={false}
            />
          </div>
          <div className="flex-1 space-y-1.5">
            <div>
              <StatusBar
                value={rightHealth}
                max={MAX_HEALTH}
                colorClass="bg-red-500"
                heightClass="h-5 sm:h-6"
                mirrored={true}
              />
              <span className="mt-1 block text-right font-mono text-lg font-bold text-white sm:text-xl">
                {rightHealth}
              </span>
            </div>
            <StatusBar
              value={rightStamina}
              max={MAX_STAMINA}
              colorClass="bg-emerald-500"
              heightClass="h-2 sm:h-2.5"
              mirrored={true}
            />
            <StatusBar
              value={rightBlock}
              max={MAX_BLOCK}
              colorClass="bg-yellow-400"
              heightClass="h-2 sm:h-2.5"
              mirrored={true}
            />
          </div>
        </div>
      </div>

      {/* burst meter, local player */}
      <div className="absolute bottom-6 left-6 z-10 flex items-center gap-4 font-mono">
        <div className="text-left">
          <span className="block text-3xl font-bold text-white sm:text-4xl">
            ×{burstCharges}
          </span>
          <span className="block text-xs font-bold uppercase tracking-[0.3em] text-white/60">
            burst
          </span>
        </div>
        <div className="relative">
          <svg width="80" height="80" viewBox="0 0 80 80" className="-rotate-90">
            <circle
              cx="40"
              cy="40"
              r="34"
              fill="black"
              fillOpacity="0.6"
              stroke="white"
              strokeWidth="4"
            />
            <circle
              cx="40"
              cy="40"
              r="34"
              fill="none"
              stroke="#f59e0b"
              strokeWidth="5"
              strokeDasharray={2 * Math.PI * 34}
              strokeDashoffset={2 * Math.PI * 34 * (1 - burstProgress)}
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-2xl font-bold tabular-nums text-white">
            {burstCooldown}
          </span>
        </div>
      </div>
    </>
  );
}
