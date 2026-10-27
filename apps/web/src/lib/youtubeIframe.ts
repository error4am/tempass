export interface YouTubePlayerOptions {
  width?: string | number;
  height?: string | number;
  videoId?: string;
  playerVars?: Record<string, string | number>;
  events?: {
    onReady?: (event: { target: YouTubePlayer }) => void;
    onStateChange?: (event: { data: number; target: YouTubePlayer }) => void;
    onError?: (event: { data: number; target: YouTubePlayer }) => void;
  };
}

export interface YouTubePlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead?: boolean): void;
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
  loadVideoById(options: { videoId: string; startSeconds?: number }): void;
  cueVideoById(options: { videoId: string; startSeconds?: number }): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  destroy(): void;
}

export interface YouTubeIframeApi {
  Player: new (
    element: HTMLElement | string,
    options: YouTubePlayerOptions,
  ) => YouTubePlayer;
}

declare global {
  interface Window {
    YT?: YouTubeIframeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const YOUTUBE_IFRAME_API_SRC = "https://www.youtube.com/iframe_api";
const LOAD_TIMEOUT_MS = 15_000;

let apiPromise: Promise<YouTubeIframeApi> | null = null;

export function loadYouTubeIframeApi(): Promise<YouTubeIframeApi> {
  if (window.YT?.Player) {
    return Promise.resolve(window.YT);
  }

  if (apiPromise) {
    return apiPromise;
  }

  apiPromise = new Promise<YouTubeIframeApi>((resolve, reject) => {
    const previousReadyCallback = window.onYouTubeIframeAPIReady;
    let timer = 0;
    let settled = false;

    const cleanup = () => {
      window.clearTimeout(timer);
      script?.removeEventListener("error", handleScriptError);
    };

    const fail = (error: Error) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      window.onYouTubeIframeAPIReady = previousReadyCallback;
      script?.remove();
      apiPromise = null;
      reject(error);
    };

    const succeed = (api: YouTubeIframeApi) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      resolve(api);
    };

    const handleScriptError = () => {
      fail(new Error("Could not load the YouTube IFrame API"));
    };

    window.onYouTubeIframeAPIReady = () => {
      try {
        previousReadyCallback?.();
      } catch {}

      if (window.YT?.Player) {
        succeed(window.YT);
        return;
      }

      fail(new Error("YouTube IFrame API loaded without a player"));
    };

    const existingScript = document.querySelector<HTMLScriptElement>(
      `script[src="${YOUTUBE_IFRAME_API_SRC}"]`,
    );
    const script = existingScript ?? document.createElement("script");

    script.addEventListener("error", handleScriptError, { once: true });

    if (!existingScript) {
      script.src = YOUTUBE_IFRAME_API_SRC;
      script.async = true;
      document.head.appendChild(script);
    }

    timer = window.setTimeout(() => {
      fail(new Error("Timed out loading the YouTube IFrame API"));
    }, LOAD_TIMEOUT_MS);
  });

  return apiPromise;
}
