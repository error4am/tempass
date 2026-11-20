import { useEffect, useState } from "react";

import { SOCKET_EVENTS, type TabShareState } from "@tempass/shared";

import type { RoomSocket } from "./socket";

interface SignalMessage {
  from: string;
  data: unknown;
}

interface DescriptionPayload {
  type: "offer" | "answer";
  sdp: string;
  /** "share" marks a live-tab offer; the companion omits it. */
  kind?: string;
}

interface CandidatePayload {
  type: "candidate";
  candidate: RTCIceCandidateInit;
  kind?: string;
}

/** Which remote stream this hook listens for. */
export type RoomStreamKind = "bridge" | "share";

interface RoomStreamOptions {
  kind?: RoomStreamKind;
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

function matchesKind(value: { kind?: string }, kind: RoomStreamKind): boolean {
  return kind === "share" ? value.kind === "share" : value.kind !== "share";
}

/**
 * Receives a remote stream offered to this participant.
 *
 * `bridge` is the source-site companion capturing a video tab; `share` is the
 * other participant sharing their own tab. The offerer is always the sender,
 * so the room only has to answer.
 */
export function useRoomStream(
  socket: RoomSocket | null,
  options: RoomStreamOptions = {},
): MediaStream | null {
  const kind = options.kind ?? "bridge";
  const [stream, setStream] = useState<MediaStream | null>(null);

  useEffect(() => {
    if (!socket) {
      return;
    }

    let pc: RTCPeerConnection | null = null;
    let offerFrom: string | null = null;
    let offerKind: string | undefined;
    const pendingCandidates: RTCIceCandidateInit[] = [];

    const handleSignal = async ({ from, data }: SignalMessage) => {
      if (isDescription(data) && data.type === "offer" && matchesKind(data, kind)) {
        // Trickle candidates can beat the offer here. Only reset them when a
        // different sender takes over, otherwise the connection never gathers.
        if (offerFrom !== null && offerFrom !== from) {
          pendingCandidates.length = 0;
        }

        offerFrom = from;
        offerKind = data.kind;
        pc?.close();

        const connection = new RTCPeerConnection({
          iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
        });
        pc = connection;

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
              data: {
                kind: offerKind,
                type: "candidate",
                candidate: event.candidate.toJSON(),
              },
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
            data: { kind: offerKind, type: "answer", sdp: answer.sdp },
          });
        } catch {
          setStream(null);
        }

        return;
      }

      if (isCandidate(data) && matchesKind(data, kind)) {
        if (offerFrom !== null && from !== offerFrom) {
          return;
        }

        if (!pc || !pc.remoteDescription) {
          pendingCandidates.push(data.candidate);
          return;
        }

        await pc.addIceCandidate(data.candidate).catch(() => {});
      }
    };

    /**
     * The presenter withdrawing the announcement is the only reliable "stop":
     * a closed peer connection just freezes the last frame.
     */
    const handleShareState = (state: TabShareState | null) => {
      if (!state) {
        pc?.close();
        pc = null;
        setStream(null);
      }
    };

    socket.on(SOCKET_EVENTS.WEBRTC_SIGNAL, handleSignal);

    if (kind === "share") {
      socket.on(SOCKET_EVENTS.SHARE_STATE, handleShareState);
    }

    return () => {
      socket.off(SOCKET_EVENTS.WEBRTC_SIGNAL, handleSignal);

      if (kind === "share") {
        socket.off(SOCKET_EVENTS.SHARE_STATE, handleShareState);
      }

      pc?.close();
      setStream(null);
    };
  }, [socket, kind]);

  return stream;
}
