import { useCallback, useEffect, useState } from "react";

import {
  SOCKET_EVENTS,
  type BridgeCommand,
  type BridgeState,
} from "@tempass/shared";

import type { RoomSocket } from "./socket";

export interface RoomBridgeState {
  /** Latest state reported by the companion script, or null when nobody is presenting. */
  bridge: BridgeState | null;
  sendCommand: (command: BridgeCommand) => void;
}

/**
 * Listens to the source-site bridge (the companion script running in the tab
 * that actually owns the video) and forwards room commands back to it.
 */
export function useRoomBridge(
  roomId: string,
  socket: RoomSocket | null,
): RoomBridgeState {
  const [bridge, setBridge] = useState<BridgeState | null>(null);

  useEffect(() => {
    setBridge(null);
  }, [roomId]);

  useEffect(() => {
    if (!socket) {
      return;
    }

    const handleState = (state: BridgeState | null) => {
      setBridge(state);
    };

    socket.on(SOCKET_EVENTS.BRIDGE_STATE, handleState);

    return () => {
      socket.off(SOCKET_EVENTS.BRIDGE_STATE, handleState);
    };
  }, [socket]);

  const sendCommand = useCallback(
    (command: BridgeCommand) => {
      if (!socket?.connected) {
        return;
      }

      socket.emit(SOCKET_EVENTS.BRIDGE_COMMAND, command);
    },
    [socket],
  );

  return { bridge, sendCommand };
}
