import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  PlaybackCommand,
  PlaybackCommandAck,
  PlaybackUpdate,
} from "@tempass/shared";

import { WatchStage } from "../src/components/WatchStage";

const loaderMock = vi.hoisted(() => ({
  load: vi.fn(() => new Promise(() => {})),
}));

vi.mock("../src/lib/youtubeIframe", () => ({
  loadYouTubeIframeApi: loaderMock.load,
}));

const VIDEO_ID = "dQw4w9WgXcQ";

function playbackUpdate(): PlaybackUpdate {
  return {
    state: {
      videoId: VIDEO_ID,
      status: "paused",
      positionSeconds: 0,
      updatedAt: 1_000,
      revision: 1,
    },
    serverTime: 1_000,
  };
}

function acceptedSelection(): PlaybackCommandAck {
  return {
    ok: true,
    state: playbackUpdate().state,
    serverTime: 1_000,
  };
}

function commandHandler(result: PlaybackCommandAck = acceptedSelection()) {
  return vi.fn(
    async (_command: PlaybackCommand): Promise<PlaybackCommandAck> => result,
  );
}

beforeEach(() => {
  loaderMock.load.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("WatchStage", () => {
  it("rejects invalid YouTube input without sending a command", async () => {
    const onCommand = commandHandler();

    render(
      <WatchStage playback={null} connected onCommand={onCommand} />,
    );

    fireEvent.change(screen.getByLabelText("YouTube link or video ID"), {
      target: { value: "not a video" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Select video" }));

    expect(screen.getByRole("alert").textContent).toContain(
      "valid YouTube link",
    );
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("parses a YouTube link and leaves selection to canonical playback state", async () => {
    const onCommand = commandHandler();

    render(
      <WatchStage playback={null} connected onCommand={onCommand} />,
    );

    fireEvent.change(screen.getByLabelText("YouTube link or video ID"), {
      target: { value: `https://youtu.be/${VIDEO_ID}` },
    });
    fireEvent.click(screen.getByRole("button", { name: "Select video" }));

    await waitFor(() => {
      expect(onCommand).toHaveBeenCalledWith({
        action: "select",
        videoId: VIDEO_ID,
      });
    });

    expect(screen.getByText("No video selected")).toBeTruthy();
    expect(screen.getByText("No video")).toBeTruthy();
    expect(loaderMock.load).not.toHaveBeenCalled();
  });

  it("shows a rejected selection without optimistically selecting the video", async () => {
    const onCommand = commandHandler({
      ok: false,
      code: "VIDEO_MISMATCH",
    });

    render(
      <WatchStage playback={null} connected onCommand={onCommand} />,
    );

    fireEvent.change(screen.getByLabelText("YouTube link or video ID"), {
      target: { value: VIDEO_ID },
    });
    fireEvent.click(screen.getByRole("button", { name: "Select video" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain(
        "latest selection",
      );
    });

    expect(screen.getByText("No video selected")).toBeTruthy();
  });

  it("renders the player only from canonical playback state", async () => {
    const onCommand = commandHandler();
    const { rerender } = render(
      <WatchStage playback={null} connected onCommand={onCommand} />,
    );

    expect(screen.getByText("No video selected")).toBeTruthy();

    rerender(
      <WatchStage
        playback={playbackUpdate()}
        connected
        onCommand={onCommand}
      />,
    );

    expect(screen.queryByText("No video selected")).toBeNull();
    expect(screen.getByText("Paused")).toBeTruthy();
    expect(screen.getByText(VIDEO_ID)).toBeTruthy();
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("disables selection while the connection is not ready", () => {
    const onCommand = commandHandler();

    render(
      <WatchStage playback={null} connected={false} onCommand={onCommand} />,
    );

    expect(
      (screen.getByLabelText("YouTube link or video ID") as HTMLInputElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Select video" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
