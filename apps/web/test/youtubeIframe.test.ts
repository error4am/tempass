import { afterEach, describe, expect, it, vi } from "vitest";

import type { YouTubeIframeApi } from "../src/lib/youtubeIframe";

const YOUTUBE_IFRAME_API_SRC = "https://www.youtube.com/iframe_api";

function createApi(): YouTubeIframeApi {
  return {
    Player: vi.fn(),
  } as unknown as YouTubeIframeApi;
}

async function importLoader() {
  vi.resetModules();
  return import("../src/lib/youtubeIframe");
}

afterEach(() => {
  vi.useRealTimers();
  delete window.YT;
  delete window.onYouTubeIframeAPIReady;
  document.head.replaceChildren();
});

describe("loadYouTubeIframeApi", () => {
  it("uses an already loaded player without injecting another script", async () => {
    const api = createApi();
    window.YT = api;
    const { loadYouTubeIframeApi } = await importLoader();

    await expect(loadYouTubeIframeApi()).resolves.toBe(api);
    expect(
      document.querySelector(`script[src="${YOUTUBE_IFRAME_API_SRC}"]`),
    ).toBeNull();
  });

  it("shares one script and one ready callback across concurrent calls", async () => {
    const api = createApi();
    const previousReady = vi.fn();
    window.onYouTubeIframeAPIReady = previousReady;
    const { loadYouTubeIframeApi } = await importLoader();

    const first = loadYouTubeIframeApi();
    const second = loadYouTubeIframeApi();
    const scripts = document.querySelectorAll<HTMLScriptElement>(
      `script[src="${YOUTUBE_IFRAME_API_SRC}"]`,
    );

    expect(first).toBe(second);
    expect(scripts).toHaveLength(1);

    window.YT = api;
    window.onYouTubeIframeAPIReady?.();

    await expect(first).resolves.toBe(api);
    await expect(second).resolves.toBe(api);
    expect(previousReady).toHaveBeenCalledTimes(1);
  });

  it("reuses an existing script and rejects when that script fails", async () => {
    const existing = document.createElement("script");
    existing.src = YOUTUBE_IFRAME_API_SRC;
    document.head.appendChild(existing);
    const { loadYouTubeIframeApi } = await importLoader();

    const loading = loadYouTubeIframeApi();
    const assertion = expect(loading).rejects.toThrow(
      "Could not load the YouTube IFrame API",
    );

    existing.dispatchEvent(new Event("error"));
    await assertion;

    expect(existing.isConnected).toBe(false);
    expect(window.onYouTubeIframeAPIReady).toBeUndefined();
  });

  it("can retry after a failed load", async () => {
    const firstApi = createApi();
    const { loadYouTubeIframeApi } = await importLoader();
    const failed = loadYouTubeIframeApi();
    const assertion = expect(failed).rejects.toThrow(
      "Could not load the YouTube IFrame API",
    );
    const firstScript = document.querySelector<HTMLScriptElement>(
      `script[src="${YOUTUBE_IFRAME_API_SRC}"]`,
    );

    firstScript?.dispatchEvent(new Event("error"));
    await assertion;

    const retry = loadYouTubeIframeApi();
    const secondScript = document.querySelector<HTMLScriptElement>(
      `script[src="${YOUTUBE_IFRAME_API_SRC}"]`,
    );

    expect(secondScript).not.toBeNull();
    expect(secondScript).not.toBe(firstScript);

    window.YT = firstApi;
    window.onYouTubeIframeAPIReady?.();

    await expect(retry).resolves.toBe(firstApi);
  });

  it("rejects when the API loads without a Player constructor", async () => {
    const { loadYouTubeIframeApi } = await importLoader();
    const loading = loadYouTubeIframeApi();
    const assertion = expect(loading).rejects.toThrow(
      "YouTube IFrame API loaded without a player",
    );

    window.onYouTubeIframeAPIReady?.();

    await assertion;
  });

  it("times out and cleans up when the script never becomes ready", async () => {
    vi.useFakeTimers();
    const { loadYouTubeIframeApi } = await importLoader();

    const loading = loadYouTubeIframeApi();
    const assertion = expect(loading).rejects.toThrow(
      "Timed out loading the YouTube IFrame API",
    );

    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;

    expect(
      document.querySelector(`script[src="${YOUTUBE_IFRAME_API_SRC}"]`),
    ).toBeNull();
    expect(window.onYouTubeIframeAPIReady).toBeUndefined();
  });
});
