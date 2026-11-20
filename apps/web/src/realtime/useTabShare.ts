import { useCallback, useEffect, useRef, useState } from "react";

import {
  SOCKET_EVENTS,
  type RoomPeers,
  type TabShareAck,
  type TabShareState,
  type TabShareSurface,
} from "@tempass/shared";

import type { RoomSocket } from "./socket";
import { useRoomStream } from "./useRoomStream";

const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];
const ACK_TIMEOUT_MS = 5_000;
const RETRY_MS = 1_500;

export type TabShareStatus =
  | "idle"
  | "starting"
  | "connecting"
  | "live"
  | "waiting"
  | "unavailable";

export interface TabShareController {
  /** Who the server says is presenting, if anyone. */
  active: TabShareState | null;
  /** True when this participant owns the live capture. */
  presenting: boolean;
  status: TabShareStatus;
  /** The other participant's tab, for the viewer. */
  stream: MediaStream | null;
  /** What Chrome reported the presenter picked: a tab, window, or screen. */
  surface: TabShareSurface;
  /** The capture came without audio (the "Share tab audio" box was unticked). */
  audioMissing: boolean;
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
}

interface PeerEntry {
  pc: RTCPeerConnection;
  pending: RTCIceCandidateInit[];
}

interface SignalMessage {
  from: string;
  data: unknown;
}

interface SignalData {
  type?: string;
  sdp?: string;
  candidate?: RTCIceCandidateInit;
  kind?: string;
}

function normalizeSurface(value: string | undefined): TabShareSurface {
  return value === "browser" || value === "window" || value === "monitor"
    ? value
    : "unknown";
}

function readSignal(value: unknown): SignalData | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  return value as SignalData;
}

function awaitAck(
  emit: (done: (response: TabShareAck) => void) => void,
): Promise<TabShareAck | null> {
  return new Promise((resolve) => {
    let settled = false;

    const timer = window.setTimeout(() => finish(null), ACK_TIMEOUT_MS);

    function finish(response: TabShareAck | null) {
      if (settled) {
        return;
      }

      settled = true;
      window.clearTimeout(timer);
      resolve(response);
    }

    emit((response) => finish(response));
  });
}

/**
 * Live tab sharing: the presenter captures one tab with getDisplayMedia and
 * offers it to the other participant over WebRTC. The server only tracks who
 * is presenting so the two clients cannot start conflicting streams.
 */
export function useTabShare(
  socket: RoomSocket | null,
  selfId: string,
): TabShareController {
  const [active, setActive] = useState<TabShareState | null>(null);
  const [status, setStatus] = useState<TabShareStatus>("idle");
  const [surface, setSurface] = useState<TabShareSurface>("unknown");
  const [audioMissing, setAudioMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stream = useRoomStream(socket, { kind: "share" });
  const startRef = useRef<() => Promise<void>>(async () => {});
  const stopRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!socket) {
      return;
    }

    const liveSocket = socket;
    const peers = new Map<string, PeerEntry>();
    const retries = new Set<number>();
    let capture: MediaStream | null = null;
    let sharing = false;
    let currentSurface: TabShareSurface = "unknown";
    let targetSocketIds: string[] = [];

    function closePeer(socketId: string) {
      const entry = peers.get(socketId);

      if (!entry) {
        return;
      }

      peers.delete(socketId);

      try {
        entry.pc.close();
      } catch {
        /* already closed */
      }
    }

    function closeAllPeers() {
      for (const socketId of [...peers.keys()]) {
        closePeer(socketId);
      }
    }

    function createPeer(socketId: string) {
      if (peers.has(socketId) || !capture) {
        return;
      }

      const entry: PeerEntry = {
        pc: new RTCPeerConnection({ iceServers: ICE_SERVERS }),
        pending: [],
      };
      peers.set(socketId, entry);

      for (const track of capture.getTracks()) {
        entry.pc.addTrack(track, capture);
      }

      entry.pc.onicecandidate = (event) => {
        if (event.candidate) {
          liveSocket.emit(SOCKET_EVENTS.WEBRTC_SIGNAL, {
            to: socketId,
            data: {
              kind: "share",
              type: "candidate",
              candidate: event.candidate.toJSON(),
            },
          });
        }
      };

      entry.pc.onconnectionstatechange = () => {
        if (entry.pc.connectionState === "connected") {
          setStatus("live");
          return;
        }

        if (entry.pc.connectionState !== "failed" || !sharing) {
          return;
        }

        // A broken path (network change, sleeping laptop) never recovers on its
        // own, so drop the peer and offer again in a moment.
        closePeer(socketId);

        const timer = window.setTimeout(() => {
          retries.delete(timer);

          if (sharing && targetSocketIds.includes(socketId)) {
            createPeer(socketId);
          }
        }, RETRY_MS);
        retries.add(timer);
      };

      entry.pc
        .createOffer()
        .then((offer) => entry.pc.setLocalDescription(offer))
        .then(() => {
          liveSocket.emit(SOCKET_EVENTS.WEBRTC_SIGNAL, {
            to: socketId,
            data: {
              kind: "share",
              type: "offer",
              sdp: entry.pc.localDescription?.sdp,
            },
          });
        })
        .catch(() => closePeer(socketId));
    }

    function syncPeers() {
      const targets = targetSocketIds.filter((socketId) => socketId !== liveSocket.id);

      for (const socketId of targets) {
        createPeer(socketId);
      }

      for (const socketId of [...peers.keys()]) {
        if (!targets.includes(socketId)) {
          closePeer(socketId);
        }
      }

      if (!sharing) {
        return;
      }

      if (targets.length === 0) {
        // Nobody is watching: keep the capture alive but stop encoding, then
        // resume automatically when the other participant comes back.
        setStatus("waiting");
        return;
      }

      const connected = [...peers.values()].some(
        (entry) => entry.pc.connectionState === "connected",
      );
      setStatus(connected ? "live" : "connecting");
    }

    function teardown() {
      closeAllPeers();

      if (capture) {
        for (const track of capture.getTracks()) {
          track.stop();
        }
      }

      capture = null;
      sharing = false;
      setAudioMissing(false);
      setStatus("idle");
    }

    async function start() {
      if (sharing) {
        return;
      }

      if (!liveSocket.connected) {
        setError("Reconnect to the room before sharing a tab.");
        return;
      }

      const mediaDevices = navigator.mediaDevices;

      if (!mediaDevices || typeof mediaDevices.getDisplayMedia !== "function") {
        setStatus("unavailable");
        setError(
          "This browser cannot capture a tab. Use desktop Chrome or Edge.",
        );
        return;
      }

      setError(null);
      setStatus("starting");

      let next: MediaStream;

      try {
        // "preferCurrentTab" is false because the room tab is the one thing the
        // other participant already has. Chromium rejects unknown constraints
        // on older builds, so fall back to the plain request.
        const options = {
          video: { displaySurface: "browser" },
          audio: true,
          preferCurrentTab: false,
          selfBrowserSurface: "exclude",
          surfaceSwitching: "include",
        };

        next = await mediaDevices.getDisplayMedia(
          options as unknown as DisplayMediaStreamOptions,
        );
      } catch (failure) {
        const name =
          failure && typeof failure === "object"
            ? (failure as { name?: string }).name
            : undefined;

        setStatus("idle");

        if (name === "NotAllowedError" || name === "AbortError") {
          return;
        }

        setError(`Tab capture failed${name ? ` (${name})` : ""}.`);
        return;
      }

      const [videoTrack] = next.getVideoTracks();

      if (!videoTrack) {
        for (const track of next.getTracks()) {
          track.stop();
        }

        setStatus("idle");
        setError("No video track was captured.");
        return;
      }

      const settings = videoTrack.getSettings() as MediaTrackSettings & {
        displaySurface?: string;
      };
      const nextSurface = normalizeSurface(settings.displaySurface);

      capture = next;
      sharing = true;
      currentSurface = nextSurface;
      setSurface(nextSurface);
      setAudioMissing(next.getAudioTracks().length === 0);

      // Browser "Stop sharing" bar ends the track; treat it as a full stop.
      videoTrack.addEventListener("ended", () => stop(true));

      const ack = await awaitAck((done) =>
        liveSocket.emit(
          SOCKET_EVENTS.SHARE_START,
          { surface: nextSurface },
          done,
        ),
      );

      if (!sharing) {
        return;
      }

      if (!ack || !ack.ok) {
        liveSocket.emit(SOCKET_EVENTS.SHARE_STOP, {}, () => {});
        teardown();
        setError(
          ack && !ack.ok && ack.code === "SHARE_BUSY"
            ? "The other person is already sharing a tab."
            : "The room did not accept the share. Reconnect and try again.",
        );
        return;
      }

      syncPeers();
    }

    function stop(announce: boolean) {
      if (!sharing) {
        return;
      }

      teardown();

      if (announce && liveSocket.connected) {
        liveSocket.emit(SOCKET_EVENTS.SHARE_STOP, {}, () => {});
      }
    }

    function handlePeers(payload: RoomPeers) {
      targetSocketIds = payload.peers.map((peer) => peer.socketId);
      syncPeers();
    }

    function handleSignal({ from, data }: SignalMessage) {
      const signal = readSignal(data);

      if (!signal || signal.kind !== "share") {
        return;
      }

      const entry = peers.get(from);

      if (!entry) {
        return;
      }

      if (signal.type === "answer" && typeof signal.sdp === "string") {
        entry.pc
          .setRemoteDescription({ type: "answer", sdp: signal.sdp })
          .then(() => {
            for (const candidate of entry.pending.splice(0)) {
              entry.pc.addIceCandidate(candidate).catch(() => {});
            }
          })
          .catch(() => closePeer(from));
        return;
      }

      if (signal.type === "candidate" && signal.candidate) {
        if (entry.pc.remoteDescription) {
          entry.pc.addIceCandidate(signal.candidate).catch(() => {});
        } else {
          entry.pending.push(signal.candidate);
        }
      }
    }

    function handleShareState(state: TabShareState | null) {
      setActive(state);

      if (!state || state.presenterId === selfId) {
        return;
      }

      if (sharing) {
        // Someone else won the race for the room.
        stop(true);
        setError("The other person is already sharing a tab.");
      }
    }

    function handleConnect() {
      if (!sharing) {
        return;
      }

      // A reconnect drops the server's record; announce again and re-offer.
      liveSocket.emit(
        SOCKET_EVENTS.SHARE_START,
        { surface: currentSurface },
        () => {},
      );
      syncPeers();
    }

    function handleDisconnect() {
      if (!sharing) {
        return;
      }

      closeAllPeers();
      setStatus("waiting");
    }

    startRef.current = start;
    stopRef.current = () => stop(true);

    socket.on(SOCKET_EVENTS.ROOM_PEERS, handlePeers);
    socket.on(SOCKET_EVENTS.WEBRTC_SIGNAL, handleSignal);
    socket.on(SOCKET_EVENTS.SHARE_STATE, handleShareState);
    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);

    return () => {
      socket.off(SOCKET_EVENTS.ROOM_PEERS, handlePeers);
      socket.off(SOCKET_EVENTS.WEBRTC_SIGNAL, handleSignal);
      socket.off(SOCKET_EVENTS.SHARE_STATE, handleShareState);
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);

      for (const timer of retries) {
        window.clearTimeout(timer);
      }

      retries.clear();
      stop(false);
      startRef.current = async () => {};
      stopRef.current = () => {};
    };
  }, [socket, selfId]);

  // A reload leaves a stale server-side entry that this tab can no longer feed.
  useEffect(() => {
    if (active && active.presenterId === selfId && status === "idle") {
      socket?.emit(SOCKET_EVENTS.SHARE_STOP, {}, () => {});
    }
  }, [active, selfId, socket, status]);

  const start = useCallback(() => startRef.current(), []);
  const stop = useCallback(() => stopRef.current(), []);

  return {
    active,
    presenting: active?.presenterId === selfId,
    status,
    stream,
    surface,
    audioMissing,
    error,
    start,
    stop,
  };
}
