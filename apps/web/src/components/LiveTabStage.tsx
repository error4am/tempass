import { useEffect, useRef, useState } from "react";

import type { TabShareController } from "../realtime/useTabShare";
import { ScreenShareIcon } from "./Icons";

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
  const [slowConnect, setSlowConnect] = useState(false);

  // The viewer only learns that ICE failed by never getting a frame. Say so
  // instead of showing "Connecting…" forever. Once shown it stays until a real
  // frame lands, so a re-offer does not hide it again.
  useEffect(() => {
    if (framesArrived || !share.stream) {
      setSlowConnect(false);
      return;
    }

    if (slowConnect) {
      return;
    }

    const timer = window.setTimeout(() => setSlowConnect(true), 8_000);

    return () => window.clearTimeout(timer);
  }, [share.stream, framesArrived, slowConnect]);

  useEffect(() => {
    const element = videoRef.current;

    if (!element || !share.stream) {
      setFramesArrived(false);
      return;
    }

    element.srcObject = share.stream;
    setNeedsGesture(false);
    setFramesArrived(false);

    const played = element.play();

    if (played && typeof played.catch === "function") {
      played.catch(() => setNeedsGesture(true));
    }

    // "loadedmetadata" fires when the tracks are attached, before any picture
    // arrives, so wait for an actual frame instead.
    let cancelled = false;
    const mark = () => {
      if (!cancelled) {
        setFramesArrived(true);
      }
    };
    const frameVideo = element as HTMLVideoElement & {
      requestVideoFrameCallback?: (callback: () => void) => number;
    };

    if (typeof frameVideo.requestVideoFrameCallback === "function") {
      frameVideo.requestVideoFrameCallback(mark);
    } else {
      element.addEventListener("loadeddata", mark);
    }

    return () => {
      cancelled = true;
      element.removeEventListener("loadeddata", mark);
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
        <div className="relative aspect-video max-h-[75dvh] w-full overflow-hidden rounded-xl border border-white/[0.08] bg-black shadow-2xl shadow-black/60">
          {share.stream ? (
            <>
              <video
                ref={videoRef}
                className="h-full w-full object-contain"
                playsInline
                autoPlay
              />

              {!framesArrived ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#0e0e10]/85 px-6 text-center text-xs text-[#b8afb2] backdrop-blur-sm">
                  <span>Connecting to {share.active?.presenterName}&apos;s tab…</span>
                  {slowConnect ? (
                    <span className="max-w-sm text-amber-200">
                      Still connecting. The link may be blocked by one of your
                      networks — ask them to press Retry.
                    </span>
                  ) : null}
                </div>
              ) : null}

              <span className="absolute left-3 top-3 inline-flex items-center gap-2 rounded-full border border-[#ff516a]/40 bg-[#0e0e10]/85 px-3 py-1 font-mono text-[11px] font-medium text-[#ffb2b7] backdrop-blur-md">
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 rounded-full bg-[#ff516a]"
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
                  className="absolute inset-0 flex items-center justify-center bg-[#0e0e10]/80 text-sm font-semibold text-white backdrop-blur-sm"
                >
                  Tap to watch {share.active?.presenterName}&apos;s tab
                </button>
              ) : null}
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 bg-[#0e0e10] px-6 text-center">
              <span className="rounded-full border border-[#ff516a]/30 bg-[#ff516a]/12 px-3 py-1 font-mono text-[11px] font-medium text-[#ffb2b7]">
                Live tab
              </span>
              <p className="max-w-sm text-sm text-[#e5e1e4]">
                {share.active?.presenterName} is sharing{" "}
                {SURFACE_LABELS[share.active?.surface ?? "unknown"]}.
              </p>
              <p className="text-xs text-[#8d8487]">
                Waiting for the picture to arrive…
              </p>
            </div>
          )}
        </div>

        <p className="mt-3 text-xs text-[#8d8487]">
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
          ? "Connecting to the other participant… if this stays stuck, press Retry."
          : share.status === "starting"
            ? "Starting the preview…"
            : "They see exactly this preview.";

    return (
      <div className="mt-4">
        <div className="relative aspect-video max-h-[75dvh] w-full overflow-hidden rounded-xl border border-[#ff516a]/35 bg-black shadow-2xl shadow-black/60">
          {share.previewStream ? (
            <video
              ref={previewRef}
              className="h-full w-full object-contain"
              playsInline
              autoPlay
              muted
            />
          ) : (
            <div className="flex h-full items-center justify-center bg-[#0e0e10] text-xs text-[#b8afb2]">
              Starting the preview…
            </div>
          )}

          <span className="absolute left-3 top-3 inline-flex items-center gap-2 rounded-full border border-[#ff516a]/40 bg-[#0e0e10]/85 px-3 py-1 font-mono text-[11px] font-semibold text-[#ffb2b7] backdrop-blur-md">
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 rounded-full bg-[#ff516a]"
            />
            LIVE · you
          </span>

          <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.08] bg-[#0e0e10]/90 px-3.5 py-2.5 backdrop-blur-md">
            <p className="min-w-0 text-xs text-[#e5e1e4]">{statusText}</p>
            <div className="flex shrink-0 items-center gap-2">
              {share.status === "connecting" ? (
                <button
                  type="button"
                  onClick={share.retry}
                  className="h-8 rounded-lg border border-white/[0.1] bg-[#201f22] px-3 text-xs font-semibold text-[#e5e1e4] transition hover:bg-[#2a2a2c]"
                >
                  Retry
                </button>
              ) : null}
              <button
                type="button"
                onClick={share.stop}
                className="h-8 rounded-lg bg-[#ff516a] px-3 text-xs font-semibold text-white transition hover:bg-[#ea6479]"
              >
                Stop sharing
              </button>
            </div>
          </div>
        </div>

        <p className="mt-3 text-xs text-[#8d8487]">
          You are sharing {SURFACE_LABELS[share.surface]}. The preview is muted
          here; the other person hears the tab audio. Switching tabs does not
          change what they see.
        </p>

        {share.audioMissing ? (
          <p
            role="status"
            className="mt-3 rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-xs text-amber-100"
          >
            No tab audio was captured. Stop and share again with{" "}
            <span className="text-amber-200">Share tab audio</span> ticked if
            they should hear it.
          </p>
        ) : null}

        <p className="mt-3 text-xs text-[#8d8487]">
          Chrome&apos;s sharing bar also stops the stream. Closing or reloading
          this room ends it too.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4">
      <div className="flex aspect-video max-h-[75dvh] w-full flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-white/[0.1] bg-[#0e0e10] px-6 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full border border-white/[0.08] bg-[#1c1b1d] text-[#ff516a]">
          <ScreenShareIcon className="h-5 w-5" />
        </span>

        <div>
          <p className="font-display text-sm font-medium text-[#e5e1e4]">
            Show the other person a tab
          </p>
          <p className="mt-1 max-w-md text-xs text-[#8d8487]">
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
          className="h-10 rounded-lg bg-[#ff516a] px-5 text-sm font-semibold text-white shadow-[0_0_20px_-4px_rgba(255,81,106,0.4)] transition hover:bg-[#ea6479] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {share.status === "starting" ? "Waiting for the picker…" : "Share this tab"}
        </button>

        <p className="font-mono text-[11px] text-[#6c666d]">
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
