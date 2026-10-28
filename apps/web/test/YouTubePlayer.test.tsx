import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  PlaybackCommand,
  PlaybackCommandAck,
  PlaybackState,
  PlaybackUpdate,
} from "@tempass/shared";

import { YouTubePlayer } from "../src/components/YouTubePlayer";

const loaderMock = vi.hoisted(() => ({
  load: vi.fn(),
}));

vi.mock("../src/lib/youtubeIframe", () => ({
  loadYouTubeIframeApi: loaderMock.load,
}));

const VIDEO_ID = "dQw4w9WgXcQ";
const OTHER_VIDEO_ID = "M7lc1UVf-VE";

type PlayerEvent = { data: number; target: FakePlayer };

interface FakePlayerOptions {
  videoId?: string;
  width?: string | number;
  height?: string | number;
  playerVars?: Record<string, string | number>;
  events?: {
    onReady?: (event: { target: FakePlayer }) => void;
    onStateChange?: (event: PlayerEvent) => void;
    onError?: (event: PlayerEvent) => void;
  };
}

class FakePlayer {
  static instances: FakePlayer[] = [];

  readonly options: FakePlayerOptions;
  autoAdvance = true;
  state = -1;
  currentTime = 0;
  duration = 0;
  muted = false;
  videoId: string | null;

  playVideo = vi.fn(() => {
    if (this.autoAdvance) {
      this.emitState(1);
    }
  });
  pauseVideo = vi.fn(() => {
    this.emitState(2);
  });
  seekTo = vi.fn((seconds: number) => {
    this.currentTime = seconds;
  });
  mute = vi.fn(() => {
    this.muted = true;
  });
  unMute = vi.fn(() => {
    this.muted = false;
  });
  isMuted = vi.fn(() => this.muted);
  loadVideoById = vi.fn(({ videoId, startSeconds = 0 }: { videoId: string; startSeconds?: number }) => {
    this.videoId = videoId;
    this.currentTime = startSeconds;
    this.emitState(1);
  });
  cueVideoById = vi.fn(({ videoId, startSeconds = 0 }: { videoId: string; startSeconds?: number }) => {
    this.videoId = videoId;
    this.currentTime = startSeconds;
    this.emitState(5);
  });
  getCurrentTime = vi.fn(() => this.currentTime);
  getDuration = vi.fn(() => this.duration);
  getPlayerState = vi.fn(() => this.state);
  destroy = vi.fn();

  constructor(_element: HTMLElement, options: FakePlayerOptions) {
    this.options = options;
    this.videoId = options.videoId ?? null;
    FakePlayer.instances.push(this);
  }

  ready() {
    this.state = -1;
    this.options.events?.onReady?.({ target: this });
  }

  emitState(state: number) {
    this.state = state;
    this.options.events?.onStateChange?.({ data: state, target: this });
  }

  emitError(code: number) {
    this.options.events?.onError?.({ data: code, target: this });
  }
}

function playbackUpdate(
  overrides: Partial<PlaybackState> = {},
  serverTime = 1_000,
): PlaybackUpdate {
  const state: PlaybackState = {
    videoId: VIDEO_ID,
    status: "paused",
    positionSeconds: 0,
    updatedAt: serverTime,
    revision: 1,
    ...overrides,
  };

  return { state, serverTime };
}

function acceptedAck(update: PlaybackUpdate): PlaybackCommandAck {
  return {
    ok: true,
    state: update.state,
    serverTime: update.serverTime,
  };
}

function createCommandHandler(
  result: PlaybackCommandAck = acceptedAck(playbackUpdate()),
) {
  return vi.fn(
    async (_command: PlaybackCommand): Promise<PlaybackCommandAck> => result,
  );
}

async function renderPlayer(
  playback = playbackUpdate(),
  onCommand = createCommandHandler(),
  options: {
    clockOffsetMs?: number | null;
    ready?: boolean;
  } = {},
) {
  const view = render(
    <YouTubePlayer
      playback={playback}
      connected
      clockOffsetMs={options.clockOffsetMs ?? null}
      onCommand={onCommand}
    />,
  );

  await waitFor(() => {
    expect(FakePlayer.instances).toHaveLength(1);
  });

  const player = FakePlayer.instances[0];

  if (!player) {
    throw new Error("Fake player was not created");
  }

  if (options.ready !== false) {
    act(() => {
      player.ready();
    });
  }

  return { ...view, player, onCommand };
}

beforeEach(() => {
  FakePlayer.instances = [];
  loaderMock.load.mockReset();
  loaderMock.load.mockResolvedValue({ Player: FakePlayer });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("YouTubePlayer", () => {
  it("creates a paused player with YouTube controls disabled and cleans it up", async () => {
    const { player, onCommand, unmount } = await renderPlayer();

    expect(player.options.videoId).toBe(VIDEO_ID);
    expect(player.options.playerVars).toMatchObject({
      autoplay: 0,
      controls: 0,
      disablekb: 1,
      playsinline: 1,
    });
    expect(player.pauseVideo).toHaveBeenCalled();
    expect(onCommand).not.toHaveBeenCalled();

    unmount();

    expect(player.destroy).toHaveBeenCalledTimes(1);
  });

  it("blocks pointer input on the embedded player mount", async () => {
    const { container } = await renderPlayer();

    const mount = container.querySelector(".aspect-video > div");

    expect(mount).not.toBeNull();
    expect(mount?.classList.contains("pointer-events-none")).toBe(true);
  });

  it("sends play and pause commands from the custom controls", async () => {
    const { player, onCommand } = await renderPlayer();

    fireEvent.click(screen.getByRole("button", { name: "Play" }));

    await waitFor(() => {
      expect(onCommand).toHaveBeenCalledWith({
        action: "play",
        videoId: VIDEO_ID,
        positionSeconds: 0,
      });
    });

    act(() => {
      player.emitState(1);
    });
    for (const call of onCommand.mock.calls) {
      expect(call[0].action).not.toBe("pause");
    }

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));

    await waitFor(() => {
      expect(onCommand).toHaveBeenCalledWith({
        action: "pause",
        videoId: VIDEO_ID,
        positionSeconds: 0,
      });
    });
  });

  it("allows only one play command while a command is pending", async () => {
    let resolveAck!: (ack: PlaybackCommandAck) => void;
    const onCommand = vi.fn(
      (_command: PlaybackCommand) =>
        new Promise<PlaybackCommandAck>((resolve) => {
          resolveAck = resolve;
        }),
    );
    await renderPlayer(playbackUpdate(), onCommand);

    const play = screen.getByRole("button", { name: "Play" });
    fireEvent.click(play);
    fireEvent.click(play);

    expect(onCommand).toHaveBeenCalledTimes(1);
    expect((play as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      resolveAck(
        acceptedAck(
          playbackUpdate({ status: "playing", revision: 2 }, 1_000),
        ),
      );
      await Promise.resolve();
    });
  });

  it("controls mute locally without changing shared playback", async () => {
    const { player, onCommand } = await renderPlayer();

    fireEvent.click(screen.getByRole("button", { name: "Mute" }));

    expect(player.mute).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Unmute" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Unmute" }));

    expect(player.unMute).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Mute" })).toBeTruthy();
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("applies remote play and pause updates without issuing commands", async () => {
    const initial = playbackUpdate();
    const onCommand = createCommandHandler();
    const { player, rerender } = await renderPlayer(initial, onCommand);

    rerender(
      <YouTubePlayer
        playback={playbackUpdate(
          { status: "playing", positionSeconds: 10, revision: 2 },
          1_000,
        )}
        connected
        onCommand={onCommand}
      />,
    );

    await waitFor(() => {
      expect(player.playVideo).toHaveBeenCalled();
    });

    const firstSeek = player.seekTo.mock.calls[0]?.[0];
    expect(firstSeek).toBeCloseTo(10, 1);

    player.currentTime = 13;
    rerender(
      <YouTubePlayer
        playback={playbackUpdate(
          { status: "paused", positionSeconds: 13.4, revision: 3 },
          1_000,
        )}
        connected
        onCommand={onCommand}
      />,
    );

    await waitFor(() => {
      expect(player.pauseVideo).toHaveBeenCalledTimes(2);
    });

    expect(onCommand).not.toHaveBeenCalled();
  });

  it("cues a newly selected video at the canonical position without autoplaying it", async () => {
    const initial = playbackUpdate();
    const onCommand = createCommandHandler();
    const { player, rerender } = await renderPlayer(initial, onCommand);

    rerender(
      <YouTubePlayer
        playback={playbackUpdate(
          {
            videoId: OTHER_VIDEO_ID,
            status: "paused",
            positionSeconds: 0,
            revision: 2,
          },
          2_000,
        )}
        connected
        onCommand={onCommand}
      />,
    );

    await waitFor(() => {
      expect(player.cueVideoById).toHaveBeenCalledWith({
        videoId: OTHER_VIDEO_ID,
        startSeconds: 0,
      });
    });

    expect(player.playVideo).not.toHaveBeenCalled();
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("offers a user-triggered recovery when autoplay is blocked", async () => {
    const onCommand = createCommandHandler();

    render(
      <YouTubePlayer
        playback={playbackUpdate(
          { status: "playing", positionSeconds: 10, revision: 2 },
          1_000,
        )}
        connected
        onCommand={onCommand}
      />,
    );

    await waitFor(() => {
      expect(FakePlayer.instances).toHaveLength(1);
    });

    const player = FakePlayer.instances[0];

    if (!player) {
      throw new Error("Fake player was not created");
    }

    player.autoAdvance = false;
    act(() => {
      player.ready();
    });

    const joinButton = await screen.findByRole(
      "button",
      { name: "Tap to join playback" },
      { timeout: 2_500 },
    );

    fireEvent.click(joinButton);

    expect(player.playVideo).toHaveBeenCalledTimes(2);
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("commits a seek command from the position control", async () => {
    const { player, onCommand } = await renderPlayer();

    player.duration = 120;

    const slider = await waitFor(() => {
      const control = screen.getByRole("slider") as HTMLInputElement;
      expect(control.disabled).toBe(false);
      return control;
    });

    fireEvent.change(slider, { target: { value: "30" } });
    expect(onCommand).not.toHaveBeenCalled();

    fireEvent.pointerUp(slider);
    fireEvent.pointerUp(slider);

    await waitFor(() => {
      expect(onCommand).toHaveBeenCalledWith({
        action: "seek",
        videoId: VIDEO_ID,
        positionSeconds: 30,
      });
    });
    expect(onCommand).toHaveBeenCalledTimes(1);
  });

  it("shows buffering and player errors as local state", async () => {
    const { player, onCommand } = await renderPlayer();

    act(() => {
      player.emitState(3);
    });

    expect(screen.getByText("Buffering…")).toBeTruthy();

    act(() => {
      player.emitState(1);
      player.emitError(101);
    });

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain(
        "does not allow embedding",
      );
    });

    expect(screen.queryByText("Buffering…")).toBeNull();
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("surfaces command failures without changing local playback state", async () => {
    const onCommand = createCommandHandler({
      ok: false,
      code: "VIDEO_MISMATCH",
    });
    const { player } = await renderPlayer(playbackUpdate(), onCommand);

    expect(player.options.videoId).toBe(VIDEO_ID);

    fireEvent.click(screen.getByRole("button", { name: "Play" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain(
        "latest selection",
      );
    });

    expect(player.playVideo).not.toHaveBeenCalled();
  });

  it("uses the measured clock offset to project a remote playing position", async () => {
    const onCommand = createCommandHandler();
    const { player } = await renderPlayer(
      playbackUpdate(
        {
          status: "playing",
          positionSeconds: 0,
          updatedAt: 1_000_000,
          revision: 2,
        },
        1_000_000,
      ),
      onCommand,
      { clockOffsetMs: 10_000, ready: false },
    );
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);

    act(() => {
      player.ready();
    });

    await waitFor(() => {
      expect(player.playVideo).toHaveBeenCalled();
    });

    expect(player.seekTo.mock.calls[0]?.[0]).toBeCloseTo(10, 1);
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("does not correct sub-threshold playing drift", async () => {
    const onCommand = createCommandHandler();
    const { player, rerender } = await renderPlayer(
      playbackUpdate(),
      onCommand,
    );

    expect(player.seekTo).not.toHaveBeenCalled();
    player.currentTime = 8.5;

    rerender(
      <YouTubePlayer
        playback={playbackUpdate(
          { status: "playing", positionSeconds: 10, revision: 2 },
          1_000,
        )}
        connected
        onCommand={onCommand}
      />,
    );

    await waitFor(() => {
      expect(player.playVideo).toHaveBeenCalled();
    });

    expect(player.seekTo).not.toHaveBeenCalled();
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("corrects paused drift beyond the tighter paused threshold", async () => {
    const onCommand = createCommandHandler();
    const { player, rerender } = await renderPlayer(
      playbackUpdate(),
      onCommand,
    );

    player.currentTime = 2;
    rerender(
      <YouTubePlayer
        playback={playbackUpdate(
          { status: "paused", positionSeconds: 5, revision: 2 },
          1_000,
        )}
        connected
        onCommand={onCommand}
      />,
    );

    expect(player.seekTo).toHaveBeenCalledTimes(1);
    expect(player.seekTo.mock.calls[0]?.[0]).toBeCloseTo(5, 1);
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("defers buffering corrections and reconciles the newest revision", async () => {
    const onCommand = createCommandHandler();
    const { player, rerender } = await renderPlayer(
      playbackUpdate(),
      onCommand,
    );

    act(() => {
      player.emitState(3);
    });

    rerender(
      <YouTubePlayer
        playback={playbackUpdate(
          { status: "playing", positionSeconds: 10, revision: 2 },
          1_000,
        )}
        connected
        onCommand={onCommand}
      />,
    );

    expect(player.seekTo).not.toHaveBeenCalled();
    expect(player.playVideo).not.toHaveBeenCalled();

    rerender(
      <YouTubePlayer
        playback={playbackUpdate(
          { status: "playing", positionSeconds: 30, revision: 3 },
          1_000,
        )}
        connected
        onCommand={onCommand}
      />,
    );

    expect(player.seekTo).not.toHaveBeenCalled();

    player.currentTime = 0;
    act(() => {
      player.emitState(1);
    });

    expect(player.seekTo).toHaveBeenCalledTimes(1);
    expect(player.seekTo.mock.calls[0]?.[0]).toBeCloseTo(30, 1);
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("waits for player readiness before applying playback", async () => {
    const onCommand = createCommandHandler();
    const { player } = await renderPlayer(
      playbackUpdate(
        { status: "playing", positionSeconds: 10, revision: 2 },
        1_000,
      ),
      onCommand,
      { ready: false },
    );

    expect(player.seekTo).not.toHaveBeenCalled();
    expect(player.playVideo).not.toHaveBeenCalled();
  });

  it("applies a newer canonical revision after reconnecting", async () => {
    const onCommand = createCommandHandler();
    const { player, rerender } = await renderPlayer(
      playbackUpdate(),
      onCommand,
    );
    player.autoAdvance = false;

    rerender(
      <YouTubePlayer
        playback={playbackUpdate(
          { status: "playing", positionSeconds: 42, revision: 5 },
          1_000,
        )}
        connected
        onCommand={onCommand}
      />,
    );

    await waitFor(() => {
      expect(player.playVideo).toHaveBeenCalled();
    });

    expect(player.seekTo.mock.calls[0]?.[0]).toBeCloseTo(42, 1);
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("pauses at video end and replays only after an explicit request", async () => {
    const onCommand = createCommandHandler();
    const { player } = await renderPlayer(playbackUpdate(), onCommand);

    player.duration = 100;
    act(() => {
      player.currentTime = 100;
      player.emitState(1);
      player.emitState(0);
    });

    const replay = screen.getByRole("button", { name: "Replay" });

    // Ending the video pauses at the final position through the canonical command.
    await waitFor(() => {
      expect(onCommand).toHaveBeenLastCalledWith({
        action: "pause",
        videoId: VIDEO_ID,
        positionSeconds: 100,
      });
    });

    fireEvent.click(replay);

    await waitFor(() => {
      expect(onCommand).toHaveBeenCalledWith({
        action: "play",
        videoId: VIDEO_ID,
        positionSeconds: 0,
      });
    });
  });

  it("ignores duplicate end events and sends a single pause command", async () => {
    const onCommand = createCommandHandler();
    const { player } = await renderPlayer(playbackUpdate(), onCommand);

    player.duration = 100;
    act(() => {
      player.currentTime = 100;
      player.emitState(1);
      player.emitState(0);
      player.emitState(0);
    });

    await waitFor(() => {
      expect(onCommand).toHaveBeenCalledTimes(1);
      expect(onCommand).toHaveBeenLastCalledWith({
        action: "pause",
        videoId: VIDEO_ID,
        positionSeconds: 100,
      });
    });
  });

  it("falls back to the current position when duration is unavailable at end", async () => {
    const onCommand = createCommandHandler();
    const { player } = await renderPlayer(playbackUpdate(), onCommand);

    player.duration = 0;
    player.currentTime = 42;
    act(() => {
      player.emitState(1);
      player.emitState(0);
    });

    await waitFor(() => {
      expect(onCommand).toHaveBeenLastCalledWith({
        action: "pause",
        videoId: VIDEO_ID,
        positionSeconds: 42,
      });
    });
  });

  it("handles a rejected end-of-video command without crashing", async () => {
    const onCommand = vi.fn(
      async () => ({ ok: false, code: "VIDEO_MISMATCH" } as PlaybackCommandAck),
    );
    const { player } = await renderPlayer(playbackUpdate(), onCommand);

    player.duration = 100;
    act(() => {
      player.currentTime = 100;
      player.emitState(1);
      player.emitState(0);
    });

    await waitFor(() => {
      expect(onCommand).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByRole("button", { name: "Replay" })).toBeTruthy();
  });

});
