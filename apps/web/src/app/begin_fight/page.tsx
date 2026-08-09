"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MatchFoundView } from "@/components/ui/MatchFoundView";

function BeginFightContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const session = searchParams.get("session");
  const uuid = searchParams.get("uuid");
  const opponent = searchParams.get("opponent");
  const isHost = searchParams.get("host") === "true";

  const handleCountdownComplete = () => {
    if (!session || !uuid || !opponent) {
      console.warn(`[begin_fight] missing match details`, { session, uuid, opponent });
      return;
    }

    const params = new URLSearchParams({
      session,
      uuid,
      opponent,
      host: String(isHost),
    });
    console.log(`[begin_fight:${uuid}] countdown done, navigating to /fight?${params.toString()}`);
    router.push(`/fight?${params.toString()}`);
  };

  return (
    <MatchFoundView
      session={session}
      isHost={isHost}
      onCountdownComplete={handleCountdownComplete}
    />
  );
}

export default function BeginFightPage() {
  return (
    <Suspense fallback={null}>
      <BeginFightContent />
    </Suspense>
  );
}
