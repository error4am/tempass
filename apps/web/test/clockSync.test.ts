import { afterEach, describe, expect, it, vi } from "vitest";

import { SOCKET_EVENTS } from "@tempass/shared";

import {
  ClockOffsetEstimator,
  clientTimeToServerTime,
  normalizeClockSyncSample,
} from "../src/lib/clockSync";
import {
  CLOCK_SYNC_TIMEOUT_MS,
  requestClockSample,
} from "../src/realtime/clock";
import type { RoomSocket } from "../src/realtime/socket";

function sample(
  clientSentAt: number,
  clientReceivedAt: number,
  serverTime: number,
) {
  return { clientSentAt, clientReceivedAt, serverTime };
}

function createSocket(
  connected: boolean,
  emit: (
    event: string,
    payload: unknown,
    ack: (response: unknown) => void,
  ) => void = vi.fn(),
): RoomSocket {
  return {
    connected,
    emit,
  } as unknown as RoomSocket;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("clock offset estimation", () => {
  it("uses midpoint latency and keeps the documented server-minus-client sign", () => {
    const positive = normalizeClockSyncSample(sample(1_000, 1_100, 5_050));

    expect(positive).toEqual({
      clientSentAt: 1_000,
      clientReceivedAt: 1_100,
      serverTime: 5_050,
      clientMidpointTime: 1_050,
      roundTripMs: 100,
      offsetMs: 4_000,
    });
    expect(clientTimeToServerTime(1_100, positive?.offsetMs ?? 0)).toBe(5_100);

    expect(
      normalizeClockSyncSample(sample(2_000, 2_100, 500))?.offsetMs,
    ).toBe(-1_550);
    expect(
      normalizeClockSyncSample(sample(3_000, 3_000, 3_000))?.offsetMs,
    ).toBe(0);
  });

  it("rejects malformed samples and excessive latency", () => {
    expect(normalizeClockSyncSample(sample(1_100, 1_000, 5_000))).toBeNull();
    expect(normalizeClockSyncSample(sample(-1, 1_000, 5_000))).toBeNull();
    expect(normalizeClockSyncSample(sample(1.5, 1_000, 5_000))).toBeNull();
    expect(normalizeClockSyncSample(sample(1_000, 1_100, Number.NaN))).toBeNull();
    expect(
      normalizeClockSyncSample(sample(1_000, 1_200, 5_000), {
        maxRoundTripMs: 100,
      }),
    ).toBeNull();
    expect(
      normalizeClockSyncSample(sample(1_000, 1_100, 5_000), {
        maxRoundTripMs: -1,
      }),
    ).toBeNull();
  });

  it("prefers low-latency samples from the rolling window", () => {
    const estimator = new ClockOffsetEstimator({ windowSize: 5 });

    estimator.add(sample(40_000, 41_000, 41_900), 41_000);

    for (const sentAt of [10_000, 20_000, 30_000]) {
      estimator.add(
        sample(sentAt, sentAt + 20, sentAt + 10 + 1_000),
        sentAt + 20,
      );
    }

    const estimate = estimator.getEstimate(41_000);

    expect(estimate).toMatchObject({
      offsetMs: 1_000,
      latencyMs: 20,
      sampleCount: 4,
      estimatedAtClientTime: 41_000,
    });
  });

  it("averages only the lowest-latency samples and keeps the last window", () => {
    const estimator = new ClockOffsetEstimator({ windowSize: 3 });

    for (const [index, offset] of [100, 200, 300, 400].entries()) {
      const sentAt = (index + 1) * 10_000;
      estimator.add(sample(sentAt, sentAt + 10, sentAt + 5 + offset));
    }

    expect(estimator.getEstimate(40_010)).toMatchObject({
      offsetMs: 300,
      sampleCount: 3,
    });
  });

  it("drops stale samples and safely ignores invalid updates", () => {
    const estimator = new ClockOffsetEstimator({
      maxSampleAgeMs: 1_000,
    });

    expect(
      estimator.add(sample(10_000, 10_020, 11_010), 10_020),
    ).toMatchObject({ offsetMs: 1_000, sampleCount: 1 });

    expect(
      estimator.add(sample(11_000, 10_000, 12_000), 11_000),
    ).toMatchObject({ offsetMs: 1_000, sampleCount: 1 });
    expect(estimator.getEstimate(11_000)).not.toBeNull();
    expect(estimator.getEstimate(11_021)).toBeNull();
  });

  it("resets samples so rooms cannot share clock estimates", () => {
    const estimator = new ClockOffsetEstimator();

    estimator.add(sample(1_000, 1_020, 2_010));
    expect(estimator.getEstimate(1_020)).not.toBeNull();

    estimator.reset();
    expect(estimator.getEstimate(1_020)).toBeNull();
  });
});

describe("requestClockSample", () => {
  it("sends the client timestamp and records the response midpoint", async () => {
    const now = vi
      .fn()
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_200);
    const emit = vi.fn(
      (
        _event: string,
        _payload: unknown,
        ack: (response: unknown) => void,
      ) => {
        ack({ ok: true, clientTime: 1_000, serverTime: 5_000 });
      },
    );

    await expect(
      requestClockSample(createSocket(true, emit), { now }),
    ).resolves.toEqual({
      clientSentAt: 1_000,
      clientReceivedAt: 1_200,
      serverTime: 5_000,
    });
    expect(emit).toHaveBeenCalledWith(
      SOCKET_EVENTS.CLOCK_SYNC,
      { clientTime: 1_000 },
      expect.any(Function),
    );
  });

  it("returns null while disconnected or without a valid client timestamp", async () => {
    const emit = vi.fn();

    await expect(
      requestClockSample(createSocket(false, emit)),
    ).resolves.toBeNull();
    await expect(requestClockSample(null, { now: () => 1_000 })).resolves.toBeNull();
    await expect(
      requestClockSample(createSocket(true, emit), { now: () => 1.5 }),
    ).resolves.toBeNull();
    expect(emit).not.toHaveBeenCalled();
  });

  it("rejects malformed, failed, and mismatched acknowledgements", async () => {
    const acknowledgements: unknown[] = [
      { ok: false, code: "UNAUTHORIZED" },
      { ok: true, clientTime: 999, serverTime: 5_000 },
      { ok: true, clientTime: 1_000, serverTime: Number.NaN },
      { ok: true, clientTime: 1_000 },
      "not-an-ack",
    ];

    for (const acknowledgement of acknowledgements) {
      const result = await requestClockSample(
        createSocket(true, (_event, _payload, ack) => {
          ack(acknowledgement);
        }),
        { now: () => 1_000 },
      );

      expect(result).toBeNull();
    }
  });

  it("normalizes emit failures and timeouts to null", async () => {
    await expect(
      requestClockSample(
        createSocket(true, () => {
          throw new Error("socket closed");
        }),
        { now: () => 1_000 },
      ),
    ).resolves.toBeNull();

    vi.useFakeTimers();
    const loading = requestClockSample(createSocket(true, vi.fn()), {
      now: () => 1_000,
    });

    await vi.advanceTimersByTimeAsync(CLOCK_SYNC_TIMEOUT_MS);

    await expect(loading).resolves.toBeNull();
  });
});
