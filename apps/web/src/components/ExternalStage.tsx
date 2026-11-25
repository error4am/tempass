import { useEffect, useRef, useState, type ChangeEvent } from "react";

import type { BridgeCommand, BridgeState } from "@tempass/shared";

import { PauseIcon, PlayIcon } from "./Icons";

interface ExternalStageProps {
  bridge: BridgeState;
  stream?: MediaStream | null;
  connected: boolean;
  onCommand: (command: BridgeCommand) => void;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }

  const rounded = Math.floor(seconds);
  const hours = Math.floor(rounded / 3_600);
  const minutes = Math.floor((rounded % 3_600) / 60);
  const remaining = rounded % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
  }

  return `${minutes}:${String(remaining).padStart(2, "0")}`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "the source site";
  }
}

/** A ticking "now" so the seek bar can advance between server reports. */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);

    return () => window.clearInterval(timer);
  }, [intervalMs]);

  return now;
}

/**
 * Stage for videos that cannot be embedded. The picture lives on the source
 * website (in the presenter's tab); this panel is the room's remote control.
 */
export function ExternalStage({
  bridge,
  stream = null,
  connected,
  onCommand,
}: ExternalStageProps) {
  const [seekPreview, setSeekPreview] = useState<number | null>(null);
  const [pendingSeek, setPendingSeek] = useState<number | null>(null);
  const [syncedAt, setSyncedAt] = useState(() => Date.now());
  const [needsGesture, setNeedsGesture] = useState(false);
  const [framesArrived, setFramesArrived] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const element = videoRef.current;

    if (!element || !stream) {
      return;
    }

    element.srcObject = stream;
    setNeedsGesture(false);
    setFramesArrived(false);

    const played = element.play();

    if (played && typeof played.catch === "function") {
      played.catch(() => setNeedsGesture(true));
    }

    return () => {
      element.srcObject = null;
    };
  }, [stream]);

  const { status, positionSeconds, durationSeconds, source } = bridge;
  const playing = status === "playing";
  const rangeMaximum = durationSeconds > 0 ? durationSeconds : 0;

  // Advance the position locally between reports. Without this the seek bar
  // only moves in 2s steps, and every play/pause command carries a position
  // that is up to 2s stale — which makes the source tab seek backwards.
  const now = useNow(250);
  const elapsed =
    playing && pendingSeek === null
      ? Math.max(0, (now - syncedAt) / 1_000)
      : 0;
  const livePosition = pendingSeek ?? positionSeconds + elapsed;
  const position = seekPreview ?? livePosition;

  // A report close to the optimistic target confirms the seek; anything else
  // (or four seconds of silence) releases it so the truth wins again.
  useEffect(() => {
    setSyncedAt(Date.now());
    setPendingSeek((current) =>
      current === null || Math.abs(positionSeconds - current) <= 2
        ? null
        : current,
    );
  }, [positionSeconds, status, bridge.updatedAt]);

  useEffect(() => {
    if (pendingSeek === null) {
      return;
    }

    const timer = window.setTimeout(() => setPendingSeek(null), 4_000);

    return () => window.clearTimeout(timer);
  }, [pendingSeek]);

  function commitSeek(value: number) {
    setSeekPreview(null);
    setPendingSeek(value);
    setSyncedAt(Date.now());
    onCommand({ action: "seek", positionSeconds: value });
  }

  function handleSeekChange(event: ChangeEvent<HTMLInputElement>) {
    setSeekPreview(Number(event.currentTarget.value));
  }

  return (
    <div className="mt-4">
      <div className="relative aspect-video max-h-[75dvh] w-full overflow-hidden rounded-xl border border-white/[0.08] bg-black shadow-2xl shadow-black/60">
        {stream ? (
          <>
            <video
              ref={videoRef}
              className="h-full w-full object-contain"
              playsInline
              autoPlay
              onLoadedMetadata={() => setFramesArrived(true)}
            />

            {!framesArrived ? (
              <div className="absolute inset-0 flex items-center justify-center bg-[#0e0e10]/85 backdrop-blur-sm text-xs text-[#b8afb2]">
                Connecting to the presenter&apos;s tab…
              </div>
            ) : null}

            <span className="absolute left-3 top-3 rounded-full border border-[#4edea3]/30 bg-[#0e0e10]/85 px-3 py-1 font-mono text-[11px] font-medium text-[#4edea3] backdrop-blur-md">
              {playing ? "Live from source" : "Source paused"}
            </span>

            {needsGesture ? (
              <button
                type="button"
                onClick={() => {
                  const element = videoRef.current;

                  if (!element) {
                    return;
                  }

                  const played = element.play();

                  if (played && typeof played.catch === "function") {
                    played.catch(() => {});
                  }

                  setNeedsGesture(false);
                }}
                className="absolute inset-0 flex items-center justify-center bg-[#0e0e10]/80 text-sm font-semibold text-white backdrop-blur-sm"
              >
                Tap to start the shared tab
              </button>
            ) : null}
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 bg-[#0e0e10] px-6 text-center">
            <span className="rounded-full border border-[#4edea3]/25 bg-[#4edea3]/10 px-3 py-1 font-mono text-[11px] font-medium text-[#4edea3]">
              {playing ? "Playing live from source" : "Paused at source"}
            </span>

            <p className="max-w-sm font-display text-sm font-medium text-[#e5e1e4]">
              {source.title ?? "External video"}
            </p>

            <p className="font-mono text-xs text-[#8d8487]">{hostOf(source.url)}</p>

            <p className="max-w-xs text-xs text-[#8d8487]">
              The picture appears here once the presenter clicks{" "}
              <span className="text-[#e5e1e4]">Share this tab</span> in the
              companion badge. Keep that tab open.
            </p>
          </div>
        )}
      </div>

      <div className="mt-3 flex min-w-0 flex-col gap-3 rounded-xl border border-white/[0.08] bg-[#131315] p-3.5">
        <div className="flex items-center">
          <label htmlFor="bridge-position" className="sr-only">
            Source playback position
          </label>
          <input
            id="bridge-position"
            type="range"
            min={0}
            max={rangeMaximum}
            step={1}
            value={Math.min(position, rangeMaximum)}
            onChange={handleSeekChange}
            onPointerUp={(event) => commitSeek(Number(event.currentTarget.value))}
            onKeyUp={(event) => {
              if (
                event.key.startsWith("Arrow") ||
                event.key === "Home" ||
                event.key === "End" ||
                event.key.startsWith("Page")
              ) {
                commitSeek(Number(event.currentTarget.value));
              }
            }}
            disabled={!connected || rangeMaximum <= 0}
            className="h-1.5 w-full cursor-pointer accent-[#ff516a] disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>

        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() =>
                onCommand({
                  action: playing ? "pause" : "play",
                  positionSeconds: Math.round(livePosition),
                })
              }
              disabled={!connected}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-[#ff516a] px-3.5 text-xs font-semibold text-white shadow-[0_0_16px_-4px_rgba(255,81,106,0.45)] transition hover:bg-[#ea6479] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {playing ? (
                <PauseIcon className="h-3.5 w-3.5" />
              ) : (
                <PlayIcon className="h-3.5 w-3.5" />
              )}
              <span>{playing ? "Pause" : "Play"}</span>
            </button>

            <span className="shrink-0 font-mono text-xs tabular-nums">
              <span className="font-medium text-[#ffb2b7]">{formatTime(position)}</span>
              <span className="mx-1 text-[#6c666d]">/</span>
              <span className="text-[#b8afb2]">
                {durationSeconds > 0 ? formatTime(durationSeconds) : "--:--"}
              </span>
            </span>
          </div>

          <p className="font-mono text-[11px] text-[#8d8487]">
            {connected
              ? "Controls are relayed to the presenter's tab and apply for everyone."
              : "Reconnect to control playback."}
          </p>
        </div>
      </div>
    </div>
  );
}
