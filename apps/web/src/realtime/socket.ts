import type { ClientToServerEvents, ServerToClientEvents } from "@tempass/shared";
import { io, type Socket } from "socket.io-client";

import { API_BASE_URL } from "../lib/config";

export type RoomSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function connectRoomSocket(token: string): RoomSocket {
  const options = {
    auth: { token },
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 3_000,
    timeout: 10_000,
  };

  return API_BASE_URL ? io(API_BASE_URL, options) : io(options);
}
