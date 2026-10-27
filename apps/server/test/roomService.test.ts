// @vitest-environment node
import { MAX_PLAYBACK_POSITION_SECONDS } from "@tempass/shared";
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

  describe("playback", () => {
    const videoId = "dQw4w9WgXcQ";
    const otherVideoId = "M7lc1UVf-VE";
    const socketId = "socket-1";

    async function createPlaybackFixture() {
      let now = 1_000;
      const { roomService } = createTestContext({ now: () => now });
      const created = await roomService.createRoom({ displayName: "Alex" });

      roomService.markConnected(created.room.id, created.participant.id, socketId);

      return {
        roomService,
        created,
        advance: (milliseconds: number) => {
          now += milliseconds;
        },
      };
    }

    function captureRoomError(callback: () => unknown): unknown {
      try {
        callback();
      } catch (error) {
        return error;
      }

      return null;
    }

    it("starts idle and includes playback in snapshots", async () => {
      const { roomService, created } = await createPlaybackFixture();
      const idlePlayback = {
        videoId: null,
        status: "idle",
        positionSeconds: 0,
        updatedAt: 1_000,
        revision: 0,
      };

      expect(roomService.getPlayback(created.room.id)).toEqual(idlePlayback);
      expect(
        roomService.getSnapshot(created.room.id, created.participant.id)?.playback,
      ).toEqual(idlePlayback);
      expect(roomService.getPlayback("AAAAAAAAAAAAAAAAAAAAAA")).toBeNull();
    });

    it("selects a video as paused at the start and advances the revision", async () => {
      const { roomService, created, advance } = await createPlaybackFixture();

      advance(500);
      const selected = roomService.selectVideo(
        created.room.id,
        created.participant.id,
        socketId,
        videoId,
      );

      expect(selected).toEqual({
        videoId,
        status: "paused",
        positionSeconds: 0,
        updatedAt: 1_500,
        revision: 1,
      });
      expect(roomService.getPlayback(created.room.id)).toEqual(selected);
    });

    it("applies play, pause, and seek commands with server timestamps", async () => {
      const { roomService, created, advance } = await createPlaybackFixture();
      const roomId = created.room.id;
      const participantId = created.participant.id;

      roomService.selectVideo(roomId, participantId, socketId, videoId);

      advance(500);
      expect(
        roomService.updatePlayback(roomId, participantId, socketId, {
          action: "play",
          videoId,
          positionSeconds: 12.5,
        }),
      ).toMatchObject({
        videoId,
        status: "playing",
        positionSeconds: 12.5,
        updatedAt: 1_500,
        revision: 2,
      });

      advance(500);
      expect(
        roomService.updatePlayback(roomId, participantId, socketId, {
          action: "seek",
          videoId,
          positionSeconds: 20,
        }),
      ).toMatchObject({
        status: "playing",
        positionSeconds: 20,
        updatedAt: 2_000,
        revision: 3,
      });

      advance(500);
      expect(
        roomService.updatePlayback(roomId, participantId, socketId, {
          action: "pause",
          videoId,
          positionSeconds: 21,
        }),
      ).toMatchObject({
        status: "paused",
        positionSeconds: 21,
        updatedAt: 2_500,
        revision: 4,
      });

      advance(500);
      expect(
        roomService.updatePlayback(roomId, participantId, socketId, {
          action: "seek",
          videoId,
          positionSeconds: 30,
        }),
      ).toMatchObject({
        status: "paused",
        positionSeconds: 30,
        updatedAt: 3_000,
        revision: 5,
      });
    });

    it("rejects invalid video IDs, positions, and idle controls without mutating state", async () => {
      const { roomService, created } = await createPlaybackFixture();
      const roomId = created.room.id;
      const participantId = created.participant.id;
      const idlePlayback = roomService.getPlayback(roomId);

      expect(
        captureRoomError(() =>
          roomService.selectVideo(roomId, participantId, socketId, "too-short"),
        ),
      ).toMatchObject({ code: "INVALID_INPUT" });
      expect(
        captureRoomError(() =>
          roomService.updatePlayback(roomId, participantId, socketId, {
            action: "play",
            videoId,
            positionSeconds: 0,
          }),
        ),
      ).toMatchObject({ code: "INVALID_INPUT" });
      expect(roomService.getPlayback(roomId)).toEqual(idlePlayback);

      roomService.selectVideo(roomId, participantId, socketId, videoId);
      const selectedPlayback = roomService.getPlayback(roomId);

      for (const positionSeconds of [
        -1,
        Number.NaN,
        Infinity,
        MAX_PLAYBACK_POSITION_SECONDS + 1,
      ]) {
        expect(
          captureRoomError(() =>
            roomService.updatePlayback(roomId, participantId, socketId, {
              action: "play",
              videoId,
              positionSeconds,
            }),
          ),
        ).toMatchObject({ code: "INVALID_INPUT" });
      }

      expect(roomService.getPlayback(roomId)).toEqual(selectedPlayback);
    });

    it("rejects commands for a stale video without advancing the revision", async () => {
      const { roomService, created } = await createPlaybackFixture();
      const roomId = created.room.id;
      const participantId = created.participant.id;

      roomService.selectVideo(roomId, participantId, socketId, videoId);
      const selectedPlayback = roomService.getPlayback(roomId);

      expect(
        captureRoomError(() =>
          roomService.updatePlayback(roomId, participantId, socketId, {
            action: "play",
            videoId: otherVideoId,
            positionSeconds: 10,
          }),
        ),
      ).toMatchObject({ code: "VIDEO_MISMATCH" });
      expect(roomService.getPlayback(roomId)).toEqual(selectedPlayback);
    });

    it("ignores commands from disconnected or stale sockets", async () => {
      const { roomService, created } = await createPlaybackFixture();
      const roomId = created.room.id;
      const participantId = created.participant.id;

      expect(
        roomService.selectVideo(roomId, participantId, "stale-socket", videoId),
      ).toBeNull();

      roomService.markConnected(roomId, participantId, "socket-2");
      expect(roomService.selectVideo(roomId, participantId, socketId, videoId)).toBeNull();

      roomService.markDisconnected(roomId, participantId, "socket-2");
      expect(
        roomService.updatePlayback(roomId, participantId, "socket-2", {
          action: "play",
          videoId,
          positionSeconds: 1,
        }),
      ).toBeNull();
      expect(roomService.getPlayback(roomId)).toMatchObject({
        videoId: null,
        status: "idle",
        revision: 0,
      });
    });

    it("keeps playback isolated by room and removes it with the room", async () => {
      const { roomService, created, advance } = await createPlaybackFixture();
      const second = await roomService.createRoom({ displayName: "Bea" });

      roomService.selectVideo(
        created.room.id,
        created.participant.id,
        socketId,
        videoId,
      );

      expect(roomService.getPlayback(created.room.id)).toMatchObject({
        videoId,
        revision: 1,
      });
      expect(roomService.getPlayback(second.room.id)).toMatchObject({
        videoId: null,
        status: "idle",
        revision: 0,
      });

      advance(60_000);

      expect(roomService.getPlayback(created.room.id)).toBeNull();
      expect(roomService.getPlayback(second.room.id)).toBeNull();
    });
  });
});
