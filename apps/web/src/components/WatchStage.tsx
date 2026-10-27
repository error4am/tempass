import { useEffect, useRef, useState, type FormEvent } from "react";

import type {
  PlaybackCommand,
  PlaybackCommandAck,
  PlaybackUpdate,
} from "@tempass/shared";

import { playbackErrorMessage } from "../lib/roomErrors";
import { parseYouTubeVideoId } from "../lib/youtube";
import { YouTubePlayer } from "./YouTubePlayer";

interface WatchStageProps {
  playback: PlaybackUpdate | null;
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
  connected,
  clockOffsetMs = null,
  onCommand,
}: WatchStageProps) {
  const [videoInput, setVideoInput] = useState("");
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const mountedRef = useRef(true);

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
          {PLAYBACK_STATUS_LABELS[playbackStatus]}
        </span>
      </div>

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
        <div className="mt-4 flex aspect-video items-center justify-center rounded-xl border border-dashed border-white/10 bg-slate-900/50 px-6 text-center">
          <div>
            <p className="text-sm font-medium text-slate-300">No video selected</p>
            <p className="mt-1 text-xs text-slate-500">
              Paste a YouTube link above to start watching together.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
