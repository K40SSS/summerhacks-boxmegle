"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Peer, { type MediaConnection } from "peerjs";

const MATCHMAKER_URL =
  process.env.NEXT_PUBLIC_MATCHMAKER_URL ?? "http://localhost:4000";

function wsUrl(path: string) {
  const url = new URL(path, MATCHMAKER_URL);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

export default function Fight() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session");
  const uuid = searchParams.get("uuid");
  const opponentUuid = searchParams.get("opponent");
  const isHost = searchParams.get("host") === "true";

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const [videoStatus, setVideoStatus] = useState("connecting");
  const [socketStatus, setSocketStatus] = useState("connecting");

  useEffect(() => {
    if (!sessionId || !uuid || !opponentUuid) return;

    let cancelled = false;
    let peer: Peer | null = null;
    let localStream: MediaStream | null = null;

    const peerId = `${sessionId}-${uuid}`;
    const opponentPeerId = `${sessionId}-${opponentUuid}`;

    const setupPeer = async () => {
      localStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      if (cancelled) {
        localStream.getTracks().forEach((t) => t.stop());
        return;
      }
      if (localVideoRef.current) localVideoRef.current.srcObject = localStream;

      const matchmakerUrl = new URL(MATCHMAKER_URL);
      peer = new Peer(peerId, {
        host: matchmakerUrl.hostname,
        port: matchmakerUrl.port ? Number(matchmakerUrl.port) : undefined,
        path: "/peerjs",
        secure: matchmakerUrl.protocol === "https:",
      });

      const handleCall = (call: MediaConnection) => {
        call.answer(localStream!);
        call.on("stream", (remoteStream) => {
          if (remoteVideoRef.current)
            remoteVideoRef.current.srcObject = remoteStream;
          setVideoStatus("connected");
        });
      };

      peer.on("call", handleCall);

      peer.on("open", () => {
        if (isHost && localStream) {
          const call = peer!.call(opponentPeerId, localStream);
          call.on("stream", (remoteStream) => {
            if (remoteVideoRef.current)
              remoteVideoRef.current.srcObject = remoteStream;
            setVideoStatus("connected");
          });
        }
      });

      peer.on("error", (err) => {
        console.error("peer error", err);
        setVideoStatus("error");
      });
    };

    setupPeer().catch((err) => {
      console.error("failed to start video", err);
      setVideoStatus("error");
    });

    const socket = new WebSocket(
      wsUrl(`/game_session?sessionId=${sessionId}&playerUuid=${uuid}`),
    );
    socket.onopen = () => setSocketStatus("connected");
    socket.onclose = () => setSocketStatus("disconnected");
    socket.onerror = () => setSocketStatus("error");
    socket.onmessage = (event) => {
      console.log("game_session message", event.data);
    };

    return () => {
      cancelled = true;
      localStream?.getTracks().forEach((t) => t.stop());
      peer?.destroy();
      socket.close();
    };
  }, [sessionId, uuid, opponentUuid, isHost]);

  return (
    <div className="fixed inset-0 flex">
      <div className="relative h-full w-1/2 bg-zinc-900">
        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          muted
          className="h-full w-full object-cover"
        />
        <span className="absolute bottom-4 left-4 text-xs font-medium text-white/70">
          You
        </span>
      </div>
      <div className="relative h-full w-1/2 bg-zinc-900">
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="h-full w-full object-cover"
        />
        <span className="absolute bottom-4 right-4 text-xs font-medium text-white/70">
          Opponent
        </span>
      </div>
      <div className="absolute top-4 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-4 py-1.5 text-center text-xs text-white/80 backdrop-blur">
        session: {sessionId} · video: {videoStatus} · game socket:{" "}
        {socketStatus}
      </div>
    </div>
  );
}
