// @vitest-environment node
import { describe, expect, it } from "vitest";

import type {
  PlaybackCommandAck,
  PlaybackState,
  PlaybackUpdate,
} from "@tempass/shared";

import {
  PAUSED_DRIFT_THRESHOLD_SECONDS,
  PLAYING_DRIFT_THRESHOLD_SECONDS,
  calculatePlaybackDrift,
  isPlaybackRevisionStale,
  mergePlaybackUpdate,
  playbackDriftExceedsThreshold,
  playbackUpdateFromAck,
  playbackUpdateFromSnapshot,
  projectPlaybackPosition,
} from "../src/lib/playback";

const VIDEO_ID = "dQw4w9WgXcQ";

function playbackState(overrides: Partial<PlaybackState> = {}): PlaybackState {
  return {
    videoId: VIDEO_ID,
    status: "paused",
    positionSeconds: 12.5,
    updatedAt: 1_000_000,
    revision: 1,
    ...overrides,
  };
}

function playbackUpdate(
  revision: number,
  overrides: Partial<PlaybackState> = {},
  serverTime = 1_000_000,
): PlaybackUpdate {
  return {
    state: playbackState({ revision, ...overrides }),
    serverTime,
  };
}

describe("playback synchronization helpers", () => {
  it("returns the stored position for idle and paused states", () => {
    const idle = playbackState({
      videoId: null,
      status: "idle",
      positionSeconds: 0,
    });
    const paused = playbackState({ status: "paused", positionSeconds: 12.5 });

    expect(projectPlaybackPosition(idle, 9_999_999)).toBe(0);
    expect(projectPlaybackPosition(paused, 9_999_999)).toBe(12.5);
  });

  it("projects playing positions using elapsed server time", () => {
    const playing = playbackState({
      status: "playing",
      positionSeconds: 12.5,
      updatedAt: 1_000_000,
    });

    expect(projectPlaybackPosition(playing, 1_000_000)).toBe(12.5);
    expect(projectPlaybackPosition(playing, 1_002_500)).toBe(15);
    expect(projectPlaybackPosition(playing, 999_000)).toBe(12.5);
    expect(projectPlaybackPosition(playing, Number.NaN)).toBe(12.5);
  });

  it("clamps negative projected positions and does not mutate state", () => {
    const playing = playbackState({
      status: "playing",
      positionSeconds: -5,
      updatedAt: 1_000_000,
    });
    const snapshot = structuredClone(playing);

    expect(projectPlaybackPosition(playing, 1_000_000)).toBe(0);
    expect(playing).toEqual(snapshot);
  });

  it("calculates player drift as actual minus expected", () => {
    expect(calculatePlaybackDrift(20, 20.5)).toBe(0.5);
    expect(calculatePlaybackDrift(20, 19.25)).toBe(-0.75);
    expect(calculatePlaybackDrift(0, 0)).toBe(0);
  });

  it("uses tighter drift thresholds while paused", () => {
    expect(PLAYING_DRIFT_THRESHOLD_SECONDS).toBe(2);
    expect(PAUSED_DRIFT_THRESHOLD_SECONDS).toBe(0.75);

    expect(playbackDriftExceedsThreshold("playing", 1.9)).toBe(false);
    expect(playbackDriftExceedsThreshold("playing", -2)).toBe(false);
    expect(playbackDriftExceedsThreshold("playing", 2.01)).toBe(true);
    expect(playbackDriftExceedsThreshold("playing", -2.01)).toBe(true);

    expect(playbackDriftExceedsThreshold("paused", 0.75)).toBe(false);
    expect(playbackDriftExceedsThreshold("paused", -0.76)).toBe(true);
    expect(playbackDriftExceedsThreshold("paused", 1)).toBe(true);
    expect(playbackDriftExceedsThreshold("idle", 10_000)).toBe(false);
    expect(playbackDriftExceedsThreshold("playing", Number.NaN)).toBe(false);
    expect(
      playbackDriftExceedsThreshold("playing", 1.5, {
        playingSeconds: 1,
        pausedSeconds: 0.5,
      }),
    ).toBe(true);
  });

  it("detects older and duplicate revisions as stale", () => {
    expect(isPlaybackRevisionStale(1, 2)).toBe(true);
    expect(isPlaybackRevisionStale(2, 2)).toBe(true);
    expect(isPlaybackRevisionStale(3, 2)).toBe(false);
  });

  it("merges only newer playback updates", () => {
    const current = playbackUpdate(4, { positionSeconds: 40 });

    expect(mergePlaybackUpdate(null, current)).toBe(current);
    expect(
      mergePlaybackUpdate(current, playbackUpdate(3, { positionSeconds: 30 })),
    ).toBe(current);
    expect(
      mergePlaybackUpdate(current, playbackUpdate(4, { positionSeconds: 44 })),
    ).toBe(current);

    const newer = playbackUpdate(5, { positionSeconds: 50 });
    expect(mergePlaybackUpdate(current, newer)).toBe(newer);
  });

  it("builds playback updates from snapshots and accepted acknowledgements", () => {
    const state = playbackState({ revision: 7 });
    const snapshot = {
      playback: state,
      serverTime: 2_000_000,
    };

    expect(playbackUpdateFromSnapshot(snapshot)).toEqual({
      state,
      serverTime: 2_000_000,
    });

    const accepted: PlaybackCommandAck = {
      ok: true,
      state,
      serverTime: 2_000_000,
    };
    const rejected: PlaybackCommandAck = {
      ok: false,
      code: "VIDEO_MISMATCH",
    };

    expect(playbackUpdateFromAck(accepted)).toEqual({
      state,
      serverTime: 2_000_000,
    });
    expect(playbackUpdateFromAck(rejected)).toBeNull();
  });
});
