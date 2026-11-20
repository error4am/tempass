// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";

import type { BridgeState } from "@tempass/shared";

import { createRoomViaHttp, joinRoomViaHttp } from "./helpers/http";
import type { TestRuntime } from "./helpers/runtime";
import { startTestRuntime } from "./helpers/runtime";
import {
  connectBridge,
  connectSocket,
  delay,
  waitForBridgeState,
} from "./helpers/socket";

let currentRuntime: TestRuntime | undefined;

afterEach(async () => {
  await currentRuntime?.close();
  currentRuntime = undefined;
});

function report(overrides: Partial<BridgeState> = {}) {
  return {
    source: { url: "https://source.test/watch", title: "Episode 29" },
    status: "playing" as const,
    positionSeconds: 10,
    durationSeconds: 2_378,
    ...overrides,
  };
}

describe("source companion bridge", () => {
  it("keeps a single authoritative bridge in the room", async () => {
    currentRuntime = await startTestRuntime();
    const test = currentRuntime;

    const creator = await createRoomViaHttp(test.runtime.app, {
      displayName: "Alex",
    });
    const joined = await joinRoomViaHttp(test.runtime.app, creator.room.id, {
      displayName: "Sam",
    });

    const viewer = await connectSocket(test.url, creator.sessionToken);
    const states: Array<BridgeState | null> = [];
    viewer.socket.on("bridge:state", (state) => {
      states.push(state);
    });

    const bridgeA = await connectBridge(test.url, creator.sessionToken);
    const bridgeB = await connectBridge(test.url, joined.sessionToken);

    bridgeA.emit("bridge:state", report());
    await delay(120);

    // The second companion must not overwrite the room's state.
    bridgeB.emit("bridge:state", report({ status: "paused", positionSeconds: 99 }));
    await delay(150);

    expect(states.filter((state) => state !== null)).toHaveLength(1);
    expect(states.at(-1)).toMatchObject({
      status: "playing",
      positionSeconds: 10,
    });

    // When the owner leaves, the surviving companion takes over.
    bridgeA.disconnect();
    await delay(80);

    const promoted = waitForBridgeState(
      viewer.socket,
      (state) => state?.positionSeconds === 99,
    );
    bridgeB.emit("bridge:state", report({ status: "paused", positionSeconds: 99 }));
    await promoted;

    // The last bridge leaving clears the room.
    const cleared = waitForBridgeState(viewer.socket, (state) => state === null);
    bridgeB.disconnect();
    await cleared;
  });

  it("does not count a bridge as a participant", async () => {
    currentRuntime = await startTestRuntime();
    const test = currentRuntime;

    const creator = await createRoomViaHttp(test.runtime.app, {
      displayName: "Alex",
    });

    const viewer = await connectSocket(test.url, creator.sessionToken);
    const bridge = await connectBridge(test.url, creator.sessionToken);
    const state = waitForBridgeState(viewer.socket, (value) => value !== null);

    bridge.emit("bridge:state", report());
    await state;

    expect(
      test.runtime.roomService.getPresence(creator.room.id)?.participants,
    ).toHaveLength(1);
  });
});
