// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";

import {
  MAX_PLAYBACK_POSITION_SECONDS,
  playbackCommandAckSchema,
  type LeaveRoomAck,
  type PlaybackCommand,
  type PlaybackCommandAck,
  type PlaybackUpdate,
} from "@tempass/shared";

import { createRoomViaHttp, joinRoomViaHttp } from "./helpers/http";
import type { TestRuntime } from "./helpers/runtime";
import { startTestRuntime } from "./helpers/runtime";
import {
  connectSocket,
  delay,
  sendPlaybackCommand,
  waitForPlaybackState,
} from "./helpers/socket";

const videoId = "dQw4w9WgXcQ";
const otherVideoId = "M7lc1UVf-VE";

let currentRuntime: TestRuntime | undefined;

afterEach(async () => {
  await currentRuntime?.close();
  currentRuntime = undefined;
});

async function setup(options: Parameters<typeof startTestRuntime>[0] = {}) {
  currentRuntime = await startTestRuntime(options);
  return currentRuntime;
}

async function createRoomWithTwoParticipants(test: TestRuntime) {
  const creator = await createRoomViaHttp(test.runtime.app, { displayName: "Alex" });
  const guest = await joinRoomViaHttp(test.runtime.app, creator.room.id, {
    displayName: "Sam",
  });

  const first = await connectSocket(test.url, creator.sessionToken);
  const second = await connectSocket(test.url, guest.sessionToken);

  return { creator, guest, first, second };
}

function expectAccepted(
  ack: PlaybackCommandAck,
): asserts ack is Extract<PlaybackCommandAck, { ok: true }> {
  expect(ack.ok).toBe(true);
}

describe("room playback over Socket.IO", () => {
  it("selects a video and broadcasts the same canonical state to both participants", async () => {
    let now = 1_000_000;
    const test = await setup({ now: () => now });
    const { first, second } = await createRoomWithTwoParticipants(test);

    const firstUpdate = waitForPlaybackState(first.socket);
    const secondUpdate = waitForPlaybackState(second.socket);
    const ack = await sendPlaybackCommand(first.socket, {
      action: "select",
      videoId,
    });

    expectAccepted(ack);
    expect(playbackCommandAckSchema.safeParse(ack).success).toBe(true);

    const [senderUpdate, peerUpdate] = await Promise.all([firstUpdate, secondUpdate]);

    expect(ack.state).toMatchObject({
      videoId,
      status: "paused",
      positionSeconds: 0,
      updatedAt: now,
      revision: 1,
    });
    expect(ack.serverTime).toBe(ack.state.updatedAt);
    expect(senderUpdate).toEqual({ state: ack.state, serverTime: ack.serverTime });
    expect(peerUpdate).toEqual(senderUpdate);
    expect(test.runtime.roomService.getPlayback(first.snapshot.room.id)).toEqual(
      ack.state,
    );
  });

  it("broadcasts play, pause, and seek updates to both participants", async () => {
    let now = 1_000_000;
    const test = await setup({ now: () => now });
    const { first, second } = await createRoomWithTwoParticipants(test);

    const firstSelection = waitForPlaybackState(first.socket);
    const secondSelection = waitForPlaybackState(second.socket);
    expectAccepted(
      await sendPlaybackCommand(first.socket, { action: "select", videoId }),
    );
    await Promise.all([firstSelection, secondSelection]);

    const commands = [
      { action: "play", positionSeconds: 12.5, status: "playing" },
      { action: "seek", positionSeconds: 20, status: "playing" },
      { action: "pause", positionSeconds: 21, status: "paused" },
      { action: "seek", positionSeconds: 30, status: "paused" },
    ] as const;

    for (const [index, command] of commands.entries()) {
      now += 500;
      const firstUpdate = waitForPlaybackState(first.socket);
      const secondUpdate = waitForPlaybackState(second.socket);
      const ack = await sendPlaybackCommand(first.socket, {
        action: command.action,
        videoId,
        positionSeconds: command.positionSeconds,
      });

      expectAccepted(ack);
      const [senderUpdate, peerUpdate] = await Promise.all([firstUpdate, secondUpdate]);

      expect(ack.state).toMatchObject({
        videoId,
        status: command.status,
        positionSeconds: command.positionSeconds,
        updatedAt: now,
        revision: index + 2,
      });
      expect(senderUpdate).toEqual({ state: ack.state, serverTime: ack.serverTime });
      expect(peerUpdate).toEqual(senderUpdate);
    }
  });

  it("rejects invalid payloads without mutating or broadcasting playback", async () => {
    const test = await setup();
    const { first, second } = await createRoomWithTwoParticipants(test);
    const received: PlaybackUpdate[] = [];
    second.socket.on("playback:state", (update) => received.push(update));

    const invalidPayloads: unknown[] = [
      { action: "select", videoId: "too-short" },
      { action: "select" },
      { action: "select", videoId: otherVideoId, positionSeconds: 0 },
      { action: "select", videoId, updatedAt: 1_000 },
      { action: "select", videoId, revision: 99 },
      { action: "play", videoId, positionSeconds: -1 },
      { action: "play", videoId, positionSeconds: MAX_PLAYBACK_POSITION_SECONDS + 1 },
      { action: "play", videoId },
      { action: "pause", videoId, positionSeconds: 0, revision: 5 },
      { action: "seek", videoId, positionSeconds: 0, serverTime: 1 },
      { action: "unknown", videoId, positionSeconds: 0 },
      "not-an-object",
      null,
    ];

    for (const payload of invalidPayloads) {
      const ack = await sendPlaybackCommand(first.socket, payload);

      expect(ack).toEqual({ ok: false, code: "INVALID_INPUT" });
      expect(playbackCommandAckSchema.safeParse(ack).success).toBe(true);
    }

    await delay(150);

    expect(received).toHaveLength(0);
    expect(test.runtime.roomService.getPlayback(first.snapshot.room.id)).toMatchObject({
      videoId: null,
      status: "idle",
      positionSeconds: 0,
      revision: 0,
    });
  });

  it("rejects a stale video command without broadcasting or incrementing the revision", async () => {
    const test = await setup();
    const { first, second } = await createRoomWithTwoParticipants(test);

    const selectedUpdate = waitForPlaybackState(second.socket);
    expectAccepted(
      await sendPlaybackCommand(first.socket, { action: "select", videoId }),
    );
    await selectedUpdate;

    const selected = test.runtime.roomService.getPlayback(first.snapshot.room.id);
    const received: PlaybackUpdate[] = [];
    second.socket.on("playback:state", (update) => received.push(update));

    const ack = await sendPlaybackCommand(first.socket, {
      action: "play",
      videoId: otherVideoId,
      positionSeconds: 10,
    });

    expect(ack).toEqual({ ok: false, code: "VIDEO_MISMATCH" });
    expect(playbackCommandAckSchema.safeParse(ack).success).toBe(true);

    await delay(150);

    expect(received).toHaveLength(0);
    expect(test.runtime.roomService.getPlayback(first.snapshot.room.id)).toEqual(
      selected,
    );
    expect(selected?.revision).toBe(1);
  });

  it("rejects playback commands from left, removed, or stale sockets", async () => {
    const test = await setup();
    const { first, second } = await createRoomWithTwoParticipants(test);

    const leaveAck = await new Promise<LeaveRoomAck>((resolve) => {
      second.socket.emit("room:leave", {}, resolve);
    });
    expect(leaveAck).toEqual({ ok: true });

    const leftAck = await sendPlaybackCommand(second.socket, {
      action: "select",
      videoId,
    });
    expect(leftAck).toEqual({ ok: false, code: "UNAUTHORIZED" });

    expect(
      test.runtime.roomService.markConnected(
        first.snapshot.room.id,
        first.snapshot.self.id,
        "replacement-socket",
      ),
    ).not.toBeNull();

    const staleAck = await sendPlaybackCommand(first.socket, {
      action: "select",
      videoId,
    });
    expect(staleAck).toEqual({ ok: false, code: "UNAUTHORIZED" });

    expect(test.runtime.roomService.getPlayback(first.snapshot.room.id)).toMatchObject({
      videoId: null,
      status: "idle",
      revision: 0,
    });
  });

  it("does not leak playback updates into another room", async () => {
    const test = await setup();
    const { first, second } = await createRoomWithTwoParticipants(test);
    const otherRoom = await createRoomViaHttp(test.runtime.app, {
      displayName: "Bea",
    });
    const other = await connectSocket(test.url, otherRoom.sessionToken);
    const leakedUpdates: PlaybackUpdate[] = [];
    other.socket.on("playback:state", (update) => leakedUpdates.push(update));

    const firstUpdate = waitForPlaybackState(first.socket);
    const secondUpdate = waitForPlaybackState(second.socket);
    const ack = await sendPlaybackCommand(first.socket, {
      action: "select",
      videoId,
    });
    expectAccepted(ack);

    await Promise.all([firstUpdate, secondUpdate]);
    await delay(150);

    expect(leakedUpdates).toHaveLength(0);
    expect(other.snapshot.playback).toMatchObject({
      videoId: null,
      status: "idle",
      revision: 0,
    });
    expect(test.runtime.roomService.getPlayback(otherRoom.room.id)).toMatchObject({
      videoId: null,
      status: "idle",
      revision: 0,
    });
  });

  it("includes the latest playback state in a late joiner's snapshot", async () => {
    let now = 1_000_000;
    const test = await setup({ now: () => now });
    const creator = await createRoomViaHttp(test.runtime.app, { displayName: "Alex" });
    const first = await connectSocket(test.url, creator.sessionToken);

    expectAccepted(
      await sendPlaybackCommand(first.socket, { action: "select", videoId }),
    );

    now += 1_000;
    expectAccepted(
      await sendPlaybackCommand(first.socket, {
        action: "play",
        videoId,
        positionSeconds: 42,
      }),
    );

    const latest = test.runtime.roomService.getPlayback(creator.room.id);
    const guest = await joinRoomViaHttp(test.runtime.app, creator.room.id, {
      displayName: "Sam",
    });
    const second = await connectSocket(test.url, guest.sessionToken);

    expect(latest).toMatchObject({
      videoId,
      status: "playing",
      positionSeconds: 42,
      updatedAt: 1_001_000,
      revision: 2,
    });
    expect(second.snapshot.playback).toEqual(latest);
  });
});

describe("playback command rate limiting", () => {
  afterEach(async () => {
    await currentRuntime?.close();
    currentRuntime = undefined;
  });

  async function createRoomWithTwoParticipants(test: TestRuntime) {
    const creator = await createRoomViaHttp(test.runtime.app, {
      displayName: "Alex",
    });
    const guest = await joinRoomViaHttp(test.runtime.app, creator.room.id, {
      displayName: "Sam",
    });
    const first = await connectSocket(test.url, creator.sessionToken);
    const second = await connectSocket(test.url, guest.sessionToken);

    return { creator, guest, first, second };
  }

  it("accepts playback commands below the per-socket limit", async () => {
    const test = await setup({
      playbackRateLimitMaxCommands: 6,
      playbackRateLimitWindowMs: 10_000,
    });
    const { first } = await createRoomWithTwoParticipants(test);

    const commands: PlaybackCommand[] = [
      { action: "select", videoId },
      { action: "play", videoId, positionSeconds: 1 },
      { action: "pause", videoId, positionSeconds: 1 },
      { action: "seek", videoId, positionSeconds: 2 },
      { action: "play", videoId, positionSeconds: 2 },
      { action: "pause", videoId, positionSeconds: 2 },
    ];

    for (const command of commands) {
      const ack = await sendPlaybackCommand(first.socket, command);
      expect(ack.ok).toBe(true);
    }
  });

  it("rejects excess playback commands with RATE_LIMITED without mutating or broadcasting", async () => {
    const test = await setup({
      playbackRateLimitMaxCommands: 3,
      playbackRateLimitWindowMs: 10_000,
    });
    const { first, second } = await createRoomWithTwoParticipants(test);

    const firstSelection = waitForPlaybackState(first.socket);
    const secondSelection = waitForPlaybackState(second.socket);
    expectAccepted(await sendPlaybackCommand(first.socket, {
      action: "select",
      videoId,
    }));
    await Promise.all([firstSelection, secondSelection]);

    expectAccepted(await sendPlaybackCommand(first.socket, {
      action: "play",
      videoId,
      positionSeconds: 5,
    }));
    expectAccepted(await sendPlaybackCommand(first.socket, {
      action: "pause",
      videoId,
      positionSeconds: 5,
    }));
    await waitForPlaybackState(second.socket);

    const peerUpdates: PlaybackUpdate[] = [];
    second.socket.on("playback:state", (update) => peerUpdates.push(update));

    const limited = await sendPlaybackCommand(first.socket, {
      action: "seek",
      videoId,
      positionSeconds: 9,
    });
    expect(limited).toEqual({ ok: false, code: "RATE_LIMITED" });

    expect(test.runtime.roomService.getPlayback(first.snapshot.room.id)).toMatchObject({
      videoId,
      status: "paused",
      positionSeconds: 5,
      revision: 3,
    });

    await delay(150);
    expect(peerUpdates).toHaveLength(0);
  });

  it("permits commands again after the rate-limit window expires", async () => {
    const test = await setup({
      playbackRateLimitMaxCommands: 2,
      playbackRateLimitWindowMs: 150,
    });
    const { first } = await createRoomWithTwoParticipants(test);

    expectAccepted(await sendPlaybackCommand(first.socket, {
      action: "select",
      videoId,
    }));
    expectAccepted(await sendPlaybackCommand(first.socket, {
      action: "play",
      videoId,
      positionSeconds: 1,
    }));

    const limited = await sendPlaybackCommand(first.socket, {
      action: "pause",
      videoId,
      positionSeconds: 1,
    });
    expect(limited).toEqual({ ok: false, code: "RATE_LIMITED" });

    await delay(200);

    expectAccepted(await sendPlaybackCommand(first.socket, {
      action: "seek",
      videoId,
      positionSeconds: 3,
    }));
  });

  it("gives each connected session an independent rate-limit allowance", async () => {
    const test = await setup({
      playbackRateLimitMaxCommands: 2,
      playbackRateLimitWindowMs: 10_000,
    });
    const { first, second } = await createRoomWithTwoParticipants(test);

    expectAccepted(await sendPlaybackCommand(first.socket, {
      action: "select",
      videoId,
    }));
    expectAccepted(await sendPlaybackCommand(first.socket, {
      action: "play",
      videoId,
      positionSeconds: 1,
    }));
    const firstLimited = await sendPlaybackCommand(first.socket, {
      action: "pause",
      videoId,
      positionSeconds: 1,
    });
    expect(firstLimited).toEqual({ ok: false, code: "RATE_LIMITED" });

    const secondAck = await sendPlaybackCommand(second.socket, {
      action: "select",
      videoId,
    });
    expect(secondAck.ok).toBe(true);
    expect(test.runtime.roomService.getPlayback(first.snapshot.room.id)).toMatchObject({
      videoId,
      status: "paused",
      positionSeconds: 0,
      revision: 3,
    });
  });

  it("rejects commands from a stale socket with UNAUTHORIZED before rate limiting", async () => {
    const test = await setup({
      playbackRateLimitMaxCommands: 1,
      playbackRateLimitWindowMs: 10_000,
    });
    const { first, second } = await createRoomWithTwoParticipants(test);

    const leaveAck = await new Promise<LeaveRoomAck>((resolve) => {
      second.socket.emit("room:leave", {}, resolve);
    });
    expect(leaveAck).toEqual({ ok: true });

    const staleAck = await sendPlaybackCommand(second.socket, {
      action: "select",
      videoId,
    });
    expect(staleAck).toEqual({ ok: false, code: "UNAUTHORIZED" });

    expect(test.runtime.roomService.getPlayback(first.snapshot.room.id)).toMatchObject({
      videoId: null,
      status: "idle",
      revision: 0,
    });
  });
});
