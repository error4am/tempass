import type { Express } from "express";
import request from "supertest";

import {
  roomAccessResponseSchema,
  type CreateRoomRequest,
  type JoinRoomRequest,
  type RoomAccessResponse,
} from "@tempass/shared";

export async function createRoomViaHttp(
  app: Express,
  body: CreateRoomRequest,
): Promise<RoomAccessResponse> {
  const response = await request(app).post("/api/rooms").send(body).expect(201);
  return roomAccessResponseSchema.parse(response.body);
}

export async function joinRoomViaHttp(
  app: Express,
  roomId: string,
  body: JoinRoomRequest,
): Promise<RoomAccessResponse> {
  const response = await request(app)
    .post(`/api/rooms/${roomId}/join`)
    .send(body)
    .expect(200);
  return roomAccessResponseSchema.parse(response.body);
}
