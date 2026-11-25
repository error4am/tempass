import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

import type {
  BridgeCommand,
  BridgeState,
  PlaybackCommand,
  PlaybackCommandAck,
  PlaybackUpdate,
} from "@tempass/shared";

import { playbackErrorMessage } from "../lib/roomErrors";
import { parseYouTubeVideoId } from "../lib/youtube";
import type { TabShareController } from "../realtime/useTabShare";
import { ExternalStage } from "./ExternalStage";
import { FilmIcon, PlayIcon, ScreenShareIcon, YouTubeIcon } from "./Icons";
import { LiveTabStage } from "./LiveTabStage";
import { YouTubePlayer } from "./YouTubePlayer";

interface WatchStageProps {
  playback: PlaybackUpdate | null;
  bridge?: BridgeState | null;
  stream?: MediaStream | null;
  onBridgeCommand?: (command: BridgeCommand) => void;
  /** Extra content shown under the "Source video" panel, e.g. setup steps. */
  companionSlot?: ReactNode;
  /** Live tab sharing, when the room offers it. */
  share?: TabShareController | null;
  connected: boolean;
  clockOffsetMs?: number | null;
  onCommand: (command: PlaybackCommand) => Promise<PlaybackCommandAck>;
}

const PLAYBACK_STATUS_LABELS = {
  idle: "No video",
  paused: "Paused",
  playing: "Playing",
} as const;

export function WatchStage({
  playback,
  bridge = null,
  stream = null,
  onBridgeCommand,
  companionSlot = null,
  share = null,
  connected,
  clockOffsetMs = null,
  onCommand,
}: WatchStageProps) {
  const [videoInput, setVideoInput] = useState("");
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [tab, setTab] = useState<"youtube" | "external" | "live">("youtube");
  const mountedRef = useRef(true);
  const hadBridgeRef = useRef(false);
  const hadShareRef = useRef(false);

  // Jump to the source panel the first time a companion connects, but never
  // yank the user back if they switch tabs themselves.
  useEffect(() => {
    if (bridge && !hadBridgeRef.current) {
      hadBridgeRef.current = true;
      setTab("external");
    } else if (!bridge) {
      hadBridgeRef.current = false;
    }
  }, [bridge]);

  // Same for a live tab someone else starts presenting.
  useEffect(() => {
    const remoteShare = Boolean(share?.active && !share.presenting);

    if (remoteShare && !hadShareRef.current) {
      hadShareRef.current = true;
      setTab("live");
    } else if (!remoteShare) {
      hadShareRef.current = false;
    }
  }, [share?.active, share?.presenting]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  const videoId = playback?.state.videoId ?? null;
  const playbackStatus = playback?.state.status ?? "idle";
  const stageLabel = share?.active
    ? share.presenting
      ? "Sharing live"
      : `Live · ${share.active.presenterName}`
    : bridge
      ? bridge.status === "playing"
        ? "Playing"
        : "Paused"
      : PLAYBACK_STATUS_LABELS[playbackStatus];

  async function handleSelectVideo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (selecting) {
      return;
    }

    if (!connected) {
      setSelectionError("Reconnect to the room before selecting a video.");
      return;
    }

    const parsedVideoId = parseYouTubeVideoId(videoInput);

    if (!parsedVideoId) {
      setSelectionError("Enter a valid YouTube link or 11-character video ID.");
      return;
    }

    setSelecting(true);
    setSelectionError(null);

    try {
      const ack = await onCommand({
        action: "select",
        videoId: parsedVideoId,
      });

      if (!mountedRef.current) {
        return;
      }

      if (ack.ok) {
        setVideoInput("");
      } else {
        setSelectionError(playbackErrorMessage(ack.code));
      }
    } catch {
      if (mountedRef.current) {
        setSelectionError(playbackErrorMessage("INTERNAL"));
      }
    } finally {
      if (mountedRef.current) {
        setSelecting(false);
      }
    }
  }

  return (
    <section
      aria-labelledby="room-stage-heading"
      className="min-w-0 rounded-xl border border-white/[0.08] bg-[#1c1b1d] p-4 shadow-2xl shadow-black/30 sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <h2
            id="room-stage-heading"
            className="font-display text-base font-semibold tracking-tight text-[#e5e1e4]"
          >
            Watch together
          </h2>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-medium ${
              playbackStatus === "playing" || bridge?.status === "playing" || share?.active
                ? "border-[#ff516a]/30 bg-[#ff516a]/15 text-[#ffb2b7]"
                : "border-white/[0.08] bg-[#201f22] text-[#b8afb2]"
            }`}
          >
            {stageLabel}
          </span>
        </div>

        <div className="flex w-full gap-1 rounded-lg border border-white/[0.07] bg-[#0e0e10] p-1 sm:w-auto">
          <button
            type="button"
            aria-pressed={tab === "youtube"}
            onClick={() => setTab("youtube")}
            className={`inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md px-3 font-mono text-xs font-medium transition sm:flex-initial ${
              tab === "youtube"
                ? "bg-[#ff516a] text-white shadow-sm"
                : "text-[#b8afb2] hover:text-[#e5e1e4]"
            }`}
          >
            <YouTubeIcon className="h-3.5 w-3.5 shrink-0" />
            <span>YouTube</span>
          </button>
          <button
            type="button"
            aria-pressed={tab === "external"}
            onClick={() => setTab("external")}
            className={`inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md px-3 font-mono text-xs font-medium transition sm:flex-initial ${
              tab === "external"
                ? "bg-[#ff516a] text-white shadow-sm"
                : "text-[#b8afb2] hover:text-[#e5e1e4]"
            }`}
          >
            <FilmIcon className="h-3.5 w-3.5 shrink-0" />
            <span>Source video</span>
          </button>
          {share ? (
            <button
              type="button"
              aria-pressed={tab === "live"}
              onClick={() => setTab("live")}
              className={`inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md px-3 font-mono text-xs font-medium transition sm:flex-initial ${
                tab === "live"
                  ? "bg-[#ff516a] text-white shadow-sm"
                  : "text-[#b8afb2] hover:text-[#e5e1e4]"
              }`}
            >
              <ScreenShareIcon className="h-3.5 w-3.5 shrink-0" />
              <span>Live tab</span>
              {share.active ? (
                <span
                  aria-hidden="true"
                  className="ml-0.5 inline-block h-1.5 w-1.5 rounded-full bg-[#4edea3]"
                />
              ) : null}
            </button>
          ) : null}
        </div>
      </div>

      {tab === "youtube" ? (
        <>
          <form className="mt-3.5 flex min-w-0 flex-col gap-2 sm:flex-row" onSubmit={handleSelectVideo}>
            <label htmlFor="video-input" className="sr-only">
              YouTube link or video ID
            </label>
            <div className="relative flex min-w-0 flex-1 items-center">
              <PlayIcon className="pointer-events-none absolute left-3 h-4 w-4 text-[#ff516a]" />
              <input
                id="video-input"
                value={videoInput}
                onChange={(event) => {
                  setVideoInput(event.target.value);
                  setSelectionError(null);
                }}
                placeholder="Paste a YouTube link or video ID"
                autoComplete="off"
                spellCheck={false}
                disabled={!connected || selecting}
                aria-invalid={selectionError !== null}
                className="h-10 w-full min-w-0 rounded-lg border border-white/[0.08] bg-[#0e0e10] pl-9 pr-3 font-mono text-xs text-[#e5e1e4] placeholder:font-sans placeholder:text-sm placeholder:text-[#6c666d] focus:border-[#ff516a]/70 focus:outline-none focus:ring-2 focus:ring-[#ff516a]/20 disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>
            <button
              type="submit"
              disabled={!connected || selecting}
              className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-[#ff516a] px-4 text-sm font-semibold text-white shadow-[0_0_20px_-4px_rgba(255,81,106,0.4)] transition hover:bg-[#ea6479] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {selecting ? "Selecting…" : "Select video"}
            </button>
          </form>

          {selectionError ? (
            <p role="alert" className="mt-2 text-xs text-rose-300">
              {selectionError}
            </p>
          ) : null}

          {playback && videoId ? (
            <YouTubePlayer
              playback={playback}
              connected={connected}
              clockOffsetMs={clockOffsetMs}
              onCommand={onCommand}
            />
          ) : (
            <div className="mt-4 flex aspect-video max-h-[75dvh] w-full items-center justify-center rounded-xl border border-dashed border-white/[0.1] bg-[#0e0e10] px-6 text-center">
              <div className="flex flex-col items-center gap-2.5">
                <span className="flex h-12 w-12 items-center justify-center rounded-full border border-white/[0.08] bg-[#1c1b1d] text-[#ff516a]">
                  <YouTubeIcon className="h-5 w-5" />
                </span>
                <p className="font-display text-sm font-medium text-[#e5e1e4]">
                  No video selected
                </p>
                <p className="max-w-xs text-xs text-[#8d8487]">
                  Paste a YouTube link above to start watching together.
                </p>
              </div>
            </div>
          )}
        </>
      ) : tab === "external" ? (
        bridge && onBridgeCommand ? (
          <ExternalStage
            bridge={bridge}
            stream={stream}
            connected={connected}
            onCommand={onBridgeCommand}
          />
        ) : (
          <div className="mt-4 flex aspect-video max-h-[75dvh] w-full items-center justify-center rounded-xl border border-dashed border-white/[0.1] bg-[#0e0e10] px-6 text-center">
            <div className="flex flex-col items-center gap-2.5">
              <span className="flex h-12 w-12 items-center justify-center rounded-full border border-white/[0.08] bg-[#1c1b1d] text-[#b8afb2]">
                <FilmIcon className="h-5 w-5" />
              </span>
              <p className="font-display text-sm font-medium text-[#e5e1e4]">
                Nothing shared yet
              </p>
              <p className="max-w-xs text-xs text-[#8d8487]">
                Start the companion on the site that is playing the video.
              </p>
            </div>
          </div>
        )
      ) : share ? (
        <LiveTabStage share={share} connected={connected} />
      ) : null}

      {tab === "external" ? companionSlot : null}
    </section>
  );
}
