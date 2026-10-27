// @vitest-environment node
import { describe, expect, it } from "vitest";

import { createTestContext } from "./helpers/context";

describe("RoomService", () => {
  it("creates unique, well-formed room IDs", async () => {
    const { roomService } = createTestContext();
    const ids = new Set<string>();

    for (let index = 0; index < 100; index += 1) {
      const access = await roomService.createRoom({ displayName: `User ${index}` });
      ids.add(access.room.id);
      expect(access.room.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    }

    expect(ids.size).toBe(100);
  });

  it("creates a room with its creator and enforces capacity", async () => {
    const { roomService } = createTestContext({ capacity: 2 });
    const created = await roomService.createRoom({ displayName: "Alex" });

    expect(roomService.getPublicRoom(created.room.id)).toMatchObject({
      participantCount: 1,
      capacity: 2,
      requiresPassword: false,
    });

    await roomService.joinRoom(created.room.id, { displayName: "Sam" });
    expect(roomService.getPublicRoom(created.room.id)?.participantCount).toBe(2);

    await expect(
      roomService.joinRoom(created.room.id, { displayName: "Cara" }),
    ).rejects.toMatchObject({ code: "ROOM_FULL" });
  });

  it("rejects joins for nonexistent rooms", async () => {
    const { roomService } = createTestContext();

    await expect(
      roomService.joinRoom("AAAAAAAAAAAAAAAAAAAAAA", { displayName: "Sam" }),
    ).rejects.toMatchObject({ code: "ROOM_NOT_FOUND" });
  });

  it("requires and verifies a room password without leaving ghosts", async () => {
    const { roomService } = createTestContext();
    const created = await roomService.createRoom({
      displayName: "Alex",
      password: "hunter22",
    });

    await expect(
      roomService.joinRoom(created.room.id, { displayName: "Sam" }),
    ).rejects.toMatchObject({ code: "BAD_PASSWORD" });

    await expect(
      roomService.joinRoom(created.room.id, { displayName: "Sam", password: "wrongpass" }),
    ).rejects.toMatchObject({ code: "BAD_PASSWORD" });

    expect(roomService.getPublicRoom(created.room.id)?.participantCount).toBe(1);

    const joined = await roomService.joinRoom(created.room.id, {
      displayName: "Sam",
      password: "hunter22",
    });

    expect(joined.participant.displayName).toBe("Sam");
    expect(roomService.getPublicRoom(created.room.id)?.participantCount).toBe(2);
  });

  it("keeps rooms isolated from each other", async () => {
    const { roomService } = createTestContext();
    const first = await roomService.createRoom({ displayName: "Alex" });
    const second = await roomService.createRoom({ displayName: "Bea" });

    await roomService.joinRoom(first.room.id, { displayName: "Sam" });
    roomService.leave(first.room.id, first.participant.id);

    expect(roomService.getPublicRoom(first.room.id)?.participantCount).toBe(1);
    expect(roomService.getPublicRoom(second.room.id)?.participantCount).toBe(1);
    expect(roomService.authenticateToken(second.token)).toMatchObject({
      roomId: second.room.id,
    });
    expect(roomService.authenticateToken(first.token)).toBeNull();
  });

  it("invalidates a session token after the participant leaves", async () => {
    const { roomService } = createTestContext();
    const created = await roomService.createRoom({ displayName: "Alex" });

    expect(roomService.authenticateToken(created.token)).toMatchObject({
      roomId: created.room.id,
      participantId: created.participant.id,
    });

    roomService.leave(created.room.id, created.participant.id);

    expect(roomService.authenticateToken(created.token)).toBeNull();
    expect(roomService.getPublicRoom(created.room.id)?.participantCount).toBe(0);
  });

  it("removes disconnected participants after the reconnect grace period", async () => {
    let now = 1_000;
    const { roomService } = createTestContext({
      now: () => now,
      reconnectGraceMs: 100,
      emptyRoomTtlMs: 200,
    });
    const created = await roomService.createRoom({ displayName: "Alex" });

    roomService.markConnected(created.room.id, created.participant.id, "socket-1");
    expect(roomService.markDisconnected(created.room.id, created.participant.id, "socket-1")).toBe(
      true,
    );

    now += 50;
    roomService.sweep();

    const presence = roomService.getPresence(created.room.id);
    expect(presence?.participants).toHaveLength(1);
    expect(presence?.participants[0]?.connected).toBe(false);

    now += 50;
    roomService.sweep();

    expect(roomService.getPublicRoom(created.room.id)?.participantCount).toBe(0);
    expect(roomService.authenticateToken(created.token)).toBeNull();
  });

  it("keeps an empty room for the configured TTL, then deletes it", async () => {
    let now = 10_000;
    const { roomService } = createTestContext({
      now: () => now,
      reconnectGraceMs: 100,
      emptyRoomTtlMs: 200,
    });
    const created = await roomService.createRoom({ displayName: "Alex" });

    now += 100;
    roomService.sweep();
    expect(roomService.getPublicRoom(created.room.id)?.participantCount).toBe(0);
    expect(roomService.getPublicRoom(created.room.id)).not.toBeNull();

    now += 199;
    roomService.sweep();
    expect(roomService.getPublicRoom(created.room.id)).not.toBeNull();

    now += 1;
    roomService.sweep();
    expect(roomService.getPublicRoom(created.room.id)).toBeNull();
  });

  it("expires rooms that exceed the maximum lifetime", async () => {
    let now = 5_000;
    const { roomService } = createTestContext({
      now: () => now,
      roomMaxAgeMs: 1_000,
      emptyRoomTtlMs: 10_000,
    });
    const created = await roomService.createRoom({ displayName: "Alex" });
    roomService.markConnected(created.room.id, created.participant.id, "socket-1");

    now += 999;
    expect(roomService.getPublicRoom(created.room.id)).not.toBeNull();

    now += 1;
    expect(roomService.getPublicRoom(created.room.id)).toBeNull();
    expect(roomService.authenticateToken(created.token)).toBeNull();
  });

  it("ignores a disconnect from a socket that is no longer current", async () => {
    const { roomService } = createTestContext();
    const created = await roomService.createRoom({ displayName: "Alex" });

    roomService.markConnected(created.room.id, created.participant.id, "socket-1");
    roomService.markConnected(created.room.id, created.participant.id, "socket-2");

    expect(
      roomService.markDisconnected(created.room.id, created.participant.id, "socket-1"),
    ).toBe(false);
    expect(roomService.getPresence(created.room.id)?.participants[0]?.connected).toBe(true);
  });
});
