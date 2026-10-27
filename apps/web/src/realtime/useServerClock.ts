import { useEffect, useRef, useState } from "react";

import {
  ClockOffsetEstimator,
  type ClockOffsetEstimate,
} from "../lib/clockSync";
import { requestClockSample } from "./clock";
import type { RoomSocket } from "./socket";

export const CLOCK_SAMPLE_INTERVAL_MS = 30_000;
export const CLOCK_SAMPLE_BURST_COUNT = 3;
export const CLOCK_SAMPLE_BURST_GAP_MS = 250;

export interface ServerClockState {
  offsetMs: number | null;
  latencyMs: number | null;
  sampleCount: number;
}

export function useServerClock(
  roomId: string,
  socket: RoomSocket | null,
): ServerClockState {
  const estimatorRef = useRef<ClockOffsetEstimator | null>(null);
  const [estimate, setEstimate] = useState<ClockOffsetEstimate | null>(null);

  if (!estimatorRef.current) {
    estimatorRef.current = new ClockOffsetEstimator();
  }

  useEffect(() => {
    estimatorRef.current?.reset();
    setEstimate(null);
  }, [roomId]);

  useEffect(() => {
    if (!socket) {
      estimatorRef.current?.reset();
      setEstimate(null);
      return;
    }

    let disposed = false;
    let intervalTimer = 0;
    let burstTimer = 0;
    let burstToken = 0;
    let burstActive = false;
    let burstIndex = 0;

    const stop = () => {
      burstToken += 1;
      burstActive = false;
      burstIndex = 0;

      if (intervalTimer) {
        window.clearInterval(intervalTimer);
        intervalTimer = 0;
      }

      if (burstTimer) {
        window.clearTimeout(burstTimer);
        burstTimer = 0;
      }
    };

    const recordSample = async () => {
      if (disposed || !socket.connected) {
        return;
      }

      const sample = await requestClockSample(socket);

      if (disposed || !sample) {
        return;
      }

      const nextEstimate = estimatorRef.current?.add(
        sample,
        sample.clientReceivedAt,
      );

      if (nextEstimate && !disposed) {
        setEstimate(nextEstimate);
      }
    };

    const runBurst = async (token: number) => {
      if (disposed || token !== burstToken || !socket.connected) {
        burstActive = false;
        return;
      }

      await recordSample();

      if (disposed || token !== burstToken) {
        burstActive = false;
        return;
      }

      burstIndex += 1;

      if (burstIndex < CLOCK_SAMPLE_BURST_COUNT && socket.connected) {
        burstTimer = window.setTimeout(() => {
          burstTimer = 0;
          void runBurst(token);
        }, CLOCK_SAMPLE_BURST_GAP_MS);
        return;
      }

      burstActive = false;
    };

    const startBurst = () => {
      if (disposed || burstActive || !socket.connected) {
        return;
      }

      burstActive = true;
      burstIndex = 0;
      const token = ++burstToken;
      void runBurst(token);
    };

    const start = () => {
      stop();
      startBurst();
      intervalTimer = window.setInterval(
        startBurst,
        CLOCK_SAMPLE_INTERVAL_MS,
      );
    };

    const handleConnect = () => {
      start();
    };

    const handleDisconnect = () => {
      stop();
      estimatorRef.current?.reset();
      setEstimate(null);
    };

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);

    if (socket.connected) {
      start();
    }

    return () => {
      disposed = true;
      stop();
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
    };
  }, [roomId, socket]);

  return {
    offsetMs: estimate?.offsetMs ?? null,
    latencyMs: estimate?.latencyMs ?? null,
    sampleCount: estimate?.sampleCount ?? 0,
  };
}
