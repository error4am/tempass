import {
  CHAT_HISTORY_LIMIT,
  playbackUpdateCommandSchema,
  youtubeVideoIdSchema,
  type ChatMessage,
  type CreateRoomRequest,
  type JoinRoomRequest,
  type PlaybackState,
  type PlaybackUpdateCommand,
  type PresenceUpdate,
  type PublicParticipant,
  type PublicRoom,
  type RoomSnapshot,
} from "@tempass/shared";

import { hashPassword, verifyPassword } from "../security/password";
import {
  createMessageId,
  createParticipantId,
  createRoomId,
  createSessionToken,
  hashToken,
} from "../security/tokens";
import type { RoomRepository } from "../storage/roomRepository";
import { RoomError } from "./errors";
import type {
  ConnectedParticipant,
  RoomAccess,
  RoomServiceOptions,
  StoredParticipant,
  StoredRoom,
  StoredSession,
} from "./types";

const DEFAULTS = {
  capacity: 2,
  reconnectGraceMs: 30_000,
  emptyRoomTtlMs: 300_000,
  roomMaxAgeMs: 43_200_000,
  chatHistoryLimit: CHAT_HISTORY_LIMIT,
};

function createIdlePlayback(now: number): PlaybackState {
  return {
    videoId: null,
    status: "idle",
    positionSeconds: 0,
    updatedAt: now,
    revision: 0,
  };
}

export class RoomService {
  private readonly capacity: number;
  private readonly reconnectGraceMs: number;
  private readonly emptyRoomTtlMs: number;
  private readonly roomMaxAgeMs: number;
  private readonly chatHistoryLimit: number;
  private readonly now: () => number;
  private readonly sessions = new Map<string, StoredSession>();

  constructor(
    private readonly repository: RoomRepository,
    options: Partial<RoomServiceOptions> = {},
  ) {
    this.capacity = options.capacity ?? DEFAULTS.capacity;
    this.reconnectGraceMs = options.reconnectGraceMs ?? DEFAULTS.reconnectGraceMs;
    this.emptyRoomTtlMs = options.emptyRoomTtlMs ?? DEFAULTS.emptyRoomTtlMs;
    this.roomMaxAgeMs = options.roomMaxAgeMs ?? DEFAULTS.roomMaxAgeMs;
    this.chatHistoryLimit = options.chatHistoryLimit ?? DEFAULTS.chatHistoryLimit;
    this.now = options.now ?? (() => Date.now());
  }

  async createRoom(input: CreateRoomRequest): Promise<RoomAccess> {
    const passwordHash =
      input.password === undefined ? null : await hashPassword(input.password);
    const createdAt = this.now();
    const { participant, token } = this.createParticipant(input.displayName, createdAt);
    const room: StoredRoom = {
      id: this.generateRoomId(),
      createdAt,
      passwordHash,
      capacity: this.capacity,
      participants: new Map([[participant.id, participant]]),
      messages: [],
      playback: createIdlePlayback(createdAt),
      emptySince: null,
    };

    this.repository.create(room);
    this.sessions.set(participant.tokenHash, {
      roomId: room.id,
      participantId: participant.id,
    });

    return { room, participant, token };
  }

  async joinRoom(roomId: string, input: JoinRoomRequest): Promise<RoomAccess> {
    let room = this.getActiveRoom(roomId);

    if (!room) {
      throw new RoomError("ROOM_NOT_FOUND");
    }

    if (room.participants.size >= room.capacity) {
      throw new RoomError("ROOM_FULL");
    }

    if (room.passwordHash !== null) {
      if (input.password === undefined) {
        throw new RoomError("BAD_PASSWORD");
      }

      const matches = await verifyPassword(input.password, room.passwordHash);

      // The room may have expired or filled up while the hash was being checked.
      room = this.getActiveRoom(roomId);

      if (!room) {
        throw new RoomError("ROOM_NOT_FOUND");
      }

      if (!matches) {
        throw new RoomError("BAD_PASSWORD");
      }

      if (room.participants.size >= room.capacity) {
        throw new RoomError("ROOM_FULL");
      }
    }

    const joinedAt = this.now();
    const { participant, token } = this.createParticipant(input.displayName, joinedAt);

    room.participants.set(participant.id, participant);
    room.emptySince = null;
    this.sessions.set(participant.tokenHash, {
      roomId: room.id,
      participantId: participant.id,
    });

    return { room, participant, token };
  }

  getPublicRoom(roomId: string): PublicRoom | null {
    const room = this.getActiveRoom(roomId);
    return room ? this.toPublicRoom(room) : null;
  }

  getSnapshot(roomId: string, participantId: string): RoomSnapshot | null {
    const room = this.getActiveRoom(roomId);
    const participant = room?.participants.get(participantId);

    if (!room || !participant) {
      return null;
    }

    return {
      room: this.toPublicRoom(room),
      self: this.toPublicParticipant(participant),
      participants: this.listParticipants(room),
      messages: [...room.messages],
      playback: { ...room.playback },
      serverTime: this.now(),
    };
  }

  getChatHistory(roomId: string): ChatMessage[] | null {
    const room = this.getActiveRoom(roomId);
    return room ? [...room.messages] : null;
  }

  getPlayback(roomId: string): PlaybackState | null {
    const room = this.getActiveRoom(roomId);
    return room ? { ...room.playback } : null;
  }

  getServerTime(): number {
    return this.now();
  }

  selectVideo(
    roomId: string,
    participantId: string,
    socketId: string,
    videoId: string,
  ): PlaybackState | null {
    const current = this.getCurrentParticipant(roomId, participantId, socketId);

    if (!current) {
      return null;
    }

    const parsedVideoId = youtubeVideoIdSchema.safeParse(videoId);

    if (!parsedVideoId.success) {
      throw new RoomError("INVALID_INPUT", "Invalid YouTube video ID");
    }

    current.room.playback = {
      videoId: parsedVideoId.data,
      status: "paused",
      positionSeconds: 0,
      updatedAt: this.now(),
      revision: current.room.playback.revision + 1,
    };

    return { ...current.room.playback };
  }

  updatePlayback(
    roomId: string,
    participantId: string,
    socketId: string,
    command: PlaybackUpdateCommand,
  ): PlaybackState | null {
    const current = this.getCurrentParticipant(roomId, participantId, socketId);

    if (!current) {
      return null;
    }

    const parsedCommand = playbackUpdateCommandSchema.safeParse(command);

    if (!parsedCommand.success) {
      throw new RoomError("INVALID_INPUT", "Invalid playback command");
    }

    const { room } = current;
    const playback = room.playback;
    const update = parsedCommand.data;

    if (playback.status === "idle" || playback.videoId === null) {
      throw new RoomError("INVALID_INPUT", "Select a video before controlling playback");
    }

    if (update.videoId !== playback.videoId) {
      throw new RoomError("VIDEO_MISMATCH");
    }

    room.playback = {
      videoId: playback.videoId,
      status:
        update.action === "play"
          ? "playing"
          : update.action === "pause"
            ? "paused"
            : playback.status,
      positionSeconds: update.positionSeconds,
      updatedAt: this.now(),
      revision: playback.revision + 1,
    };

    return { ...room.playback };
  }

  isCurrentSocket(roomId: string, participantId: string, socketId: string): boolean {
    return this.getCurrentParticipant(roomId, participantId, socketId) !== null;
  }

  postChatMessage(
    roomId: string,
    participantId: string,
    socketId: string,
    text: string,
  ): ChatMessage | null {
    const current = this.getCurrentParticipant(roomId, participantId, socketId);

    if (!current) {
      return null;
    }

    const { room, participant } = current;
    const message: ChatMessage = {
      id: createMessageId(),
      senderId: participant.id,
      senderName: participant.displayName,
      text,
      sentAt: new Date(this.now()).toISOString(),
    };

    room.messages.push(message);

    if (room.messages.length > this.chatHistoryLimit) {
      room.messages.splice(0, room.messages.length - this.chatHistoryLimit);
    }

    return message;
  }

  getPresence(roomId: string): PresenceUpdate | null {
    const room = this.getActiveRoom(roomId);

    if (!room) {
      return null;
    }

    return {
      participants: this.listParticipants(room),
      serverTime: this.now(),
    };
  }

  toPublicRoom(room: StoredRoom): PublicRoom {
    return {
      id: room.id,
      createdAt: room.createdAt,
      requiresPassword: room.passwordHash !== null,
      capacity: room.capacity,
      participantCount: room.participants.size,
    };
  }

  toPublicParticipant(participant: StoredParticipant): PublicParticipant {
    return {
      id: participant.id,
      displayName: participant.displayName,
      connected: participant.connected,
      joinedAt: participant.joinedAt,
    };
  }

  authenticateToken(token: string): StoredSession | null {
    const tokenHash = hashToken(token);
    const session = this.sessions.get(tokenHash);

    if (!session) {
      return null;
    }

    const room = this.getActiveRoom(session.roomId);
    const participant = room?.participants.get(session.participantId);

    if (!room || !participant) {
      this.sessions.delete(tokenHash);
      return null;
    }

    return session;
  }

  markConnected(
    roomId: string,
    participantId: string,
    socketId: string,
  ): ConnectedParticipant | null {
    const room = this.getActiveRoom(roomId);
    const participant = room?.participants.get(participantId);

    if (!room || !participant) {
      return null;
    }

    const previousSocketId = participant.socketId;
    participant.connected = true;
    participant.socketId = socketId;
    participant.disconnectedAt = null;

    return { participant, previousSocketId };
  }

  markDisconnected(roomId: string, participantId: string, socketId: string): boolean {
    const room = this.getActiveRoom(roomId);
    const participant = room?.participants.get(participantId);

    if (!room || !participant || participant.socketId !== socketId) {
      return false;
    }

    participant.connected = false;
    participant.socketId = null;
    participant.disconnectedAt = this.now();
    return true;
  }

  leave(roomId: string, participantId: string): boolean {
    const room = this.getActiveRoom(roomId);

    if (!room) {
      return false;
    }

    return this.removeParticipant(room, participantId);
  }

  /**
   * Removes participants whose reconnect grace period has elapsed and deletes
   * expired or long-empty rooms. Returns the room IDs whose presence changed.
   */
  sweep(): string[] {
    const now = this.now();
    const changedRoomIds = new Set<string>();

    for (const room of [...this.repository.all()]) {
      if (now - room.createdAt >= this.roomMaxAgeMs) {
        this.deleteRoom(room);
        changedRoomIds.add(room.id);
        continue;
      }

      for (const participant of [...room.participants.values()]) {
        const graceExpired =
          !participant.connected &&
          participant.disconnectedAt !== null &&
          now - participant.disconnectedAt >= this.reconnectGraceMs;

        if (graceExpired && this.removeParticipant(room, participant.id)) {
          changedRoomIds.add(room.id);
        }
      }

      if (room.participants.size === 0) {
        if (room.emptySince === null) {
          room.emptySince = now;
        }

        if (now - room.emptySince >= this.emptyRoomTtlMs) {
          this.deleteRoom(room);
          changedRoomIds.add(room.id);
        }
      }
    }

    return [...changedRoomIds];
  }

  private getCurrentParticipant(
    roomId: string,
    participantId: string,
    socketId: string,
  ): { room: StoredRoom; participant: StoredParticipant } | null {
    const room = this.getActiveRoom(roomId);
    const participant = room?.participants.get(participantId);

    if (
      !room ||
      !participant ||
      !participant.connected ||
      participant.socketId !== socketId
    ) {
      return null;
    }

    return { room, participant };
  }

  private createParticipant(
    displayName: string,
    joinedAt: number,
  ): { participant: StoredParticipant; token: string } {
    const token = createSessionToken();

    return {
      token,
      participant: {
        id: createParticipantId(),
        displayName,
        tokenHash: hashToken(token),
        connected: false,
        socketId: null,
        joinedAt,
        disconnectedAt: joinedAt,
      },
    };
  }

  private generateRoomId(): string {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const roomId = createRoomId();

      if (!this.repository.find(roomId)) {
        return roomId;
      }
    }

    throw new RoomError("INTERNAL", "Could not generate a unique room ID");
  }

  private getActiveRoom(roomId: string): StoredRoom | null {
    const room = this.repository.find(roomId);

    if (!room) {
      return null;
    }

    const now = this.now();
    const expiredByAge = now - room.createdAt >= this.roomMaxAgeMs;
    const expiredByEmptiness =
      room.emptySince !== null && now - room.emptySince >= this.emptyRoomTtlMs;

    if (expiredByAge || expiredByEmptiness) {
      this.deleteRoom(room);
      return null;
    }

    return room;
  }

  private removeParticipant(room: StoredRoom, participantId: string): boolean {
    const participant = room.participants.get(participantId);

    if (!participant) {
      return false;
    }

    room.participants.delete(participantId);
    this.sessions.delete(participant.tokenHash);

    if (room.participants.size === 0) {
      room.emptySince = this.now();
    }

    return true;
  }

  private deleteRoom(room: StoredRoom): void {
    for (const participant of room.participants.values()) {
      this.sessions.delete(participant.tokenHash);
    }

    this.repository.delete(room.id);
  }

  private listParticipants(room: StoredRoom): PublicParticipant[] {
    return [...room.participants.values()]
      .sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id))
      .map((participant) => this.toPublicParticipant(participant));
  }
}
