// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";

import {
  clockSyncAckSchema,
  type ClockSyncAck,
} from "@tempass/shared";

import { createRoomViaHttp } from "./helpers/http";
import type { TestRuntime } from "./helpers/runtime";
import { startTestRuntime } from "./helpers/runtime";
import { connectSocket, sendClockSync } from "./helpers/socket";

let currentRuntime: TestRuntime | undefined;

afterEach(async () => {
  await currentRuntime?.close();
  currentRuntime = undefined;
});

async function setup(options: Parameters<typeof startTestRuntime>[0] = {}) {
  currentRuntime = await startTestRuntime(options);
  return currentRuntime;
}

describe("clock synchronization over Socket.IO", () => {
  it("echoes the client timestamp with the server's current time", async () => {
    let now = 1_000_000;
    const test = await setup({ now: () => now });
    const creator = await createRoomViaHttp(test.runtime.app, {
      displayName: "Alex",
    });
    const connected = await connectSocket(test.url, creator.sessionToken);

    const ack = await sendClockSync(connected.socket, {
      clientTime: 250_000,
    });

    expect(ack).toEqual({
      ok: true,
      clientTime: 250_000,
      serverTime: 1_000_000,
    });
    expect(clockSyncAckSchema.safeParse(ack).success).toBe(true);

    now += 2_500;
    await expect(
      sendClockSync(connected.socket, { clientTime: 252_000 }),
    ).resolves.toEqual({
      ok: true,
      clientTime: 252_000,
      serverTime: 1_002_500,
    });

    connected.socket.disconnect();
  });

  it("rejects malformed requests without changing server state", async () => {
    const test = await setup({ now: () => 1_000_000 });
    const creator = await createRoomViaHttp(test.runtime.app, {
      displayName: "Alex",
    });
    const connected = await connectSocket(test.url, creator.sessionToken);
    const invalidPayloads: unknown[] = [
      {},
      { clientTime: -1 },
      { clientTime: 1.5 },
      { clientTime: Number.NaN },
      { clientTime: 1_000, serverTime: 2_000 },
      { clientTime: "1000" },
      null,
    ];

    for (const payload of invalidPayloads) {
      const ack = await sendClockSync(connected.socket, payload);

      expect(ack).toEqual({ ok: false, code: "INVALID_INPUT" });
      expect(clockSyncAckSchema.safeParse(ack).success).toBe(true);
    }

    connected.socket.disconnect();
  });

  it("rejects clock requests from stale sockets", async () => {
    const test = await setup({ now: () => 1_000_000 });
    const creator = await createRoomViaHttp(test.runtime.app, {
      displayName: "Alex",
    });
    const connected = await connectSocket(test.url, creator.sessionToken);

    expect(
      test.runtime.roomService.markConnected(
        creator.room.id,
        connected.snapshot.self.id,
        "replacement-socket",
      ),
    ).not.toBeNull();

    const ack: ClockSyncAck = await sendClockSync(connected.socket, {
      clientTime: 250_000,
    });

    expect(ack).toEqual({ ok: false, code: "UNAUTHORIZED" });
    connected.socket.disconnect();
  });
});
