// @vitest-environment node
import request from "supertest";
import { io as createSocketClient } from "socket.io-client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LeaveRoomAck } from "@tempass/shared";

import { createRoomViaHttp, joinRoomViaHttp } from "./helpers/http";
import type { TestRuntime } from "./helpers/runtime";
import { startTestRuntime } from "./helpers/runtime";
import {
  connectSocket,
  delay,
  waitForDisconnect,
  waitForPresence,
} from "./helpers/socket";

let currentRuntime: TestRuntime | undefined;

afterEach(async () => {
  await currentRuntime?.close();
  currentRuntime = undefined;
});

async function setup(options: Parameters<typeof startTestRuntime>[0] = {}) {
  currentRuntime = await startTestRuntime(options);
  return currentRuntime;
}

describe("room presence over Socket.IO", () => {
  it("returns a snapshot with the connected participant", async () => {
    const test = await setup();
    const creator = await createRoomViaHttp(test.runtime.app, { displayName: "Alex" });

    const { socket, snapshot } = await connectSocket(test.url, creator.sessionToken);

    expect(snapshot.room.id).toBe(creator.room.id);
    expect(snapshot.self.id).toBe(creator.participant.id);
    expect(snapshot.participants).toHaveLength(1);
    expect(snapshot.participants[0]).toMatchObject({
      id: creator.participant.id,
      displayName: "Alex",
      connected: true,
    });

    socket.disconnect();
  });

  it("notifies existing participants when someone joins", async () => {
    const test = await setup();
    const creator = await createRoomViaHttp(test.runtime.app, { displayName: "Alex" });
    const first = await connectSocket(test.url, creator.sessionToken);

    const joined = await joinRoomViaHttp(test.runtime.app, creator.room.id, {
      displayName: "Sam",
    });
    const joinedPresence = waitForPresence(
      first.socket,
      (update) => update.participants.length === 2,
    );

    const second = await connectSocket(test.url, joined.sessionToken);
    const update = await joinedPresence;

    expect(second.snapshot.participants).toHaveLength(2);
    expect(update.participants.map((participant) => participant.id)).toEqual(
      expect.arrayContaining([creator.participant.id, joined.participant.id]),
    );
  });

  it("notifies remaining participants when someone leaves", async () => {
    const test = await setup();
    const creator = await createRoomViaHttp(test.runtime.app, { displayName: "Alex" });
    const joined = await joinRoomViaHttp(test.runtime.app, creator.room.id, {
      displayName: "Sam",
    });

    const first = await connectSocket(test.url, creator.sessionToken);
    const second = await connectSocket(test.url, joined.sessionToken);

    const leftPresence = waitForPresence(
      first.socket,
      (update) => update.participants.length === 1,
    );

    const ack = await new Promise<LeaveRoomAck>((resolve) => {
      second.socket.emit("room:leave", {}, resolve);
    });

    expect(ack).toEqual({ ok: true });
    const update = await leftPresence;
    expect(update.participants[0]?.id).toBe(creator.participant.id);

    const meta = await request(test.runtime.app)
      .get(`/api/rooms/${creator.room.id}`)
      .expect(200);
    expect(meta.body.participantCount).toBe(1);
  });

  it("marks an abrupt disconnect and later removes the participant", async () => {
    let now = 1_000_000;
    const test = await setup({ now: () => now, reconnectGraceMs: 80 });
    const creator = await createRoomViaHttp(test.runtime.app, { displayName: "Alex" });
    const joined = await joinRoomViaHttp(test.runtime.app, creator.room.id, {
      displayName: "Sam",
    });

    const first = await connectSocket(test.url, creator.sessionToken);
    const second = await connectSocket(test.url, joined.sessionToken);

    const disconnected = waitForPresence(first.socket, (update) =>
      update.participants.some(
        (participant) => participant.id === joined.participant.id && !participant.connected,
      ),
    );

    second.socket.disconnect();
    const disconnectedUpdate = await disconnected;
    expect(
      disconnectedUpdate.participants.find(
        (participant) => participant.id === joined.participant.id,
      )?.connected,
    ).toBe(false);

    const removed = waitForPresence(
      first.socket,
      (update) => update.participants.length === 1,
    );

    now += 100;
    test.runtime.sweep();
    const removedUpdate = await removed;

    expect(removedUpdate.participants.map((participant) => participant.id)).toEqual([
      creator.participant.id,
    ]);
  });

  it("deletes an empty room after the documented cleanup window", async () => {
    let now = 2_000_000;
    const test = await setup({
      now: () => now,
      reconnectGraceMs: 80,
      emptyRoomTtlMs: 150,
    });
    const creator = await createRoomViaHttp(test.runtime.app, { displayName: "Alex" });

    const { socket } = await connectSocket(test.url, creator.sessionToken);
    socket.disconnect();

    await vi.waitFor(() => {
      expect(
        test.runtime.roomService.getPresence(creator.room.id)?.participants[0]?.connected,
      ).toBe(false);
    });

    now += 80;
    test.runtime.sweep();
    expect(test.runtime.roomService.getPublicRoom(creator.room.id)?.participantCount).toBe(0);

    now += 150;
    test.runtime.sweep();
    expect(test.runtime.roomService.getPublicRoom(creator.room.id)).toBeNull();

    await request(test.runtime.app)
      .get(`/api/rooms/${creator.room.id}`)
      .expect(404);
  });

  it("prevents duplicate participants when the same token reconnects", async () => {
    const test = await setup();
    const creator = await createRoomViaHttp(test.runtime.app, { displayName: "Alex" });

    const first = await connectSocket(test.url, creator.sessionToken);
    const firstDisconnected = waitForDisconnect(first.socket);
    const second = await connectSocket(test.url, creator.sessionToken);

    await firstDisconnected;

    expect(second.snapshot.self.id).toBe(creator.participant.id);
    expect(second.snapshot.participants).toHaveLength(1);

    const joined = await joinRoomViaHttp(test.runtime.app, creator.room.id, {
      displayName: "Sam",
    });
    const third = await connectSocket(test.url, joined.sessionToken);

    expect(third.snapshot.participants).toHaveLength(2);
    expect(
      third.snapshot.participants.filter(
        (participant) => participant.id === creator.participant.id,
      ),
    ).toHaveLength(1);
  });

  it("rejects unauthorized socket connections", async () => {
    const test = await setup();

    await expect(connectSocket(test.url, "A".repeat(43))).rejects.toMatchObject({
      data: { code: "UNAUTHORIZED" },
    });
  });

  it("rejects malformed socket auth payloads", async () => {
    const test = await setup();
    const socket = createSocketClient(test.url, {
      auth: { token: 123 } as unknown as Record<string, string>,
      transports: ["websocket"],
      reconnection: false,
    });

    const error = await new Promise<Error>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("Timed out waiting for connect_error"));
      }, 2_000);

      socket.on("connect_error", (connectError: Error) => {
        clearTimeout(timer);
        resolve(connectError);
      });
      socket.on("connect", () => {
        clearTimeout(timer);
        reject(new Error("Socket unexpectedly connected"));
      });
    });

    expect((error as Error & { data?: { code?: string } }).data?.code).toBe("UNAUTHORIZED");
    socket.disconnect();
  });

  it("cannot use client-supplied identifiers to modify another room", async () => {
    const test = await setup();
    const firstRoom = await createRoomViaHttp(test.runtime.app, { displayName: "Alex" });
    const secondRoom = await createRoomViaHttp(test.runtime.app, { displayName: "Bea" });
    const firstRoomGuest = await joinRoomViaHttp(test.runtime.app, firstRoom.room.id, {
      displayName: "Sam",
    });

    const first = await connectSocket(test.url, firstRoom.sessionToken);
    await connectSocket(test.url, firstRoomGuest.sessionToken);
    await connectSocket(test.url, secondRoom.sessionToken);

    const ack = await new Promise<LeaveRoomAck>((resolve) => {
      first.socket.emit(
        "room:leave",
        {
          participantId: secondRoom.participant.id,
          roomId: secondRoom.room.id,
        },
        resolve,
      );
    });

    expect(ack).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(test.runtime.roomService.getPresence(firstRoom.room.id)?.participants).toHaveLength(2);
    expect(
      test.runtime.roomService.getPresence(secondRoom.room.id)?.participants,
    ).toHaveLength(1);
  });

  it("rejects invalid leave payloads without removing the participant", async () => {
    const test = await setup();
    const creator = await createRoomViaHttp(test.runtime.app, { displayName: "Alex" });
    const joined = await joinRoomViaHttp(test.runtime.app, creator.room.id, {
      displayName: "Sam",
    });

    await connectSocket(test.url, creator.sessionToken);
    const second = await connectSocket(test.url, joined.sessionToken);

    const ack = await new Promise<LeaveRoomAck>((resolve) => {
      second.socket.emit("room:leave", "not-an-object", resolve);
    });

    expect(ack).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(test.runtime.roomService.getPresence(creator.room.id)?.participants).toHaveLength(2);
  });

  it("keeps rooms isolated from each other", async () => {
    const test = await setup();
    const firstRoom = await createRoomViaHttp(test.runtime.app, { displayName: "Alex" });
    const secondRoom = await createRoomViaHttp(test.runtime.app, { displayName: "Bea" });

    const first = await connectSocket(test.url, firstRoom.sessionToken);
    const second = await connectSocket(test.url, secondRoom.sessionToken);

    await delay(100);
    let secondRoomPresenceUpdates = 0;
    second.socket.on("presence:update", () => {
      secondRoomPresenceUpdates += 1;
    });

    const joined = await joinRoomViaHttp(test.runtime.app, firstRoom.room.id, {
      displayName: "Sam",
    });
    const firstRoomPresence = waitForPresence(
      first.socket,
      (update) => update.participants.length === 2,
    );
    await connectSocket(test.url, joined.sessionToken);

    await firstRoomPresence;
    await delay(150);

    expect(secondRoomPresenceUpdates).toBe(0);
    expect(
      test.runtime.roomService.getPresence(secondRoom.room.id)?.participants.map(
        (participant) => participant.id,
      ),
    ).toEqual([secondRoom.participant.id]);
  });
});
