import busboy from "busboy";
import { Router, type Request } from "express";

import {
  chatMediaIdSchema,
  chatMediaResponseSchema,
  roomIdSchema,
  type ChatImageMimeType,
  type ChatMedia,
} from "@tempass/shared";

import { RoomError } from "../../domain/errors";
import type { RoomService } from "../../domain/roomService";
import { inspectImageBytes } from "../../media/imageMetadata";
import type { StoredMedia } from "../../storage/mediaStore";
import { consumeSlidingWindow } from "../../util/rateLimit";

const DEFAULT_UPLOAD_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_UPLOAD_RATE_LIMIT_MAX_UPLOADS = 10;
const MULTIPART_OVERHEAD_BYTES = 1_024 * 1_024;

const EXTENSION_BY_MIME_TYPE: Record<ChatImageMimeType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export interface MediaRouterOptions {
  uploadRateLimitWindowMs?: number;
  uploadRateLimitMaxUploads?: number;
}

interface UploadedImage {
  buffer: Buffer;
  declaredMimeType: string;
}

export function createMediaRouter(roomService: RoomService, options: MediaRouterOptions = {}) {
  const router = Router();
  const uploadRateLimitWindowMs =
    options.uploadRateLimitWindowMs ?? DEFAULT_UPLOAD_RATE_LIMIT_WINDOW_MS;
  const uploadRateLimitMaxUploads =
    options.uploadRateLimitMaxUploads ?? DEFAULT_UPLOAD_RATE_LIMIT_MAX_UPLOADS;
  const recentUploads = new Map<string, number[]>();
  const maxImageBytes = roomService.mediaStore.limits.maxImageBytes;

  router.post("/api/rooms/:roomId/media", async (request, response, next) => {
    try {
      const roomId = parseRoomId(request.params.roomId);
      const session = authorize(request, roomService, roomId);
      const now = roomService.getServerTime();

      consumeUploadAllowance(
        recentUploads,
        `${roomId}:${session.participantId}`,
        now,
        uploadRateLimitWindowMs,
        uploadRateLimitMaxUploads,
      );

      if (!roomService.mediaStore.canAccept(roomId)) {
        request.resume();
        throw new RoomError("MEDIA_LIMIT_REACHED");
      }

      const contentLength = Number(request.get("content-length"));

      if (
        Number.isFinite(contentLength) &&
        contentLength > maxImageBytes + MULTIPART_OVERHEAD_BYTES
      ) {
        request.resume();
        throw new RoomError("MEDIA_TOO_LARGE");
      }

      const upload = await readMultipartImage(request, maxImageBytes);

      if (upload.declaredMimeType === "image/svg+xml") {
        throw new RoomError("UNSUPPORTED_MEDIA_TYPE");
      }

      const inspection = inspectImageBytes(upload.buffer);

      if (!inspection.ok) {
        throw inspection.reason === "unsupported"
          ? new RoomError("UNSUPPORTED_MEDIA_TYPE")
          : new RoomError("INVALID_INPUT", "That image file is malformed");
      }

      const result = roomService.mediaStore.add({
        roomId,
        participantId: session.participantId,
        mimeType: inspection.image.mimeType,
        width: inspection.image.width,
        height: inspection.image.height,
        buffer: upload.buffer,
        createdAt: now,
      });

      if (!result.ok) {
        throw new RoomError(result.code);
      }

      response.status(201).json(
        chatMediaResponseSchema.parse({ media: toChatMedia(result.media) }),
      );
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/rooms/:roomId/media/:mediaId", (request, response, next) => {
    try {
      const roomId = parseRoomId(request.params.roomId);
      authorize(request, roomService, roomId);

      const parsedMediaId = chatMediaIdSchema.safeParse(request.params.mediaId);

      if (!parsedMediaId.success) {
        throw new RoomError("MEDIA_NOT_FOUND");
      }

      const media = roomService.mediaStore.find(roomId, parsedMediaId.data);

      if (!media) {
        throw new RoomError("MEDIA_NOT_FOUND");
      }

      response.setHeader("Cache-Control", "private, max-age=300");
      response.setHeader("Content-Type", media.mimeType);
      response.setHeader("Content-Length", String(media.sizeBytes));
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader(
        "Content-Disposition",
        `inline; filename="${media.id}.${EXTENSION_BY_MIME_TYPE[media.mimeType]}"`,
      );
      response.status(200).send(media.buffer);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function authorize(request: Request, roomService: RoomService, roomId: string) {
  const header = request.get("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : null;

  if (!token) {
    throw new RoomError("UNAUTHORIZED");
  }

  const session = roomService.authenticateToken(token);

  if (!session || session.roomId !== roomId) {
    throw new RoomError("UNAUTHORIZED");
  }

  return session;
}

function parseRoomId(value: unknown): string {
  const result = roomIdSchema.safeParse(value);

  if (!result.success) {
    throw new RoomError("ROOM_NOT_FOUND");
  }

  return result.data;
}

function consumeUploadAllowance(
  recentUploads: Map<string, number[]>,
  key: string,
  now: number,
  windowMs: number,
  maxUploads: number,
): void {
  if (recentUploads.size > 1_024) {
    for (const [existingKey, times] of recentUploads) {
      const latest = times[times.length - 1];

      if (latest === undefined || now - latest >= windowMs) {
        recentUploads.delete(existingKey);
      }
    }
  }

  const times = recentUploads.get(key) ?? [];

  if (!consumeSlidingWindow(times, now, windowMs, maxUploads)) {
    recentUploads.set(key, times);
    throw new RoomError("RATE_LIMITED");
  }

  recentUploads.set(key, times);
}

function readMultipartImage(request: Request, maxBytes: number): Promise<UploadedImage> {
  return new Promise((resolve, reject) => {
    let form: ReturnType<typeof busboy>;

    try {
      form = busboy({
        headers: request.headers,
        limits: {
          files: 1,
          fileSize: maxBytes,
          fields: 0,
          parts: 2,
          headerPairs: 100,
        },
      });
    } catch {
      reject(new RoomError("INVALID_INPUT", "Malformed multipart request"));
      return;
    }

    const chunks: Buffer[] = [];
    let declaredMimeType = "";
    let fileSeen = false;
    let truncated = false;
    let settled = false;

    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      callback();
    };

    form.on("file", (fieldName, stream, info) => {
      if (fieldName !== "image" || fileSeen) {
        stream.resume();
        return;
      }

      fileSeen = true;
      declaredMimeType = info.mimeType;
      stream.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });
      stream.on("limit", () => {
        truncated = true;
      });
    });

    form.on("filesLimit", () => {
      finish(() => reject(new RoomError("INVALID_INPUT", "Only one image can be uploaded")));
    });

    form.on("partsLimit", () => {
      finish(() => reject(new RoomError("INVALID_INPUT", "Malformed multipart request")));
    });

    form.on("fieldsLimit", () => {
      finish(() => reject(new RoomError("INVALID_INPUT", "Malformed multipart request")));
    });

    form.on("error", () => {
      finish(() => reject(new RoomError("INVALID_INPUT", "Malformed multipart request")));
    });

    form.on("close", () => {
      if (!fileSeen) {
        finish(() => reject(new RoomError("INVALID_INPUT", "No image uploaded")));
        return;
      }

      if (truncated) {
        finish(() => reject(new RoomError("MEDIA_TOO_LARGE")));
        return;
      }

      finish(() => resolve({ buffer: Buffer.concat(chunks), declaredMimeType }));
    });

    request.on("aborted", () => {
      finish(() => reject(new RoomError("INVALID_INPUT", "Upload cancelled")));
    });

    request.on("error", () => {
      finish(() => reject(new RoomError("INVALID_INPUT", "Upload failed")));
    });

    request.pipe(form);
  });
}

function toChatMedia(media: StoredMedia): ChatMedia {
  return {
    id: media.id,
    mimeType: media.mimeType,
    sizeBytes: media.sizeBytes,
    width: media.width,
    height: media.height,
  };
}
