import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LiveTabStage } from "../src/components/LiveTabStage";
import { WatchStage } from "../src/components/WatchStage";
import type { TabShareController } from "../src/realtime/useTabShare";

function controller(
  overrides: Partial<TabShareController> = {},
): TabShareController {
  return {
    active: null,
    presenting: false,
    status: "idle",
    stream: null,
    previewStream: null,
    surface: "unknown",
    audioMissing: false,
    error: null,
    start: vi.fn(async () => {}),
    stop: vi.fn(),
    retry: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe("LiveTabStage", () => {
  it("starts a share from the idle state", () => {
    const share = controller();

    render(<LiveTabStage share={share} connected />);

    fireEvent.click(screen.getByRole("button", { name: "Share this tab" }));

    expect(share.start).toHaveBeenCalledTimes(1);
  });

  it("disables the start button while the picker is open", () => {
    render(<LiveTabStage share={controller({ status: "starting" })} connected />);

    const button = screen.getByRole("button", {
      name: "Waiting for the picker…",
    }) as HTMLButtonElement;

    expect(button.disabled).toBe(true);
  });

  it("warns when the capture has no audio", () => {
    const share = controller({
      presenting: true,
      status: "live",
      surface: "browser",
      audioMissing: true,
      active: {
        presenterId: "me",
        presenterName: "Alex",
        startedAt: 1_000,
        surface: "browser",
      },
    });

    render(<LiveTabStage share={share} connected />);

    expect(screen.getByText("No tab audio was captured.", { exact: false })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Stop sharing" }));
    expect(share.stop).toHaveBeenCalledTimes(1);
  });

  it("tells the presenter when nobody is watching", () => {
    render(
      <LiveTabStage
        share={controller({
          presenting: true,
          status: "waiting",
          surface: "browser",
          active: {
            presenterId: "me",
            presenterName: "Alex",
            startedAt: 1_000,
            surface: "browser",
          },
        })}
        connected
      />,
    );

    expect(screen.getByText("Nobody is watching right now", { exact: false })).toBeTruthy();
  });

  it("attaches the preview when the panel mounts after the capture starts", () => {
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockImplementation(() => Promise.resolve());
    const previewStream = { getTracks: () => [] } as unknown as MediaStream;

    // The capture exists before the server confirms, so the video mounts late.
    const { rerender } = render(
      <LiveTabStage share={controller({ previewStream })} connected />,
    );
    expect(document.querySelector("video")).toBeNull();

    rerender(
      <LiveTabStage
        share={controller({
          previewStream,
          presenting: true,
          status: "live",
          surface: "browser",
          active: {
            presenterId: "me",
            presenterName: "Alex",
            startedAt: 1_000,
            surface: "browser",
          },
        })}
        connected
      />,
    );

    const video = document.querySelector("video") as HTMLVideoElement | null;

    expect(video?.srcObject).toBe(previewStream);

    play.mockRestore();
  });

  it("gives the presenter a muted preview of their own capture", () => {
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockImplementation(() => Promise.resolve());
    const previewStream = { getTracks: () => [] } as unknown as MediaStream;

    render(
      <LiveTabStage
        share={controller({
          presenting: true,
          status: "live",
          surface: "browser",
          previewStream,
          active: {
            presenterId: "me",
            presenterName: "Alex",
            startedAt: 1_000,
            surface: "browser",
          },
        })}
        connected
      />,
    );

    const video = document.querySelector("video") as HTMLVideoElement | null;

    expect(video).not.toBeNull();
    expect(video?.muted).toBe(true);

    play.mockRestore();
  });

  it("names the presenter and the surface for the viewer", () => {
    render(
      <LiveTabStage
        share={controller({
          active: {
            presenterId: "them",
            presenterName: "Sam",
            startedAt: 1_000,
            surface: "browser",
          },
        })}
        connected
      />,
    );

    expect(screen.getByText("Sam is sharing a browser tab.", { exact: false })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Stop sharing" }),
    ).toBeNull();
  });

  it("surfaces capture errors", () => {
    render(
      <LiveTabStage
        share={controller({ error: "This browser cannot capture a tab." })}
        connected
      />,
    );

    expect(screen.getByRole("alert").textContent).toContain(
      "cannot capture a tab",
    );
  });
});

describe("WatchStage live tab panel", () => {
  it("offers the live tab panel only when sharing is available", () => {
    const onCommand = vi.fn(async () => ({
      ok: false as const,
      code: "INTERNAL" as const,
    }));

    const { rerender } = render(
      <WatchStage playback={null} connected onCommand={onCommand} />,
    );

    expect(screen.queryByRole("button", { name: "Live tab" })).toBeNull();

    rerender(
      <WatchStage
        playback={null}
        connected
        share={controller()}
        onCommand={onCommand}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Live tab" }));
    expect(screen.getByRole("button", { name: "Share this tab" })).toBeTruthy();
  });
});
