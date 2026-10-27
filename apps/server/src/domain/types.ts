import type { ChatMessage, PlaybackState } from "@tempass/shared";

export interface StoredParticipant {
  id: string;
  displayName: string;
  tokenHash: string;
  connected: boolean;
  socketId: string | null;
  joinedAt: number;
  disconnectedAt: number | null;
}

export interface StoredRoom {
  id: string;
  createdAt: number;
  passwordHash: string | null;
  capacity: number;
  participants: Map<string, StoredParticipant>;
  messages: ChatMessage[];
  playback: PlaybackState;
  emptySince: number | null;
}

export interface StoredSession {
  roomId: string;
  participantId: string;
}

export interface RoomServiceOptions {
  capacity: number;
  reconnectGraceMs: number;
  emptyRoomTtlMs: number;
  roomMaxAgeMs: number;
  chatHistoryLimit: number;
  now: () => number;
}

export interface RoomAccess {
  room: StoredRoom;
  participant: StoredParticipant;
  token: string;
}

export interface ConnectedParticipant {
  participant: StoredParticipant;
  previousSocketId: string | null;
}
