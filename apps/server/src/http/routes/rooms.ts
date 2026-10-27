import { Router } from "express";
import type { z } from "zod";

import {
  createRoomRequestSchema,
  joinRoomRequestSchema,
  publicRoomSchema,
  roomAccessResponseSchema,
  roomIdSchema,
  roomInvitePath,
  type RoomAccessResponse,
} from "@tempass/shared";

import { RoomError } from "../../domain/errors";
import type { RoomService } from "../../domain/roomService";
import type { RoomAccess } from "../../domain/types";

export function createRoomsRouter(roomService: RoomService, webOrigin: string) {
  const router = Router();
  const normalizedWebOrigin = webOrigin.replace(/\/+$/, "");

  router.post("/api/rooms", async (request, response, next) => {
    try {
      const input = parse(createRoomRequestSchema, request.body);
      const result = await roomService.createRoom(input);

      response.status(201).json(toAccessResponse(result, roomService, normalizedWebOrigin));
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/rooms/:roomId", (request, response, next) => {
    try {
      const roomId = parseRoomId(request.params.roomId);
      const room = roomService.getPublicRoom(roomId);

      if (!room) {
        throw new RoomError("ROOM_NOT_FOUND");
      }

      response.status(200).json(publicRoomSchema.parse(room));
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/rooms/:roomId/join", async (request, response, next) => {
    try {
      const roomId = parseRoomId(request.params.roomId);
      const input = parse(joinRoomRequestSchema, request.body);
      const result = await roomService.joinRoom(roomId, input);

      response.status(200).json(toAccessResponse(result, roomService, normalizedWebOrigin));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);

  if (!result.success) {
    throw new RoomError("INVALID_INPUT");
  }

  return result.data;
}

function parseRoomId(value: unknown): string {
  const result = roomIdSchema.safeParse(value);

  if (!result.success) {
    throw new RoomError("ROOM_NOT_FOUND");
  }

  return result.data;
}

function toAccessResponse(
  result: RoomAccess,
  roomService: RoomService,
  webOrigin: string,
): RoomAccessResponse {
  return roomAccessResponseSchema.parse({
    room: roomService.toPublicRoom(result.room),
    participant: roomService.toPublicParticipant(result.participant),
    sessionToken: result.token,
    inviteUrl: `${webOrigin}${roomInvitePath(result.room.id)}`,
  });
}
