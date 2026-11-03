import type { ChatImageMimeType } from "@tempass/shared";

import { createMediaId } from "../security/tokens";

export interface StoredMedia {
  id: string;
  roomId: string;
  participantId: string;
  mimeType: ChatImageMimeType;
  sizeBytes: number;
  width: number;
  height: number;
  buffer: Buffer;
  createdAt: number;
}

export interface MediaLimits {
  maxImageBytes: number;
  roomMaxBytes: number;
  globalMaxBytes: number;
}

export interface AddMediaInput {
  roomId: string;
  participantId: string;
  mimeType: ChatImageMimeType;
  width: number;
  height: number;
  buffer: Buffer;
  createdAt: number;
}

export type MediaLimitCode = "MEDIA_TOO_LARGE" | "MEDIA_LIMIT_REACHED";

export type AddMediaResult =
  | { ok: true; media: StoredMedia }
  | { ok: false; code: MediaLimitCode };

export interface MediaStore {
  readonly limits: MediaLimits;
  canAccept(roomId: string): boolean;
  add(input: AddMediaInput): AddMediaResult;
  find(roomId: string, mediaId: string): StoredMedia | undefined;
  deleteByRoom(roomId: string): void;
  getRoomBytes(roomId: string): number;
  readonly totalBytes: number;
  readonly count: number;
}

export class MemoryMediaStore implements MediaStore {
  private readonly media = new Map<string, StoredMedia>();
  private readonly roomMedia = new Map<string, Set<string>>();
  private readonly roomBytes = new Map<string, number>();
  private globalBytes = 0;

  constructor(readonly limits: MediaLimits) {}

  canAccept(roomId: string): boolean {
    if (this.globalBytes >= this.limits.globalMaxBytes) {
      return false;
    }

    const roomUsage = this.roomBytes.get(roomId) ?? 0;
    return roomUsage < this.limits.roomMaxBytes;
  }

  add(input: AddMediaInput): AddMediaResult {
    const sizeBytes = input.buffer.length;

    if (sizeBytes > this.limits.maxImageBytes) {
      return { ok: false, code: "MEDIA_TOO_LARGE" };
    }

    const roomUsage = this.roomBytes.get(input.roomId) ?? 0;

    if (
      roomUsage + sizeBytes > this.limits.roomMaxBytes ||
      this.globalBytes + sizeBytes > this.limits.globalMaxBytes
    ) {
      return { ok: false, code: "MEDIA_LIMIT_REACHED" };
    }

    const media: StoredMedia = {
      id: createMediaId(),
      roomId: input.roomId,
      participantId: input.participantId,
      mimeType: input.mimeType,
      sizeBytes,
      width: input.width,
      height: input.height,
      buffer: input.buffer,
      createdAt: input.createdAt,
    };

    this.media.set(media.id, media);
    this.roomBytes.set(input.roomId, roomUsage + sizeBytes);
    this.globalBytes += sizeBytes;

    const roomIds = this.roomMedia.get(input.roomId) ?? new Set<string>();
    roomIds.add(media.id);
    this.roomMedia.set(input.roomId, roomIds);

    return { ok: true, media };
  }

  find(roomId: string, mediaId: string): StoredMedia | undefined {
    const media = this.media.get(mediaId);
    return media?.roomId === roomId ? media : undefined;
  }

  deleteByRoom(roomId: string): void {
    const mediaIds = this.roomMedia.get(roomId);

    if (!mediaIds) {
      this.roomBytes.delete(roomId);
      return;
    }

    for (const mediaId of mediaIds) {
      const media = this.media.get(mediaId);

      if (media) {
        this.globalBytes -= media.sizeBytes;
        this.media.delete(mediaId);
      }
    }

    this.roomMedia.delete(roomId);
    this.roomBytes.delete(roomId);
  }

  getRoomBytes(roomId: string): number {
    return this.roomBytes.get(roomId) ?? 0;
  }

  get totalBytes(): number {
    return this.globalBytes;
  }

  get count(): number {
    return this.media.size;
  }
}
