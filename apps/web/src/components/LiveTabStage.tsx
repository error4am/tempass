import { useEffect, useRef, useState } from "react";

import type { TabShareController } from "../realtime/useTabShare";

interface LiveTabStageProps {
  share: TabShareController;
  connected: boolean;
}

const SURFACE_LABELS = {
  browser: "a browser tab",
  window: "an app window",
  monitor: "your entire screen",
  unknown: "a tab",
} as const;

/**
 * Stage for the general "show me your tab" mode. Unlike the source-video
 * stage there is no remote control: the presenter drives, the other person
 * only watches.
 */
export function LiveTabStage({ share, connected }: LiveTabStageProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const [needsGesture, setNeedsGesture] = useState(false);
  const [framesArrived, setFramesArrived] = useState(false);

  useEffect(() => {
    const element = videoRef.current;

    if (!element || !share.stream) {
      return;
    }

    element.srcObject = share.stream;
    setNeedsGesture(false);
    setFramesArrived(false);

    const played = element.play();

    if (played && typeof played.catch === "function") {
      played.catch(() => setNeedsGesture(true));
    }

    return () => {
      element.srcObject = null;
    };
  }, [share.stream]);

  // The presenter's own preview of the capture. Always muted: the shared tab
  // already plays its audio on this machine, so unmuting would echo.
  useEffect(() => {
    const element = previewRef.current;

    if (!element || !share.previewStream) {
      return;
    }

    element.srcObject = share.previewStream;

    const played = element.play();

    if (played && typeof played.catch === "function") {
      played.catch(() => {});
    }

    return () => {
      element.srcObject = null;
    };
    // `presenting` is part of the key because the capture exists before the
    // server confirms it, and the <video> only mounts once confirmation lands.
  }, [share.previewStream, share.presenting]);

  const viewer = share.active !== null && !share.presenting;
  const presenter = share.presenting;

  if (viewer) {
    return (
      <div className="mt-4">
        <div className="relative aspect-video overflow-hidden rounded-xl border border-white/10 bg-black">
          {share.stream ? (
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
                  Connecting to {share.active?.presenterName}&apos;s tab…
                </div>
              ) : null}

              <span className="absolute left-3 top-3 inline-flex items-center gap-2 rounded-full border border-rose-400/40 bg-slate-950/80 px-3 py-1 text-xs font-medium text-rose-200">
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 rounded-full bg-rose-400"
                />
                Live · {share.active?.presenterName}
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
                  Tap to watch {share.active?.presenterName}&apos;s tab
                </button>
              ) : null}
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <span className="rounded-full border border-rose-400/30 bg-rose-400/10 px-3 py-1 text-xs font-medium text-rose-200">
                Live tab
              </span>
              <p className="max-w-sm text-sm text-slate-300">
                {share.active?.presenterName} is sharing{" "}
                {SURFACE_LABELS[share.active?.surface ?? "unknown"]}.
              </p>
              <p className="text-xs text-slate-500">
                Waiting for the picture to arrive…
              </p>
            </div>
          )}
        </div>

        <p className="mt-3 text-xs text-slate-500">
          You are watching {share.active?.presenterName}&apos;s tab. Only they
          can change what it shows.
        </p>
      </div>
    );
  }

  if (presenter) {
    const statusText =
      share.status === "waiting"
        ? "Nobody is watching right now — nothing is being sent."
        : share.status === "connecting"
          ? "Connecting to the other participant…"
          : share.status === "starting"
            ? "Starting the preview…"
            : "They see exactly this preview.";

    return (
      <div className="mt-4">
        <div className="relative aspect-video max-h-[46vh] w-full overflow-hidden rounded-xl border border-rose-400/30 bg-black">
          {share.previewStream ? (
            <video
              ref={previewRef}
              className="h-full w-full object-contain"
              playsInline
              autoPlay
              muted
            />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-slate-400">
              Starting the preview…
            </div>
          )}

          <span className="absolute left-3 top-3 inline-flex items-center gap-2 rounded-full border border-rose-400/40 bg-slate-950/80 px-3 py-1 text-xs font-semibold text-rose-100">
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 rounded-full bg-rose-400"
            />
            LIVE · you
          </span>

          <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-center justify-between gap-2 bg-slate-950/85 px-3 py-2">
            <p className="min-w-0 text-xs text-slate-300">{statusText}</p>
            <button
              type="button"
              onClick={share.stop}
              className="h-8 shrink-0 rounded-lg bg-rose-500 px-3 text-xs font-semibold text-white transition hover:bg-rose-400"
            >
              Stop sharing
            </button>
          </div>
        </div>

        <p className="mt-3 text-xs text-slate-500">
          You are sharing {SURFACE_LABELS[share.surface]}. The preview is muted
          here; the other person hears the tab audio. Switching tabs does not
          change what they see.
        </p>

        {share.audioMissing ? (
          <p
            role="status"
            className="mt-3 rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs text-amber-100"
          >
            No tab audio was captured. Stop and share again with{" "}
            <span className="text-amber-200">Share tab audio</span> ticked if
            they should hear it.
          </p>
        ) : null}

        <p className="mt-3 text-xs text-slate-500">
          Chrome&apos;s sharing bar also stops the stream. Closing or reloading
          this room ends it too.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4">
      <div className="flex aspect-video max-h-[46vh] w-full flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-white/10 bg-slate-900/50 px-6 text-center">
        <div>
          <p className="text-sm font-medium text-slate-300">
            Show the other person a tab
          </p>
          <p className="mt-1 max-w-md text-xs text-slate-500">
            Pick one browser tab and they watch it live, including whatever you
            scroll to. They cannot click or control it.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            void share.start();
          }}
          disabled={!connected || share.status === "starting"}
          className="h-10 rounded-lg bg-rose-500 px-5 text-sm font-semibold text-white transition hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {share.status === "starting" ? "Waiting for the picker…" : "Share this tab"}
        </button>

        <p className="text-[11px] text-slate-600">
          Desktop Chrome or Edge only. Your screen is never shared unless you
          pick it.
        </p>
      </div>

      {share.error ? (
        <p role="alert" className="mt-3 text-xs text-rose-300">
          {share.error}
        </p>
      ) : null}
    </div>
  );
}
