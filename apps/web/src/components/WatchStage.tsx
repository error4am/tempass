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
import { ExternalStage } from "./ExternalStage";
import { YouTubePlayer } from "./YouTubePlayer";

interface WatchStageProps {
  playback: PlaybackUpdate | null;
  bridge?: BridgeState | null;
  stream?: MediaStream | null;
  onBridgeCommand?: (command: BridgeCommand) => void;
  /** Extra content shown under the "Share a tab" panel, e.g. setup steps. */
  companionSlot?: ReactNode;
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
  connected,
  clockOffsetMs = null,
  onCommand,
}: WatchStageProps) {
  const [videoInput, setVideoInput] = useState("");
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [tab, setTab] = useState<"youtube" | "external">("youtube");
  const mountedRef = useRef(true);
  const hadBridgeRef = useRef(false);

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

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  const videoId = playback?.state.videoId ?? null;
  const playbackStatus = playback?.state.status ?? "idle";

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
      className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.03] p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="room-stage-heading" className="text-sm font-semibold text-slate-200">
          Watch together
        </h2>
        <span className="text-xs text-slate-500">
          {bridge ? (bridge.status === "playing" ? "Playing" : "Paused") : PLAYBACK_STATUS_LABELS[playbackStatus]}
        </span>
      </div>

      <div className="mt-3 flex gap-1 rounded-lg border border-white/10 bg-slate-950/60 p-1">
        <button
          type="button"
          aria-pressed={tab === "youtube"}
          onClick={() => setTab("youtube")}
          className={`h-8 flex-1 rounded-md px-3 text-xs font-semibold transition ${
            tab === "youtube"
              ? "bg-white/10 text-slate-100"
              : "text-slate-500 hover:text-slate-300"
          }`}
        >
          YouTube
        </button>
        <button
          type="button"
          aria-pressed={tab === "external"}
          onClick={() => setTab("external")}
          className={`h-8 flex-1 rounded-md px-3 text-xs font-semibold transition ${
            tab === "external"
              ? "bg-white/10 text-slate-100"
              : "text-slate-500 hover:text-slate-300"
          }`}
        >
          Share a tab
        </button>
      </div>

      {tab === "youtube" ? (
        <>
          <form className="mt-3 flex min-w-0 flex-col gap-2 sm:flex-row" onSubmit={handleSelectVideo}>
        <label htmlFor="video-input" className="sr-only">
          YouTube link or video ID
        </label>
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
          className="h-10 min-w-0 flex-1 rounded-lg border border-white/10 bg-slate-900/70 px-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-rose-400/60 focus:outline-none focus:ring-2 focus:ring-rose-400/20 disabled:cursor-not-allowed disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={!connected || selecting}
          className="h-10 shrink-0 rounded-lg bg-rose-500 px-4 text-sm font-semibold text-white transition hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-60"
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
        <div className="mt-4 flex aspect-video max-h-[46vh] w-full items-center justify-center rounded-xl border border-dashed border-white/10 bg-slate-900/50 px-6 text-center">
          <div>
            <p className="text-sm font-medium text-slate-300">No video selected</p>
            <p className="mt-1 text-xs text-slate-500">
              Paste a YouTube link above to start watching together.
            </p>
          </div>
        </div>
      )}
        </>
      ) : bridge && onBridgeCommand ? (
        <ExternalStage
          bridge={bridge}
          stream={stream}
          connected={connected}
          onCommand={onBridgeCommand}
        />
      ) : (
        <div className="mt-4 flex aspect-video max-h-[46vh] w-full items-center justify-center rounded-xl border border-dashed border-white/10 bg-slate-900/50 px-6 text-center">
          <div>
            <p className="text-sm font-medium text-slate-300">Nothing shared yet</p>
            <p className="mt-1 text-xs text-slate-500">
              Start the companion on the site that is playing the video.
            </p>
          </div>
        </div>
      )}

      {tab === "external" ? companionSlot : null}
    </section>
  );
}
