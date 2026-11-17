import { useEffect, useState } from "react";

import { SOCKET_EVENTS } from "@tempass/shared";

import type { RoomSocket } from "./socket";

interface SignalMessage {
  from: string;
  data: unknown;
}

interface DescriptionPayload {
  type: "offer" | "answer";
  sdp: string;
}

interface CandidatePayload {
  type: "candidate";
  candidate: RTCIceCandidateInit;
}

function isDescription(value: unknown): value is DescriptionPayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<DescriptionPayload>;
  return (
    (candidate.type === "offer" || candidate.type === "answer") &&
    typeof candidate.sdp === "string"
  );
}

function isCandidate(value: unknown): value is CandidatePayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  return (value as Partial<CandidatePayload>).type === "candidate";
}

/**
 * Receives the tab the presenter is sharing. The companion is always the
 * offerer, so the room only has to answer.
 */
export function useRoomStream(socket: RoomSocket | null): MediaStream | null {
  const [stream, setStream] = useState<MediaStream | null>(null);

  useEffect(() => {
    if (!socket) {
      return;
    }

    let pc: RTCPeerConnection | null = null;
    const pendingCandidates: RTCIceCandidateInit[] = [];

    const handleSignal = async ({ from, data }: SignalMessage) => {
      if (isDescription(data) && data.type === "offer") {
        pc?.close();

        const connection = new RTCPeerConnection({
          iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
        });
        pc = connection;
        pendingCandidates.length = 0;

        connection.ontrack = (event) => {
          const [incoming] = event.streams;

          if (incoming) {
            setStream(incoming);
          }
        };

        connection.onicecandidate = (event) => {
          if (event.candidate) {
            socket.emit(SOCKET_EVENTS.WEBRTC_SIGNAL, {
              to: from,
              data: { type: "candidate", candidate: event.candidate.toJSON() },
            });
          }
        };

        try {
          await connection.setRemoteDescription({ type: "offer", sdp: data.sdp });

          for (const candidate of pendingCandidates.splice(0)) {
            await connection.addIceCandidate(candidate).catch(() => {});
          }

          const answer = await connection.createAnswer();
          await connection.setLocalDescription(answer);

          socket.emit(SOCKET_EVENTS.WEBRTC_SIGNAL, {
            to: from,
            data: { type: "answer", sdp: answer.sdp },
          });
        } catch {
          setStream(null);
        }

        return;
      }

      if (isCandidate(data)) {
        if (!pc || !pc.remoteDescription) {
          pendingCandidates.push(data.candidate);
          return;
        }

        await pc.addIceCandidate(data.candidate).catch(() => {});
      }
    };

    socket.on(SOCKET_EVENTS.WEBRTC_SIGNAL, handleSignal);

    return () => {
      socket.off(SOCKET_EVENTS.WEBRTC_SIGNAL, handleSignal);
      pc?.close();
      setStream(null);
    };
  }, [socket]);

  return stream;
}
