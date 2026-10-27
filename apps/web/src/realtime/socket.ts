import type { ClientToServerEvents, ServerToClientEvents } from "@tempass/shared";
import { io, type Socket } from "socket.io-client";

export type RoomSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function connectRoomSocket(token: string): RoomSocket {
  return io({
    auth: { token },
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 3_000,
    timeout: 10_000,
  });
}
