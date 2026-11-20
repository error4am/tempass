import { useEffect, useRef, useState, type ChangeEvent } from "react";

import type { BridgeCommand, BridgeState } from "@tempass/shared";

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
      <div className="relative aspect-video overflow-hidden rounded-xl border border-white/10 bg-black">
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
              <div className="absolute inset-0 flex items-center justify-center bg-slate-950/80 text-xs text-slate-400">
                Connecting to the presenter&apos;s tab…
              </div>
            ) : null}

            <span className="absolute left-3 top-3 rounded-full border border-emerald-400/30 bg-slate-950/80 px-3 py-1 text-xs font-medium text-emerald-300">
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
                className="absolute inset-0 flex items-center justify-center bg-slate-950/70 text-sm font-semibold text-white"
              >
                Tap to start the shared tab
              </button>
            ) : null}
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-300">
              {playing ? "Playing live from source" : "Paused at source"}
            </span>

            <p className="max-w-sm text-sm text-slate-300">
              {source.title ?? "External video"}
            </p>

            <p className="font-mono text-xs text-slate-500">{hostOf(source.url)}</p>

            <p className="max-w-xs text-xs text-slate-500">
              The picture appears here once the presenter clicks{" "}
              <span className="text-slate-400">Share this tab</span> in the
              companion badge. Keep that tab open.
            </p>
          </div>
        )}
      </div>

      <div className="mt-3 flex min-w-0 flex-col gap-3 rounded-xl border border-white/5 bg-slate-950/40 p-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() =>
              onCommand({
                action: playing ? "pause" : "play",
                positionSeconds: Math.round(livePosition),
              })
            }
            disabled={!connected}
            className="h-9 w-16 shrink-0 rounded-lg bg-rose-500 px-2 text-xs font-semibold text-white transition hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {playing ? "Pause" : "Play"}
          </button>

          <span className="shrink-0 font-mono text-xs tabular-nums text-slate-400">
            {formatTime(position)} /{" "}
            {durationSeconds > 0 ? formatTime(durationSeconds) : "--:--"}
          </span>

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
            className="min-w-[8rem] flex-1 accent-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>

        <p className="text-xs text-slate-500">
          {connected
            ? "Controls are relayed to the presenter's tab and apply for everyone."
            : "Reconnect to control playback."}
        </p>
      </div>
    </div>
  );
}
