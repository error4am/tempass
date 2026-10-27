import { useCallback, useEffect, useState } from "react";

import {
  SOCKET_EVENTS,
  type PlaybackUpdate,
  type RoomSnapshot,
} from "@tempass/shared";

import {
  mergePlaybackUpdate,
  playbackUpdateFromSnapshot,
} from "../lib/playback";
import type { RoomSocket } from "./socket";

export interface RoomPlaybackState {
  playback: PlaybackUpdate | null;
  applyUpdate: (update: PlaybackUpdate) => void;
}

export function useRoomPlayback(
  roomId: string,
  socket: RoomSocket | null,
  snapshot: RoomSnapshot | null,
): RoomPlaybackState {
  const [playback, setPlayback] = useState<PlaybackUpdate | null>(null);

  const applyUpdate = useCallback((update: PlaybackUpdate) => {
    setPlayback((current) => mergePlaybackUpdate(current, update));
  }, []);

  useEffect(() => {
    setPlayback(null);
  }, [roomId]);

  useEffect(() => {
    if (!snapshot) {
      return;
    }

    applyUpdate(playbackUpdateFromSnapshot(snapshot));
  }, [snapshot, applyUpdate]);

  useEffect(() => {
    if (!socket) {
      return;
    }

    const handlePlaybackUpdate = (update: PlaybackUpdate) => {
      applyUpdate(update);
    };

    socket.on(SOCKET_EVENTS.PLAYBACK_STATE, handlePlaybackUpdate);

    return () => {
      socket.off(SOCKET_EVENTS.PLAYBACK_STATE, handlePlaybackUpdate);
    };
  }, [socket, applyUpdate]);

  return { playback, applyUpdate };
}
