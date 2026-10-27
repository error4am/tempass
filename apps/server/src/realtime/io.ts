import type { Server as HttpServer } from "node:http";

import {
  SOCKET_EVENTS,
  leaveRoomPayloadSchema,
  sendChatMessagePayloadSchema,
  socketAuthSchema,
  type ChatSendAck,
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

const DEFAULT_CHAT_RATE_LIMIT_WINDOW_MS = 10_000;
const DEFAULT_CHAT_RATE_LIMIT_MAX_MESSAGES = 10;

interface RealtimeOptions {
  corsOrigin: string;
  chatRateLimitWindowMs?: number;
  chatRateLimitMaxMessages?: number;
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

  const chatRateLimitWindowMs =
    options.chatRateLimitWindowMs ?? DEFAULT_CHAT_RATE_LIMIT_WINDOW_MS;
  const chatRateLimitMaxMessages =
    options.chatRateLimitMaxMessages ?? DEFAULT_CHAT_RATE_LIMIT_MAX_MESSAGES;

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

    const recentChatMessageTimes: number[] = [];

    socket.on(SOCKET_EVENTS.CHAT_MESSAGE, (payload, ack) => {
      const respond = (response: ChatSendAck) => {
        ack?.(response);
      };

      const parsed = sendChatMessagePayloadSchema.safeParse(payload);

      if (!parsed.success) {
        respond({ ok: false, code: "INVALID_INPUT" });
        return;
      }

      if (
        !roomService.isCurrentSocket(
          session.roomId,
          session.participantId,
          socket.id,
        )
      ) {
        respond({ ok: false, code: "UNAUTHORIZED" });
        return;
      }

      if (
        !consumeChatRateLimit(
          recentChatMessageTimes,
          Date.now(),
          chatRateLimitWindowMs,
          chatRateLimitMaxMessages,
        )
      ) {
        respond({ ok: false, code: "RATE_LIMITED" });
        return;
      }

      const message = roomService.postChatMessage(
        session.roomId,
        session.participantId,
        socket.id,
        parsed.data.text,
      );

      if (!message) {
        respond({ ok: false, code: "UNAUTHORIZED" });
        return;
      }

      io.to(session.roomId).emit(SOCKET_EVENTS.CHAT_MESSAGE, message);
      respond({ ok: true, message });
    });

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

function consumeChatRateLimit(
  messageTimes: number[],
  now: number,
  windowMs: number,
  maxMessages: number,
): boolean {
  while (messageTimes.length > 0 && now - (messageTimes[0] ?? now) >= windowMs) {
    messageTimes.shift();
  }

  if (messageTimes.length >= maxMessages) {
    return false;
  }

  messageTimes.push(now);
  return true;
}

function connectError(code: string, message: string): Error {
  const error = new Error(message) as Error & { data?: { code: string } };
  error.data = { code };
  return error;
}
