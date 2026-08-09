"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const COUNTDOWN_SECONDS = 3;

function BeginFightContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const session = searchParams.get("session");
  const uuid = searchParams.get("uuid");
  const opponent = searchParams.get("opponent");
  const isHost = searchParams.get("host") === "true";

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const [cameraStatus, setCameraStatus] = useState("connecting");
  const [secondsLeft, setSecondsLeft] = useState(COUNTDOWN_SECONDS);

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;

    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        if (localVideoRef.current) localVideoRef.current.srcObject = s;
        setCameraStatus("ready");
      })
      .catch((err) => {
        console.error("failed to access camera", err);
        if (!cancelled) setCameraStatus("error");
      });

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    if (!session || !uuid || !opponent) return;

    const id = setInterval(() => {
      setSecondsLeft((s) => s - 1);
    }, 1000);
    return () => clearInterval(id);
  }, [session, uuid, opponent]);

  useEffect(() => {
    if (!session || !uuid || !opponent) {
      console.warn(`[begin_fight] missing match details`, { session, uuid, opponent });
      return;
    }
    if (secondsLeft > 0) return;

    const params = new URLSearchParams({
      session,
      uuid,
      opponent,
      host: String(isHost),
    });
    console.log(`[begin_fight:${uuid}] countdown done, navigating to /fight?${params.toString()}`);
    router.push(`/fight?${params.toString()}`);
  }, [secondsLeft, session, uuid, opponent, isHost, router]);

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

      <div className="relative aspect-video w-full max-w-sm overflow-hidden rounded-sm bg-zinc-900">
        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          muted
          className="h-full w-full object-cover"
        />
        <span className="absolute bottom-2 left-2 text-xs font-medium text-white/70">
          You · camera {cameraStatus}
        </span>
      </div>

      <div className="flex flex-col gap-2 font-mono text-sm uppercase tracking-widest text-zinc-600">
        <p>
          session: <span className="text-black">{session ?? "—"}</span>
        </p>
        <p>
          host: <span className="text-black">{isHost ? "yes" : "no"}</span>
        </p>
      </div>

      <p className="text-xs text-zinc-400">
        {session && uuid && opponent
          ? `Entering the ring in ${Math.max(secondsLeft, 0)}…`
          : "Missing match details — go back and rejoin the queue."}
      </p>
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
