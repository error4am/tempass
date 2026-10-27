import type { Server as HttpServer } from "node:http";

import {
  SOCKET_EVENTS,
  leaveRoomPayloadSchema,
  socketAuthSchema,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from "@tempass/shared";
import { Server } from "socket.io";

import type { RoomService } from "../domain/roomService";

interface SocketData {
  session?: {
    roomId: string;
    participantId: string;
  };
  left?: boolean;
}

interface InterServerEvents {}

export type TempassSocketServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

interface RealtimeOptions {
  corsOrigin: string;
}

export function attachRealtime(
  httpServer: HttpServer,
  roomService: RoomService,
  options: RealtimeOptions,
): TempassSocketServer {
  const io: TempassSocketServer = new Server(httpServer, {
    cors: {
      origin: options.corsOrigin,
    },
    maxHttpBufferSize: 16 * 1024,
  });

  io.use((socket, next) => {
    const auth = socketAuthSchema.safeParse(socket.handshake.auth);

    if (!auth.success) {
      next(connectError("UNAUTHORIZED", "Not authorized"));
      return;
    }

    const session = roomService.authenticateToken(auth.data.token);

    if (!session) {
      next(connectError("UNAUTHORIZED", "Session expired or room not found"));
      return;
    }

    socket.data.session = session;
    next();
  });

  io.on("connection", (socket) => {
    const session = socket.data.session;

    if (!session) {
      socket.disconnect(true);
      return;
    }

    const connected = roomService.markConnected(
      session.roomId,
      session.participantId,
      socket.id,
    );

    if (!connected) {
      socket.disconnect(true);
      return;
    }

    if (connected.previousSocketId && connected.previousSocketId !== socket.id) {
      io.sockets.sockets.get(connected.previousSocketId)?.disconnect(true);
    }

    socket.join(session.roomId);

    const snapshot = roomService.getSnapshot(session.roomId, session.participantId);

    if (!snapshot) {
      socket.disconnect(true);
      return;
    }

    socket.emit(SOCKET_EVENTS.ROOM_SNAPSHOT, snapshot);
    broadcastRoomPresence(io, roomService, session.roomId);

    socket.on(SOCKET_EVENTS.ROOM_LEAVE, (payload, ack) => {
      const parsed = leaveRoomPayloadSchema.safeParse(payload ?? {});

      if (!parsed.success) {
        ack?.({ ok: false, code: "INVALID_INPUT" });
        return;
      }

      socket.data.left = true;
      const removed = roomService.leave(session.roomId, session.participantId);
      socket.leave(session.roomId);

      if (removed) {
        broadcastRoomPresence(io, roomService, session.roomId);
      }

      ack?.({ ok: true });
    });

    socket.on("disconnect", () => {
      if (socket.data.left) {
        return;
      }

      const changed = roomService.markDisconnected(
        session.roomId,
        session.participantId,
        socket.id,
      );

      if (changed) {
        broadcastRoomPresence(io, roomService, session.roomId);
      }
    });
  });

  return io;
}

export function broadcastRoomPresence(
  io: TempassSocketServer,
  roomService: RoomService,
  roomId: string,
): void {
  const presence = roomService.getPresence(roomId);

  if (!presence) {
    return;
  }

  io.to(roomId).emit(SOCKET_EVENTS.PRESENCE_UPDATE, presence);
}

function connectError(code: string, message: string): Error {
  const error = new Error(message) as Error & { data?: { code: string } };
  error.data = { code };
  return error;
}
