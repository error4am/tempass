import { useState, type ChangeEvent } from "react";

import type { BridgeCommand, BridgeState } from "@tempass/shared";

interface ExternalStageProps {
  bridge: BridgeState;
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

/**
 * Stage for videos that cannot be embedded. The picture lives on the source
 * website (in the presenter's tab); this panel is the room's remote control.
 */
export function ExternalStage({
  bridge,
  connected,
  onCommand,
}: ExternalStageProps) {
  const [seekPreview, setSeekPreview] = useState<number | null>(null);

  const { status, positionSeconds, durationSeconds, source } = bridge;
  const playing = status === "playing";
  const position = seekPreview ?? positionSeconds;
  const rangeMaximum = durationSeconds > 0 ? durationSeconds : 0;

  function commitSeek(value: number) {
    setSeekPreview(null);
    onCommand({ action: "seek", positionSeconds: value });
  }

  function handleSeekChange(event: ChangeEvent<HTMLInputElement>) {
    setSeekPreview(Number(event.currentTarget.value));
  }

  return (
    <div className="mt-4">
      <div className="relative flex aspect-video flex-col items-center justify-center gap-3 overflow-hidden rounded-xl border border-white/10 bg-slate-950 px-6 text-center">
        <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-300">
          {playing ? "Playing live from source" : "Paused at source"}
        </span>

        <p className="max-w-sm text-sm text-slate-300">
          {source.title ?? "External video"}
        </p>

        <p className="font-mono text-xs text-slate-500">{hostOf(source.url)}</p>

        <p className="max-w-xs text-xs text-slate-500">
          This site blocks embedding, so it plays in the presenter&apos;s tab.
          Their tab is the screen — keep it open.
        </p>
      </div>

      <div className="mt-3 flex min-w-0 flex-col gap-3 rounded-xl border border-white/5 bg-slate-950/40 p-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() =>
              onCommand({
                action: playing ? "pause" : "play",
                positionSeconds,
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
