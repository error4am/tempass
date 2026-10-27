import type {
  PlaybackCommandAck,
  PlaybackState,
  PlaybackUpdate,
  RoomSnapshot,
} from "@tempass/shared";

/**
 * Callers must provide a server-aligned timestamp. Stage 5 must account for
 * client/server clock offset before projecting positions from browser time.
 */
export function projectPlaybackPosition(
  state: PlaybackState,
  currentServerTimeMs: number,
): number {
  const storedPosition = Number.isFinite(state.positionSeconds)
    ? Math.max(0, state.positionSeconds)
    : 0;

  if (state.status !== "playing" || !Number.isFinite(currentServerTimeMs)) {
    return storedPosition;
  }

  const elapsedMs = currentServerTimeMs - state.updatedAt;

  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) {
    return storedPosition;
  }

  return Math.max(0, storedPosition + elapsedMs / 1_000);
}

export function calculatePlaybackDrift(
  expectedPositionSeconds: number,
  actualPositionSeconds: number,
): number {
  return actualPositionSeconds - expectedPositionSeconds;
}

/**
 * While playing, normal player progress and network jitter can produce small
 * differences. Corrections happen only beyond this threshold.
 */
export const PLAYING_DRIFT_THRESHOLD_SECONDS = 2;

/**
 * Paused playback has no natural progression to explain drift, so paused
 * players are corrected at a tighter threshold.
 */
export const PAUSED_DRIFT_THRESHOLD_SECONDS = 0.75;

export interface PlaybackDriftThresholds {
  playingSeconds: number;
  pausedSeconds: number;
}

export function playbackDriftExceedsThreshold(
  status: PlaybackState["status"],
  driftSeconds: number,
  thresholds: PlaybackDriftThresholds = {
    playingSeconds: PLAYING_DRIFT_THRESHOLD_SECONDS,
    pausedSeconds: PAUSED_DRIFT_THRESHOLD_SECONDS,
  },
): boolean {
  const threshold =
    status === "playing"
      ? thresholds.playingSeconds
      : status === "paused"
        ? thresholds.pausedSeconds
        : Number.POSITIVE_INFINITY;

  return Number.isFinite(driftSeconds) && Math.abs(driftSeconds) > threshold;
}

export function isPlaybackRevisionStale(
  incomingRevision: number,
  currentRevision: number,
): boolean {
  return incomingRevision <= currentRevision;
}

export function mergePlaybackUpdate(
  current: PlaybackUpdate | null,
  incoming: PlaybackUpdate,
): PlaybackUpdate {
  if (!current) {
    return incoming;
  }

  return isPlaybackRevisionStale(
    incoming.state.revision,
    current.state.revision,
  )
    ? current
    : incoming;
}

export function playbackUpdateFromSnapshot(
  snapshot: Pick<RoomSnapshot, "playback" | "serverTime">,
): PlaybackUpdate {
  return {
    state: snapshot.playback,
    serverTime: snapshot.serverTime,
  };
}

export function playbackUpdateFromAck(
  ack: PlaybackCommandAck,
): PlaybackUpdate | null {
  return ack.ok
    ? {
        state: ack.state,
        serverTime: ack.serverTime,
      }
    : null;
}
