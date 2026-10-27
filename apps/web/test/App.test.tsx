import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "../src/App";

beforeEach(() => {
  window.history.replaceState({}, "", "/");
  window.sessionStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("Network disabled in this test"))),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("App", () => {
  it("renders the Tempass landing page", () => {
    render(<App />);

    expect(screen.getByText("Tempass")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: /watch youtube together/i })).toBeTruthy();
    expect(screen.getByText(/private watch-party app/i)).toBeTruthy();
  });

  it("offers enabled room creation and join entry points", () => {
    render(<App />);

    const createHeading = screen.getByRole("heading", { name: /create a room/i });
    expect(createHeading).toBeTruthy();

    const createButton = screen.getByRole("button", {
      name: /create a room/i,
    }) as HTMLButtonElement;
    expect(createButton.disabled).toBe(false);

    expect(screen.getByLabelText(/your display name/i)).toBeTruthy();
    expect(screen.getByLabelText(/invitation link or room code/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /continue to room/i })).toBeTruthy();
  });

  it("shows the join screen for an invitation route without a session", async () => {
    window.history.replaceState({}, "", "/join/AAAAAAAAAAAAAAAAAAAAAA");

    render(<App />);

    expect(await screen.findByText(/room unavailable/i)).toBeTruthy();
  });
});
