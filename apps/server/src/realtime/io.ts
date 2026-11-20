import type { Server as HttpServer } from "node:http";

import {
  SOCKET_EVENTS,
  bridgeCommandSchema,
  bridgeStateReportSchema,
  clockSyncRequestSchema,
  leaveRoomPayloadSchema,
  playbackCommandSchema,
  sendChatMessagePayloadSchema,
  socketAuthSchema,
  tabShareStartPayloadSchema,
  webrtcSignalSchema,
  type BridgeState,
  type ChatMessage,
  type ChatSendAck,
  type ClientToServerEvents,
  type ClockSyncAck,
  type PlaybackCommandAck,
  type PlaybackErrorCode,
  type PlaybackUpdate,
  type ServerToClientEvents,
  type TabShareAck,
  type TabShareState,
} from "@tempass/shared";
import { Server, type Socket } from "socket.io";

import { RoomError } from "../domain/errors";
import type { RoomService } from "../domain/roomService";
import { consumeSlidingWindow } from "../util/rateLimit";

interface SocketData {
  session?: {
    roomId: string;
    participantId: string;
  };
  /** "bridge" sockets own the source site's <video> and never count as presence. */
  role?: "participant" | "bridge";
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

const DEFAULT_PLAYBACK_RATE_LIMIT_WINDOW_MS = 10_000;
const DEFAULT_PLAYBACK_RATE_LIMIT_MAX_COMMANDS = 30;

interface RealtimeOptions {
  corsOrigin: string;
  chatRateLimitWindowMs?: number;
  chatRateLimitMaxMessages?: number;
  playbackRateLimitWindowMs?: number;
  playbackRateLimitMaxCommands?: number;
}

export function attachRealtime(
  httpServer: HttpServer,
  roomService: RoomService,
  options: RealtimeOptions,
): TempassSocketServer {
  const io: TempassSocketServer = new Server(httpServer, {
    cors: {
      // Participants connect from the Tempass web origin, but the companion
      // script connects from whatever site is playing the video (and that can
      // be any domain). Authorization is the room token, never the origin.
      origin: true,
    },
    maxHttpBufferSize: 16 * 1024,
  });

  const chatRateLimitWindowMs =
    options.chatRateLimitWindowMs ?? DEFAULT_CHAT_RATE_LIMIT_WINDOW_MS;
  const chatRateLimitMaxMessages =
    options.chatRateLimitMaxMessages ?? DEFAULT_CHAT_RATE_LIMIT_MAX_MESSAGES;

  const playbackRateLimitWindowMs =
    options.playbackRateLimitWindowMs ?? DEFAULT_PLAYBACK_RATE_LIMIT_WINDOW_MS;
  const playbackRateLimitMaxCommands =
    options.playbackRateLimitMaxCommands ?? DEFAULT_PLAYBACK_RATE_LIMIT_MAX_COMMANDS;

  /** Latest reported state per room from the companion running on the source site. */
  const bridges = new Map<string, BridgeState>();
  /** Bridge sockets per room, so participants can be offered the captured tab. */
  const bridgeSockets = new Map<string, Set<string>>();
  /** Who is presenting a live tab in each room, if anyone. */
  const shares = new Map<string, TabShareState>();

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
    socket.data.role = auth.data.role ?? "participant";
    next();
  });

  io.on("connection", (socket) => {
    const session = socket.data.session;

    if (!session) {
      socket.disconnect(true);
      return;
    }

    if (socket.data.role === "bridge") {
      attachBridge(socket, session, io, bridges, bridgeSockets, roomService);
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
    socket.emit(SOCKET_EVENTS.SHARE_STATE, shares.get(session.roomId) ?? null);
    broadcastRoomPresence(io, roomService, session.roomId);
    attachSignalling(socket, session.roomId, io, roomService, bridgeSockets);
    broadcastPeers(io, roomService, session.roomId);

    const recentChatMessageTimes: number[] = [];
    const recentPlaybackCommandTimes: number[] = [];

    socket.on(SOCKET_EVENTS.CLOCK_SYNC, (payload, ack) => {
      const respond = (response: ClockSyncAck) => {
        ack?.(response);
      };

      const parsed = clockSyncRequestSchema.safeParse(payload);

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

      respond({
        ok: true,
        clientTime: parsed.data.clientTime,
        serverTime: roomService.getServerTime(),
      });
    });

    socket.on(SOCKET_EVENTS.PLAYBACK_COMMAND, (payload, ack) => {
      const respond = (response: PlaybackCommandAck) => {
        ack?.(response);
      };

      const parsed = playbackCommandSchema.safeParse(payload);

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
        !consumeSlidingWindow(
          recentPlaybackCommandTimes,
          Date.now(),
          playbackRateLimitWindowMs,
          playbackRateLimitMaxCommands,
        )
      ) {
        respond({ ok: false, code: "RATE_LIMITED" });
        return;
      }

      try {
        const state =
          parsed.data.action === "select"
            ? roomService.selectVideo(
                session.roomId,
                session.participantId,
                socket.id,
                parsed.data.videoId,
              )
            : roomService.updatePlayback(
                session.roomId,
                session.participantId,
                socket.id,
                parsed.data,
              );

        if (!state) {
          respond({ ok: false, code: "UNAUTHORIZED" });
          return;
        }

        const update: PlaybackUpdate = {
          state,
          serverTime: state.updatedAt,
        };

        io.to(session.roomId).emit(SOCKET_EVENTS.PLAYBACK_STATE, update);
        respond({ ok: true, ...update });
      } catch (error) {
        respond({ ok: false, code: toPlaybackErrorCode(error) });
      }
    });

    socket.on(SOCKET_EVENTS.BRIDGE_COMMAND, (payload, ack) => {
      const respond = (response: { ok: boolean }) => {
        ack?.(response);
      };

      const parsed = bridgeCommandSchema.safeParse(payload);

      if (!parsed.success) {
        respond({ ok: false });
        return;
      }

      if (
        !roomService.isCurrentSocket(
          session.roomId,
          session.participantId,
          socket.id,
        )
      ) {
        respond({ ok: false });
        return;
      }

      io.to(session.roomId).emit(SOCKET_EVENTS.BRIDGE_COMMAND, parsed.data);
      respond({ ok: true });
    });

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
        !consumeSlidingWindow(
          recentChatMessageTimes,
          Date.now(),
          chatRateLimitWindowMs,
          chatRateLimitMaxMessages,
        )
      ) {
        respond({ ok: false, code: "RATE_LIMITED" });
        return;
      }

      let message: ChatMessage | null;

      try {
        message = roomService.postChatMessage(
          session.roomId,
          session.participantId,
          socket.id,
          parsed.data.text ?? "",
          parsed.data.mediaId,
        );
      } catch (error) {
        respond({
          ok: false,
          code:
            error instanceof RoomError &&
            (error.code === "MEDIA_NOT_FOUND" || error.code === "INVALID_INPUT")
              ? "INVALID_INPUT"
              : "INTERNAL",
        });
        return;
      }

      if (!message) {
        respond({ ok: false, code: "UNAUTHORIZED" });
        return;
      }

      io.to(session.roomId).emit(SOCKET_EVENTS.CHAT_MESSAGE, message);
      respond({ ok: true, message });
    });

    const shareRoomId = session.roomId;
    const shareParticipantId = session.participantId;

    /**
     * Drops the room's live-tab announcement when the presenter leaves, so the
     * other participant stops waiting for a stream that no longer exists.
     */
    function withdrawShare(): void {
      const current = shares.get(shareRoomId);

      if (!current || current.presenterId !== shareParticipantId) {
        return;
      }

      shares.delete(shareRoomId);
      io.to(shareRoomId).emit(SOCKET_EVENTS.SHARE_STATE, null);
    }

    socket.on(SOCKET_EVENTS.SHARE_START, (payload, ack) => {
      const respond = (response: TabShareAck) => {
        ack?.(response);
      };
      const parsed = tabShareStartPayloadSchema.safeParse(payload ?? {});

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

      const current = shares.get(session.roomId);

      if (current && current.presenterId !== session.participantId) {
        respond({ ok: false, code: "SHARE_BUSY" });
        return;
      }

      const participant = roomService
        .getPresence(session.roomId)
        ?.participants.find((entry) => entry.id === session.participantId);

      if (!participant) {
        respond({ ok: false, code: "UNAUTHORIZED" });
        return;
      }

      const state: TabShareState = {
        presenterId: session.participantId,
        presenterName: participant.displayName,
        startedAt: roomService.getServerTime(),
        surface: parsed.data.surface,
      };

      shares.set(shareRoomId, state);
      io.to(shareRoomId).emit(SOCKET_EVENTS.SHARE_STATE, state);
      // Refresh the socket list so the presenter can offer immediately, even if
      // it missed the broadcast made when the other participant connected.
      broadcastPeers(io, roomService, shareRoomId);
      respond({ ok: true, state });
    });

    socket.on(SOCKET_EVENTS.SHARE_STOP, (_payload, ack) => {
      const current = shares.get(session.roomId);

      if (current && current.presenterId !== session.participantId) {
        ack?.({ ok: false, code: "UNAUTHORIZED" });
        return;
      }

      if (current) {
        withdrawShare();
      }

      ack?.({ ok: true, state: null });
    });

    socket.on(SOCKET_EVENTS.ROOM_LEAVE, (payload, ack) => {
      const parsed = leaveRoomPayloadSchema.safeParse(payload ?? {});

      if (!parsed.success) {
        ack?.({ ok: false, code: "INVALID_INPUT" });
        return;
      }

      socket.data.left = true;
      withdrawShare();
      const removed = roomService.leave(session.roomId, session.participantId);
      socket.leave(session.roomId);

      if (removed) {
        broadcastRoomPresence(io, roomService, session.roomId);
        broadcastPeers(io, roomService, session.roomId);
      }

      ack?.({ ok: true });
    });

    socket.on("disconnect", () => {
      if (socket.data.left) {
        return;
      }

      withdrawShare();

      const changed = roomService.markDisconnected(
        session.roomId,
        session.participantId,
        socket.id,
      );

      if (changed) {
        broadcastRoomPresence(io, roomService, session.roomId);
        broadcastPeers(io, roomService, session.roomId);
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

function toPlaybackErrorCode(error: unknown): PlaybackErrorCode {
  if (error instanceof RoomError) {
    if (
      error.code === "INVALID_INPUT" ||
      error.code === "UNAUTHORIZED" ||
      error.code === "VIDEO_MISMATCH"
    ) {
      return error.code;
    }
  }

  return "INTERNAL";
}

/**
 * A bridge socket is the companion script running on the source website.
 * It owns the <video> element, reports its state, and applies commands.
 * It never counts as presence and never receives a room snapshot.
 */
function attachBridge(
  socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
  session: { roomId: string; participantId: string },
  io: TempassSocketServer,
  bridges: Map<string, BridgeState>,
  bridgeSockets: Map<string, Set<string>>,
  roomService: RoomService,
): void {
  const roomId = session.roomId;

  socket.join(roomId);

  const roomBridges = bridgeSockets.get(roomId) ?? new Set<string>();
  roomBridges.add(socket.id);
  bridgeSockets.set(roomId, roomBridges);

  const existing = bridges.get(roomId);

  if (existing) {
    socket.emit(SOCKET_EVENTS.BRIDGE_STATE, existing);
  }

  attachSignalling(socket, roomId, io, roomService, bridgeSockets);
  broadcastPeers(io, roomService, roomId);

  socket.on(SOCKET_EVENTS.BRIDGE_STATE, (payload, ack) => {
    const parsed = bridgeStateReportSchema.safeParse(payload);

    if (!parsed.success) {
      ack?.({ ok: false, code: "INVALID_INPUT" });
      return;
    }

    const previous = bridges.get(roomId);
    const state: BridgeState = {
      ...parsed.data,
      updatedAt: roomService.getServerTime(),
      revision: (previous?.revision ?? 0) + 1,
    };

    bridges.set(roomId, state);
    io.to(roomId).emit(SOCKET_EVENTS.BRIDGE_STATE, state);
    ack?.({ ok: true, state });
  });

  socket.on("disconnect", () => {
    const set = bridgeSockets.get(roomId);
    set?.delete(socket.id);

    if (set && set.size > 0) {
      return;
    }

    bridgeSockets.delete(roomId);

    if (!bridges.has(roomId)) {
      return;
    }

    bridges.delete(roomId);
    io.to(roomId).emit(SOCKET_EVENTS.BRIDGE_STATE, null);
  });
}

/** Relays WebRTC offers/answers/ICE between a bridge and the room's participants. */
function attachSignalling(
  socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
  roomId: string,
  io: TempassSocketServer,
  roomService: RoomService,
  bridgeSockets: Map<string, Set<string>>,
): void {
  socket.on(SOCKET_EVENTS.WEBRTC_SIGNAL, (payload, ack) => {
    const parsed = webrtcSignalSchema.safeParse(payload);

    if (!parsed.success) {
      ack?.({ ok: false });
      return;
    }

    const target = parsed.data.to;
    const isParticipant = roomService.getParticipantSocketIds(roomId).includes(target);
    const isBridge = bridgeSockets.get(roomId)?.has(target) ?? false;

    if (!isParticipant && !isBridge) {
      ack?.({ ok: false });
      return;
    }

    io.to(target).emit(SOCKET_EVENTS.WEBRTC_SIGNAL, {
      from: socket.id,
      data: parsed.data.data,
    });

    ack?.({ ok: true });
  });
}

function broadcastPeers(
  io: TempassSocketServer,
  roomService: RoomService,
  roomId: string,
): void {
  const peers = roomService
    .getParticipantSocketIds(roomId)
    .map((socketId) => ({ socketId }));

  // Everyone in the room gets the list: the companion offers a captured tab to
  // each participant, and participants offer a live tab to each other.
  io.to(roomId).emit(SOCKET_EVENTS.ROOM_PEERS, { peers });
}


function connectError(code: string, message: string): Error {
  const error = new Error(message) as Error & { data?: { code: string } };
  error.data = { code };
  return error;
}
