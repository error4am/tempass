// @vitest-environment node
import request from "supertest";
import { describe, expect, it } from "vitest";

import { roomAccessResponseSchema, publicRoomSchema } from "@tempass/shared";

import { createTestContext, TEST_WEB_ORIGIN } from "./helpers/context";

describe("room HTTP API", () => {
  it("creates a room and returns a safe access payload", async () => {
    const { app } = createTestContext();
    const response = await request(app)
      .post("/api/rooms")
      .send({ displayName: "Alex", password: "topsecret9" });

    expect(response.status).toBe(201);

    const parsed = roomAccessResponseSchema.safeParse(response.body);
    expect(parsed.success).toBe(true);

    expect(response.body.room.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(response.body.room.participantCount).toBe(1);
    expect(response.body.room.requiresPassword).toBe(true);
    expect(response.body.inviteUrl).toBe(
      `${TEST_WEB_ORIGIN}/join/${response.body.room.id}`,
    );
    expect(response.body.participant.displayName).toBe("Alex");

    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain("topsecret9");
    expect(serialized).not.toContain("passwordHash");
    expect(serialized).not.toContain("scrypt$");
  });

  it("generates unique room IDs across repeated requests", async () => {
    const { app } = createTestContext();
    const ids = new Set<string>();

    for (let index = 0; index < 25; index += 1) {
      const response = await request(app)
        .post("/api/rooms")
        .send({ displayName: `User ${index}` })
        .expect(201);

      ids.add(response.body.room.id);
    }

    expect(ids.size).toBe(25);
  });

  it("returns public room metadata without participant names", async () => {
    const { app } = createTestContext();
    const created = await request(app)
      .post("/api/rooms")
      .send({ displayName: "Alex" })
      .expect(201);

    const response = await request(app).get(`/api/rooms/${created.body.room.id}`).expect(200);
    const parsed = publicRoomSchema.safeParse(response.body);

    expect(parsed.success).toBe(true);
    expect(response.body).toEqual({
      id: created.body.room.id,
      createdAt: created.body.room.createdAt,
      requiresPassword: false,
      capacity: 2,
      participantCount: 1,
    });
    expect(JSON.stringify(response.body)).not.toContain("Alex");
  });

  it("joins a room when the password is correct", async () => {
    const { app } = createTestContext();
    const created = await request(app)
      .post("/api/rooms")
      .send({ displayName: "Alex", password: "topsecret9" })
      .expect(201);

    const joined = await request(app)
      .post(`/api/rooms/${created.body.room.id}/join`)
      .send({ displayName: "Sam", password: "topsecret9" })
      .expect(200);

    expect(joined.body.participant.displayName).toBe("Sam");
    expect(joined.body.room.participantCount).toBe(2);
    expect(JSON.stringify(joined.body)).not.toContain("topsecret9");
  });

  it("rejects incorrect and missing passwords without creating ghosts", async () => {
    const { app } = createTestContext();
    const created = await request(app)
      .post("/api/rooms")
      .send({ displayName: "Alex", password: "topsecret9" })
      .expect(201);

    const wrong = await request(app)
      .post(`/api/rooms/${created.body.room.id}/join`)
      .send({ displayName: "Sam", password: "incorrect1" });

    expect(wrong.status).toBe(401);
    expect(wrong.body).toEqual({
      code: "BAD_PASSWORD",
      message: "Incorrect room password",
    });

    const missing = await request(app)
      .post(`/api/rooms/${created.body.room.id}/join`)
      .send({ displayName: "Sam" });

    expect(missing.status).toBe(401);
    expect(missing.body.code).toBe("BAD_PASSWORD");

    const meta = await request(app).get(`/api/rooms/${created.body.room.id}`).expect(200);
    expect(meta.body.participantCount).toBe(1);
  });

  it("rejects nonexistent and invalid room IDs", async () => {
    const { app } = createTestContext();

    const missing = await request(app).get("/api/rooms/AAAAAAAAAAAAAAAAAAAAAA");
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe("ROOM_NOT_FOUND");

    const invalid = await request(app).get("/api/rooms/not-a-room");
    expect(invalid.status).toBe(404);

    const joinMissing = await request(app)
      .post("/api/rooms/AAAAAAAAAAAAAAAAAAAAAA/join")
      .send({ displayName: "Sam" });
    expect(joinMissing.status).toBe(404);
    expect(joinMissing.body.code).toBe("ROOM_NOT_FOUND");
  });

  it("enforces the participant limit", async () => {
    const { app } = createTestContext({ capacity: 2 });
    const created = await request(app)
      .post("/api/rooms")
      .send({ displayName: "Alex" })
      .expect(201);

    await request(app)
      .post(`/api/rooms/${created.body.room.id}/join`)
      .send({ displayName: "Sam" })
      .expect(200);

    const third = await request(app)
      .post(`/api/rooms/${created.body.room.id}/join`)
      .send({ displayName: "Cara" });

    expect(third.status).toBe(409);
    expect(third.body.code).toBe("ROOM_FULL");
  });

  it("rejects invalid request payloads", async () => {
    const { app } = createTestContext();

    const emptyName = await request(app).post("/api/rooms").send({ displayName: "   " });
    expect(emptyName.status).toBe(400);
    expect(emptyName.body.code).toBe("INVALID_INPUT");

    const longName = await request(app)
      .post("/api/rooms")
      .send({ displayName: "x".repeat(25) });
    expect(longName.status).toBe(400);

    const shortPassword = await request(app)
      .post("/api/rooms")
      .send({ displayName: "Alex", password: "abc" });
    expect(shortPassword.status).toBe(400);

    const extraField = await request(app)
      .post("/api/rooms")
      .send({ displayName: "Alex", unexpected: true });
    expect(extraField.status).toBe(400);

    const malformed = await request(app)
      .post("/api/rooms")
      .set("Content-Type", "application/json")
      .send('{"displayName":');
    expect(malformed.status).toBe(400);
    expect(malformed.body.code).toBe("INVALID_INPUT");
  });

  it("applies the configured CORS origin", async () => {
    const { app } = createTestContext();
    const response = await request(app)
      .get("/health")
      .set("Origin", TEST_WEB_ORIGIN)
      .expect(200);

    expect(response.headers["access-control-allow-origin"]).toBe(TEST_WEB_ORIGIN);
  });
});
