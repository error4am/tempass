// @vitest-environment node
import { io as createSocketClient } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";

import type { TabShareState } from "@tempass/shared";

import { createRoomViaHttp, joinRoomViaHttp } from "./helpers/http";
import type { TestRuntime } from "./helpers/runtime";
import { startTestRuntime } from "./helpers/runtime";
import {
  connectSocket,
  delay,
  sendShareStart,
  sendShareStop,
  waitForShareState,
} from "./helpers/socket";

let currentRuntime: TestRuntime | undefined;

afterEach(async () => {
  await currentRuntime?.close();
  currentRuntime = undefined;
});

async function setup() {
  currentRuntime = await startTestRuntime();
  return currentRuntime;
}

async function twoParticipants() {
  const test = await setup();
  const creator = await createRoomViaHttp(test.runtime.app, { displayName: "Alex" });
  const joined = await joinRoomViaHttp(test.runtime.app, creator.room.id, {
    displayName: "Sam",
  });

  const first = await connectSocket(test.url, creator.sessionToken);
  const second = await connectSocket(test.url, joined.sessionToken);

  return { test, creator, joined, first, second };
}

describe("live tab sharing over Socket.IO", () => {
  it("announces the presenter to the other participant", async () => {
    const { creator, first, second } = await twoParticipants();

    const announced = waitForShareState(second.socket, (state) => state !== null);
    const ack = await sendShareStart(first.socket, { surface: "browser" });

    expect(ack.ok).toBe(true);
    const state = await announced;

    expect(state).toMatchObject({
      presenterId: creator.participant.id,
      presenterName: "Alex",
      surface: "browser",
    });
    expect(state?.startedAt).toBeGreaterThan(0);
  });

  it("rejects a competing presenter", async () => {
    const { first, second } = await twoParticipants();

    await sendShareStart(first.socket, { surface: "browser" });
    const ack = await sendShareStart(second.socket, { surface: "browser" });

    expect(ack).toEqual({ ok: false, code: "SHARE_BUSY" });
  });

  it("clears the announcement when the presenter stops", async () => {
    const { first, second } = await twoParticipants();

    await sendShareStart(first.socket, { surface: "browser" });

    const cleared = waitForShareState(second.socket, (state) => state === null);
    const ack = await sendShareStop(first.socket);

    expect(ack).toEqual({ ok: true, state: null });
    await expect(cleared).resolves.toBeNull();
  });

  it("clears the announcement when the presenter disconnects", async () => {
    const { first, second } = await twoParticipants();

    await sendShareStart(first.socket, { surface: "browser" });

    const cleared = waitForShareState(second.socket, (state) => state === null);
    first.socket.disconnect();

    await expect(cleared).resolves.toBeNull();
  });

  it("does not let the viewer stop someone else's share", async () => {
    const { first, second } = await twoParticipants();

    await sendShareStart(first.socket, { surface: "browser" });
    const ack = await sendShareStop(second.socket);

    expect(ack).toEqual({ ok: false, code: "UNAUTHORIZED" });

    const refreshed = await sendShareStart(first.socket, { surface: "window" });
    expect(refreshed).toMatchObject({ ok: true, state: { surface: "window" } });
  });

  it("shows an existing share to someone who joins later", async () => {
    const test = await setup();
    const creator = await createRoomViaHttp(test.runtime.app, {
      displayName: "Alex",
    });
    const first = await connectSocket(test.url, creator.sessionToken);

    await sendShareStart(first.socket, { surface: "browser" });

    const joined = await joinRoomViaHttp(test.runtime.app, creator.room.id, {
      displayName: "Bea",
    });
    const late = createSocketClient(test.url, {
      auth: { token: joined.sessionToken },
      transports: ["websocket"],
      reconnection: false,
    });
    const states: Array<TabShareState | null> = [];

    late.on("share:state", (state) => {
      states.push(state);
    });

    await new Promise<void>((resolve) => {
      late.on("room:snapshot", () => resolve());
    });
    await delay(50);

    expect(states[0]).toMatchObject({
      presenterId: creator.participant.id,
      presenterName: "Alex",
    });

    late.disconnect();
  });

  it("rejects malformed share payloads", async () => {
    const { first } = await twoParticipants();

    const ack = await sendShareStart(first.socket, { surface: "screen" });

    expect(ack).toEqual({ ok: false, code: "INVALID_INPUT" });
  });

  it("tells participants about each other so they can signal", async () => {
    const { first, second } = await twoParticipants();

    const peers = await new Promise<{ peers: Array<{ socketId: string }> }>(
      (resolve) => {
        const handler = (payload: { peers: Array<{ socketId: string }> }) => {
          if (payload.peers.length !== 1) {
            return;
          }

          first.socket.off("room:peers", handler);
          resolve(payload);
        };

        first.socket.on("room:peers", handler);
        second.socket.disconnect();
      },
    );

    expect(peers.peers).toHaveLength(1);
    expect(peers.peers[0]?.socketId).toBeTruthy();
  });
});
