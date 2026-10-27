export interface ClockSyncSample {
  clientSentAt: number;
  clientReceivedAt: number;
  serverTime: number;
}

export interface NormalizedClockSyncSample extends ClockSyncSample {
  clientMidpointTime: number;
  roundTripMs: number;
  offsetMs: number;
}

export interface ClockOffsetEstimate {
  offsetMs: number;
  latencyMs: number;
  sampleCount: number;
  estimatedAtClientTime: number;
}

export interface ClockOffsetEstimatorOptions {
  windowSize?: number;
  maxSampleAgeMs?: number;
  maxRoundTripMs?: number;
}

const DEFAULT_WINDOW_SIZE = 5;
const DEFAULT_MAX_SAMPLE_AGE_MS = 60_000;
const DEFAULT_MAX_ROUND_TRIP_MS = 10_000;
const LOW_LATENCY_SAMPLE_COUNT = 3;

function isTimestamp(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

/**
 * All timestamps use Unix epoch milliseconds. The offset is
 * `serverTime - clientTime`, so a positive offset means the server clock is
 * ahead. Convert a client timestamp with `clientTime + offsetMs`.
 *
 * The offset is estimated at the midpoint of the request/response interval,
 * which assumes roughly symmetric network latency. Low-latency samples reduce
 * the error introduced by that assumption.
 */
export function normalizeClockSyncSample(
  sample: ClockSyncSample,
  options: Pick<ClockOffsetEstimatorOptions, "maxRoundTripMs"> = {},
): NormalizedClockSyncSample | null {
  const { clientSentAt, clientReceivedAt, serverTime } = sample;
  const maxRoundTripMs =
    options.maxRoundTripMs ?? DEFAULT_MAX_ROUND_TRIP_MS;

  if (
    !isTimestamp(clientSentAt) ||
    !isTimestamp(clientReceivedAt) ||
    !isTimestamp(serverTime) ||
    !Number.isFinite(maxRoundTripMs) ||
    maxRoundTripMs < 0
  ) {
    return null;
  }

  const roundTripMs = clientReceivedAt - clientSentAt;

  if (roundTripMs < 0 || roundTripMs > maxRoundTripMs) {
    return null;
  }

  const clientMidpointTime = clientSentAt + roundTripMs / 2;

  return {
    clientSentAt,
    clientReceivedAt,
    serverTime,
    clientMidpointTime,
    roundTripMs,
    offsetMs: serverTime - clientMidpointTime,
  };
}

export function clientTimeToServerTime(
  clientTimeMs: number,
  offsetMs: number,
): number {
  return clientTimeMs + offsetMs;
}

export class ClockOffsetEstimator {
  private readonly windowSize: number;
  private readonly maxSampleAgeMs: number;
  private readonly maxRoundTripMs: number;
  private samples: NormalizedClockSyncSample[] = [];

  constructor(options: ClockOffsetEstimatorOptions = {}) {
    const windowSize = options.windowSize ?? DEFAULT_WINDOW_SIZE;
    const maxSampleAgeMs =
      options.maxSampleAgeMs ?? DEFAULT_MAX_SAMPLE_AGE_MS;
    const maxRoundTripMs =
      options.maxRoundTripMs ?? DEFAULT_MAX_ROUND_TRIP_MS;

    this.windowSize = Number.isInteger(windowSize) && windowSize > 0 ? windowSize : 1;
    this.maxSampleAgeMs =
      Number.isFinite(maxSampleAgeMs) && maxSampleAgeMs >= 0
        ? maxSampleAgeMs
        : DEFAULT_MAX_SAMPLE_AGE_MS;
    this.maxRoundTripMs =
      Number.isFinite(maxRoundTripMs) && maxRoundTripMs >= 0
        ? maxRoundTripMs
        : DEFAULT_MAX_ROUND_TRIP_MS;
  }

  add(
    sample: ClockSyncSample,
    now = sample.clientReceivedAt,
  ): ClockOffsetEstimate | null {
    const normalized = normalizeClockSyncSample(sample, {
      maxRoundTripMs: this.maxRoundTripMs,
    });

    if (normalized) {
      this.samples.push(normalized);

      if (this.samples.length > this.windowSize) {
        this.samples.splice(0, this.samples.length - this.windowSize);
      }
    }

    return this.getEstimate(now);
  }

  getEstimate(now = Date.now()): ClockOffsetEstimate | null {
    if (!Number.isFinite(now)) {
      return null;
    }

    this.samples = this.samples.filter((sample) => {
      const age = now - sample.clientReceivedAt;
      return Number.isFinite(age) && age <= this.maxSampleAgeMs;
    });

    if (this.samples.length === 0) {
      return null;
    }

    const selected = [...this.samples]
      .sort((left, right) => left.roundTripMs - right.roundTripMs)
      .slice(0, LOW_LATENCY_SAMPLE_COUNT);
    const offsetMs =
      selected.reduce((total, sample) => total + sample.offsetMs, 0) /
      selected.length;

    return {
      offsetMs,
      latencyMs: selected[0]?.roundTripMs ?? 0,
      sampleCount: this.samples.length,
      estimatedAtClientTime: now,
    };
  }

  reset(): void {
    this.samples = [];
  }
}
