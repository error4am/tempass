import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RoomSocket } from "../src/realtime/socket";

const clockMock = vi.hoisted(() => ({
  requestClockSample: vi.fn(),
}));

vi.mock("../src/realtime/clock", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/realtime/clock")>();

  return {
    ...original,
    requestClockSample: clockMock.requestClockSample,
  };
});

import {
  CLOCK_SAMPLE_BURST_COUNT,
  CLOCK_SAMPLE_BURST_GAP_MS,
  CLOCK_SAMPLE_INTERVAL_MS,
  useServerClock,
} from "../src/realtime/useServerClock";

type Handler = () => void;

function createSocket(connected = true) {
  const handlers = new Map<string, Set<Handler>>();
  const socket = {
    connected,
    on: vi.fn((event: string, handler: Handler) => {
      const eventHandlers = handlers.get(event) ?? new Set<Handler>();
      eventHandlers.add(handler);
      handlers.set(event, eventHandlers);
    }),
    off: vi.fn((event: string, handler: Handler) => {
      handlers.get(event)?.delete(handler);
    }),
  } as unknown as RoomSocket;

  const trigger = (event: string) => {
    for (const handler of [...(handlers.get(event) ?? [])]) {
      handler();
    }
  };

  return { socket, trigger };
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  let sample = 0;
  clockMock.requestClockSample.mockReset();
  clockMock.requestClockSample.mockImplementation(async () => {
    sample += 1;
    const sentAt = sample * 10_000;

    return {
      clientSentAt: sentAt,
      clientReceivedAt: sentAt + 20,
      serverTime: sentAt + 10 + 100,
    };
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useServerClock", () => {
  it("collects an initial burst and refreshed samples on the interval", async () => {
    vi.useFakeTimers();
    const { socket } = createSocket();
    const { result } = renderHook(() => useServerClock("room-1", socket));

    await flushPromises();

    expect(clockMock.requestClockSample).toHaveBeenCalledTimes(1);

    for (let index = 1; index < CLOCK_SAMPLE_BURST_COUNT; index += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(CLOCK_SAMPLE_BURST_GAP_MS);
      });
    }

    expect(clockMock.requestClockSample).toHaveBeenCalledTimes(
      CLOCK_SAMPLE_BURST_COUNT,
    );
    expect(result.current).toMatchObject({
      offsetMs: 100,
      latencyMs: 20,
      sampleCount: CLOCK_SAMPLE_BURST_COUNT,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLOCK_SAMPLE_INTERVAL_MS);
    });
    await flushPromises();

    expect(clockMock.requestClockSample).toHaveBeenCalledTimes(
      CLOCK_SAMPLE_BURST_COUNT * 2,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        CLOCK_SAMPLE_BURST_GAP_MS * (CLOCK_SAMPLE_BURST_COUNT - 1),
      );
    });

    expect(clockMock.requestClockSample).toHaveBeenCalledTimes(
      CLOCK_SAMPLE_BURST_COUNT * 2,
    );
  });

  it("clears the estimate on disconnect and resamples after reconnect", async () => {
    vi.useFakeTimers();
    const { socket, trigger } = createSocket();
    const { result } = renderHook(() => useServerClock("room-1", socket));

    await flushPromises();
    expect(result.current.offsetMs).toBe(100);

    socket.connected = false;
    act(() => {
      trigger("disconnect");
    });
    expect(result.current).toEqual({
      offsetMs: null,
      latencyMs: null,
      sampleCount: 0,
    });

    socket.connected = true;
    act(() => {
      trigger("connect");
    });
    await flushPromises();

    expect(result.current.offsetMs).toBe(100);
  });

  it("does not sample without a socket or with invalid samples", async () => {
    const first = renderHook(() => useServerClock("room-1", null));
    await flushPromises();

    expect(first.result.current.offsetMs).toBeNull();
    expect(clockMock.requestClockSample).not.toHaveBeenCalled();
    first.unmount();

    clockMock.requestClockSample.mockResolvedValue(null);
    const { socket } = createSocket();
    const second = renderHook(() => useServerClock("room-1", socket));
    await flushPromises();

    expect(second.result.current).toEqual({
      offsetMs: null,
      latencyMs: null,
      sampleCount: 0,
    });
  });

  it("resets when the room changes", async () => {
    vi.useFakeTimers();
    const { socket } = createSocket();
    const { result, rerender } = renderHook(
      ({ roomId }: { roomId: string }) => useServerClock(roomId, socket),
      { initialProps: { roomId: "room-1" } },
    );

    await flushPromises();
    for (let index = 1; index < CLOCK_SAMPLE_BURST_COUNT; index += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(CLOCK_SAMPLE_BURST_GAP_MS);
      });
    }
    expect(result.current.offsetMs).toBe(100);
    expect(result.current.sampleCount).toBe(CLOCK_SAMPLE_BURST_COUNT);

    rerender({ roomId: "room-2" });
    await flushPromises();

    expect(clockMock.requestClockSample).toHaveBeenCalledTimes(
      CLOCK_SAMPLE_BURST_COUNT + 1,
    );
    expect(result.current.sampleCount).toBe(1);
    expect(result.current.offsetMs).toBe(100);
  });
});
