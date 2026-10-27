import {
  SOCKET_EVENTS,
  clockSyncAckSchema,
} from "@tempass/shared";

import type { ClockSyncSample } from "../lib/clockSync";
import type { RoomSocket } from "./socket";

export const CLOCK_SYNC_TIMEOUT_MS = 5_000;

interface RequestClockSampleOptions {
  timeoutMs?: number;
  now?: () => number;
}

export function requestClockSample(
  socket: RoomSocket | null,
  options: RequestClockSampleOptions = {},
): Promise<ClockSyncSample | null> {
  if (!socket?.connected) {
    return Promise.resolve(null);
  }

  const now = options.now ?? Date.now;
  const clientSentAt = now();

  if (!Number.isSafeInteger(clientSentAt) || clientSentAt < 0) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      finish(null);
    }, options.timeoutMs ?? CLOCK_SYNC_TIMEOUT_MS);

    function finish(sample: ClockSyncSample | null) {
      if (settled) {
        return;
      }

      settled = true;
      window.clearTimeout(timer);
      resolve(sample);
    }

    try {
      socket.emit(
        SOCKET_EVENTS.CLOCK_SYNC,
        { clientTime: clientSentAt },
        (rawAck: unknown) => {
          const ack = clockSyncAckSchema.safeParse(rawAck);

          if (
            !ack.success ||
            !ack.data.ok ||
            ack.data.clientTime !== clientSentAt
          ) {
            finish(null);
            return;
          }

          const clientReceivedAt = now();

          finish({
            clientSentAt,
            clientReceivedAt,
            serverTime: ack.data.serverTime,
          });
        },
      );
    } catch {
      finish(null);
    }
  });
}
