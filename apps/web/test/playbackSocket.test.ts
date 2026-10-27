import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SOCKET_EVENTS,
  type PlaybackCommand,
  type PlaybackCommandAck,
} from "@tempass/shared";

import {
  PLAYBACK_COMMAND_TIMEOUT_MS,
  sendPlaybackCommand,
} from "../src/realtime/playback";
import type { RoomSocket } from "../src/realtime/socket";

const VIDEO_ID = "dQw4w9WgXcQ";

const ACCEPTED: PlaybackCommandAck = {
  ok: true,
  state: {
    videoId: VIDEO_ID,
    status: "paused",
    positionSeconds: 0,
    updatedAt: 1_000_000,
    revision: 1,
  },
  serverTime: 1_000_000,
};

afterEach(() => {
  vi.useRealTimers();
});

function createSocket(
  connected: boolean,
  emit: (
    event: string,
    payload: unknown,
    ack: (response: unknown) => void,
  ) => void,
): RoomSocket {
  return {
    connected,
    emit,
  } as unknown as RoomSocket;
}

describe("sendPlaybackCommand", () => {
  it("sends the typed command and surfaces the accepted state", async () => {
    const emit = vi.fn(
      (
        _event: string,
        _payload: unknown,
        ack: (response: unknown) => void,
      ) => {
        ack(ACCEPTED);
      },
    );
    const onAccepted = vi.fn();
    const result = await sendPlaybackCommand(
      createSocket(true, emit),
      { action: "select", videoId: VIDEO_ID },
      { onAccepted },
    );

    expect(result).toEqual(ACCEPTED);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0]?.[0]).toBe(SOCKET_EVENTS.PLAYBACK_COMMAND);
    expect(emit.mock.calls[0]?.[1]).toEqual({
      action: "select",
      videoId: VIDEO_ID,
    });
    expect(onAccepted).toHaveBeenCalledWith({
      state: ACCEPTED.state,
      serverTime: ACCEPTED.serverTime,
    });
  });

  it("rejects invalid commands without emitting", async () => {
    const emit = vi.fn();
    const result = await sendPlaybackCommand(
      createSocket(true, emit),
      { action: "select", videoId: "short" } as unknown as PlaybackCommand,
    );

    expect(result).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(emit).not.toHaveBeenCalled();
  });

  it("reports connection failures without emitting", async () => {
    const emit = vi.fn();
    const command: PlaybackCommand = { action: "select", videoId: VIDEO_ID };

    await expect(
      sendPlaybackCommand(createSocket(false, emit), command),
    ).resolves.toEqual({ ok: false, code: "UNAUTHORIZED" });
    await expect(sendPlaybackCommand(null, command)).resolves.toEqual({
      ok: false,
      code: "UNAUTHORIZED",
    });
    expect(emit).not.toHaveBeenCalled();
  });

  it("surfaces structured server failures without marking them accepted", async () => {
    const onAccepted = vi.fn();
    const result = await sendPlaybackCommand(
      createSocket(true, (_event, _payload, ack) => {
        ack({ ok: false, code: "VIDEO_MISMATCH" });
      }),
      { action: "play", videoId: VIDEO_ID, positionSeconds: 12 },
      { onAccepted },
    );

    expect(result).toEqual({ ok: false, code: "VIDEO_MISMATCH" });
    expect(onAccepted).not.toHaveBeenCalled();
  });

  it("normalizes malformed acknowledgements to an internal error", async () => {
    const result = await sendPlaybackCommand(
      createSocket(true, (_event, _payload, ack) => {
        ack({ ok: false, code: "NOT_A_REAL_CODE" });
      }),
      { action: "select", videoId: VIDEO_ID },
    );

    expect(result).toEqual({ ok: false, code: "INTERNAL" });
  });

  it("times out commands that never receive an acknowledgement", async () => {
    vi.useFakeTimers();
    const promise = sendPlaybackCommand(
      createSocket(true, vi.fn()),
      { action: "select", videoId: VIDEO_ID },
    );

    await vi.advanceTimersByTimeAsync(PLAYBACK_COMMAND_TIMEOUT_MS);

    await expect(promise).resolves.toEqual({ ok: false, code: "INTERNAL" });
  });
});
