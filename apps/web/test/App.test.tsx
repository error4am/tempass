import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import App from "../src/App";

afterEach(cleanup);

describe("App", () => {
  it("renders the Tempass landing page", () => {
    render(<App />);

    expect(screen.getByText("Tempass")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: /watch youtube together/i })).toBeTruthy();
    expect(screen.getByText(/private watch-party app/i)).toBeTruthy();
  });

  it("keeps room actions disabled in the skeleton", () => {
    render(<App />);

    const createButton = screen.getByRole("button", { name: /create a room/i }) as HTMLButtonElement;
    const joinButton = screen.getByRole("button", { name: /join a room/i }) as HTMLButtonElement;

    expect(createButton.disabled).toBe(true);
    expect(joinButton.disabled).toBe(true);
  });
});
