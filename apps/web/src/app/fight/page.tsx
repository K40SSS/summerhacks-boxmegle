"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Peer, { type MediaConnection } from "peerjs";
import type { RawLandmark } from "game-mechanics";
import { PoseOverlay } from "@/components/game/PoseOverlay";
import { usePoseEngine } from "@/vision/use-pose-engine";

/** How often to broadcast local landmarks to the opponent over the game socket. */
const POSE_SEND_INTERVAL_MS = 100;

const MATCHMAKER_URL = process.env.NEXT_PUBLIC_MATCHMAKER_URL ?? "http://localhost:4000";

function wsUrl(path: string) {
  const url = new URL(path, MATCHMAKER_URL);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

export default function Fight() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session");
  const uuid = searchParams.get("uuid");
  const opponentUuid = searchParams.get("opponent");
  const isHost = searchParams.get("host") === "true";

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const [videoStatus, setVideoStatus] = useState("connecting");
  const [socketStatus, setSocketStatus] = useState("connecting");
  const socketRef = useRef<WebSocket | null>(null);
  const [localStreamReady, setLocalStreamReady] = useState(false);

  // Landmarks live in refs, not state: PoseOverlay reads them on its own
  // rAF loop, so a new frame never triggers a React re-render here.
  const localLandmarksRef = useRef<RawLandmark[] | null>(null);
  const remoteLandmarksRef = useRef<RawLandmark[] | null>(null);
  const lastPoseSentAtRef = useRef(0);

  usePoseEngine({
    videoRef: localVideoRef,
    active: localStreamReady,
    onPoseResult: (msg) => {
      localLandmarksRef.current = msg.landmarks;

      const socket = socketRef.current;
      const now = performance.now();
      if (
        socket?.readyState === WebSocket.OPEN &&
        now - lastPoseSentAtRef.current >= POSE_SEND_INTERVAL_MS
      ) {
        lastPoseSentAtRef.current = now;
        socket.send(JSON.stringify({ type: "pose", landmarks: msg.landmarks }));
      }
    },
  });

  const handleLeave = () => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "leave" }));
    }
    router.push("/");
  };

  useEffect(() => {
    if (!sessionId || !uuid || !opponentUuid) return;

    let cancelled = false;
    let peer: Peer | null = null;
    let localStream: MediaStream | null = null;
    let peerOpen = false;
    let opponentReady = false;

    const peerId = `${sessionId}-${uuid}`;
    const opponentPeerId = `${sessionId}-${opponentUuid}`;
    const t0 = performance.now();
    const elapsed = () => `${Math.round(performance.now() - t0)}ms`;
    const plog = (...args: unknown[]) => console.log(`[peerjs:${uuid} +${elapsed()}]`, ...args);

    const socket = new WebSocket(
      wsUrl(`/game_session?sessionId=${sessionId}&playerUuid=${uuid}`),
    );
    socketRef.current = socket;

    const sendReady = () => {
      if (socket.readyState === WebSocket.OPEN) {
        plog("sending peer-ready over game socket");
        socket.send(JSON.stringify({ type: "peer-ready" }));
      } else {
        plog("sendReady skipped, socket not open yet, readyState =", socket.readyState);
      }
    };

    // Logs ICE/connection state transitions on the underlying RTCPeerConnection
    // so a stalled negotiation (no TURN, blocked UDP, etc.) is visible instead
    // of silently sitting at "connecting" forever.
    const attachCallLogging = (call: MediaConnection, direction: "outgoing" | "incoming") => {
      plog(`${direction} call created ->`, call.peer);
      call.on("stream", (remoteStream) => {
        plog(`${direction} call: stream received`, remoteStream.getTracks().map((t) => t.kind));
      });
      call.on("close", () => plog(`${direction} call: closed`));
      call.on("error", (err) => plog(`${direction} call: error`, err));
      const pc = call.peerConnection;
      if (pc) {
        pc.addEventListener("iceconnectionstatechange", () =>
          plog(`${direction} call: iceConnectionState =`, pc.iceConnectionState),
        );
        pc.addEventListener("connectionstatechange", () =>
          plog(`${direction} call: connectionState =`, pc.connectionState),
        );
      }
    };

    const maybeCallOpponent = () => {
      if (!isHost || !localStream || !peer || !peerOpen || !opponentReady) return;
      plog("placing call to", opponentPeerId);
      const call = peer.call(opponentPeerId, localStream);
      attachCallLogging(call, "outgoing");
      call.on("stream", (remoteStream) => {
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
        setVideoStatus("connected");
      });
    };

    const setupPeer = async () => {
      localStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      plog("local media ready");
      if (cancelled) {
        localStream.getTracks().forEach((t) => t.stop());
        return;
      }
      if (localVideoRef.current) localVideoRef.current.srcObject = localStream;
      setLocalStreamReady(true);

      const matchmakerUrl = new URL(MATCHMAKER_URL);
      peer = new Peer(peerId, {
        host: matchmakerUrl.hostname,
        port: matchmakerUrl.port ? Number(matchmakerUrl.port) : undefined,
        path: "/peerjs",
        secure: matchmakerUrl.protocol === "https:",
      });

      const handleCall = (call: MediaConnection) => {
        plog("incoming call from", call.peer);
        call.answer(localStream!);
        attachCallLogging(call, "incoming");
        call.on("stream", (remoteStream) => {
          if (remoteVideoRef.current)
            remoteVideoRef.current.srcObject = remoteStream;
          setVideoStatus("connected");
        });
      };

      peer.on("call", handleCall);

      // Peer being "open" only means our own id is registered with the
      // PeerJS signaling server, not that the opponent's is. Announce
      // readiness over the game socket and wait for theirs before calling,
      // otherwise a call placed before the opponent registers fails silently.
      peer.on("open", (id) => {
        plog("peer open, registered as", id);
        peerOpen = true;
        sendReady();
        maybeCallOpponent();
      });

      peer.on("disconnected", () => plog("peer disconnected from signaling server"));
      peer.on("close", () => plog("peer closed"));

      peer.on("error", (err) => {
        plog("peer error", err.type, err.message);
        console.error("peer error", err);
        setVideoStatus("error");
      });
    };

    setupPeer().catch((err) => {
      console.error("failed to start video", err);
      setVideoStatus("error");
    });

    plog("game socket connecting to", socket.url);
    socket.onopen = () => {
      plog("game socket open");
      setSocketStatus("connected");
      if (peerOpen) sendReady();
    };
    socket.onclose = (event) => {
      plog("game socket closed", { code: event.code, reason: event.reason });
      setSocketStatus("disconnected");
    };
    socket.onerror = () => {
      plog("game socket error");
      setSocketStatus("error");
    };
    socket.onmessage = (event) => {
      let data: unknown;
      try {
        data = JSON.parse(event.data);
      } catch {
        console.log("game_session message", event.data);
        return;
      }
      const type = (data as { type?: unknown }).type;
      if (typeof data === "object" && data !== null && type === "peer-ready") {
        plog("received opponent peer-ready");
        opponentReady = true;
        maybeCallOpponent();
        return;
      }
      if (typeof data === "object" && data !== null && type === "leave") {
        router.push("/");
        return;
      }
      if (typeof data === "object" && data !== null && type === "pose") {
        remoteLandmarksRef.current = (data as { landmarks: RawLandmark[] | null }).landmarks;
        return;
      }
      console.log("game_session message", event.data);
    };

    return () => {
      cancelled = true;
      setLocalStreamReady(false);
      localStream?.getTracks().forEach((t) => t.stop());
      peer?.destroy();
      socket.close();
      socketRef.current = null;
    };
  }, [sessionId, uuid, opponentUuid, isHost, router]);

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
        <PoseOverlay videoRef={localVideoRef} landmarksRef={localLandmarksRef} />
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
        <PoseOverlay videoRef={remoteVideoRef} landmarksRef={remoteLandmarksRef} />
        <span className="absolute bottom-4 right-4 text-xs font-medium text-white/70">
          Opponent
        </span>
      </div>
      <div className="absolute top-4 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-4 py-1.5 text-center text-xs text-white/80 backdrop-blur">
        session: {sessionId} · video: {videoStatus} · game socket:{" "}
        {socketStatus}
      </div>
      <button
        type="button"
        onClick={handleLeave}
        className="absolute bottom-4 right-4 rounded-full bg-black/60 px-5 py-2 text-xs font-medium uppercase tracking-widest text-white/80 backdrop-blur transition-colors hover:bg-red-600/80 hover:text-white"
      >
        Leave game
      </button>
    </div>
  );
}
