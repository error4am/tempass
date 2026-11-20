import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BridgeState } from "@tempass/shared";

import { ExternalStage } from "../src/components/ExternalStage";

function bridge(overrides: Partial<BridgeState> = {}): BridgeState {
  return {
    source: { url: "https://source.test/watch", title: "Episode 29" },
    status: "playing",
    positionSeconds: 100,
    durationSeconds: 1_000,
    updatedAt: 1_000,
    revision: 1,
    ...overrides,
  };
}

function sliderValue(): number {
  const slider = screen.getByLabelText(
    "Source playback position",
  ) as HTMLInputElement;

  return Math.round(Number(slider.value));
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ExternalStage", () => {
  it("sends the live position on pause instead of the last report", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    const onCommand = vi.fn();
    render(<ExternalStage bridge={bridge()} connected onCommand={onCommand} />);

    act(() => {
      vi.advanceTimersByTime(3_000);
    });

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));

    // 100s at last report + 3s of local playback, not the stale 100s.
    expect(onCommand).toHaveBeenCalledWith({
      action: "pause",
      positionSeconds: 103,
    });
  });

  it("holds an optimistic seek until a report confirms it", () => {
    const onCommand = vi.fn();
    const { rerender } = render(
      <ExternalStage bridge={bridge()} connected onCommand={onCommand} />,
    );

    const slider = screen.getByLabelText(
      "Source playback position",
    ) as HTMLInputElement;

    fireEvent.change(slider, { target: { value: "500" } });
    fireEvent.pointerUp(slider);

    expect(onCommand).toHaveBeenCalledWith({
      action: "seek",
      positionSeconds: 500,
    });

    // The thumb stays on the target instead of snapping back to 100.
    expect(sliderValue()).toBe(500);

    // A report from before the seek landed must not move it.
    rerender(
      <ExternalStage
        bridge={bridge({ updatedAt: 2_000 })}
        connected
        onCommand={onCommand}
      />,
    );
    expect(sliderValue()).toBe(500);

    // The confirming report releases the optimistic value.
    rerender(
      <ExternalStage
        bridge={bridge({ positionSeconds: 501, updatedAt: 3_000 })}
        connected
        onCommand={onCommand}
      />,
    );
    expect(sliderValue()).toBeGreaterThanOrEqual(500);
    expect(sliderValue()).toBeLessThanOrEqual(502);
  });
});
