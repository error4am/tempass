import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";

import {
  MAX_PLAYBACK_POSITION_SECONDS,
  type PlaybackCommand,
  type PlaybackCommandAck,
  type PlaybackUpdate,
} from "@tempass/shared";

import { clientTimeToServerTime } from "../lib/clockSync";
import {
  PLAYING_DRIFT_THRESHOLD_SECONDS,
  calculatePlaybackDrift,
  playbackDriftExceedsThreshold,
  projectPlaybackPosition,
} from "../lib/playback";
import { playbackErrorMessage } from "../lib/roomErrors";
import {
  loadYouTubeIframeApi,
  type YouTubeIframeApi,
  type YouTubePlayer as YouTubePlayerInstance,
} from "../lib/youtubeIframe";

type ApiStatus = "loading" | "ready" | "error";

interface YouTubePlayerProps {
  playback: PlaybackUpdate;
  connected: boolean;
  clockOffsetMs?: number | null;
  onCommand: (command: PlaybackCommand) => Promise<PlaybackCommandAck>;
}

const PLAYER_STATE_ENDED = 0;
const PLAYER_STATE_PLAYING = 1;
const PLAYER_STATE_PAUSED = 2;
const PLAYER_STATE_BUFFERING = 3;
const PLAYER_STATE_CUED = 5;

export const DRIFT_CHECK_INTERVAL_MS = 5_000;
export const AUTOPLAY_CHECK_DELAY_MS = 1_000;
export const POSITION_TICK_MS = 500;

const PLAYER_ERROR_MESSAGES: Record<number, string> = {
  2: "This video could not be played. Check the link or choose another video.",
  5: "The YouTube player hit an error. Try loading the video again.",
  100: "This video is unavailable or private.",
  101: "The video owner does not allow embedding.",
  150: "The video owner does not allow embedding.",
};

function playerErrorMessage(code: number): string {
  return (
    PLAYER_ERROR_MESSAGES[code] ??
    `This video could not be played (YouTube error ${code}).`
  );
}

function clampPosition(value: number, maximum = MAX_PLAYBACK_POSITION_SECONDS): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(Math.max(0, value), maximum);
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }

  const rounded = Math.floor(seconds);
  const hours = Math.floor(rounded / 3_600);
  const minutes = Math.floor((rounded % 3_600) / 60);
  const remainingSeconds = rounded % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function readPlayerPosition(player: YouTubePlayerInstance): number {
  try {
    return clampPosition(player.getCurrentTime());
  } catch {
    return 0;
  }
}

function readPlayerDuration(player: YouTubePlayerInstance): number {
  try {
    const duration = player.getDuration();
    return Number.isFinite(duration) && duration > 0
      ? Math.min(duration, MAX_PLAYBACK_POSITION_SECONDS)
      : 0;
  } catch {
    return 0;
  }
}

function readPlayerState(player: YouTubePlayerInstance): number {
  try {
    return player.getPlayerState();
  } catch {
    return -1;
  }
}

function pausePlayer(player: YouTubePlayerInstance): void {
  try {
    player.pauseVideo();
  } catch {}
}

function seekPlayer(player: YouTubePlayerInstance, positionSeconds: number): void {
  try {
    player.seekTo(clampPosition(positionSeconds), true);
  } catch {}
}

export function YouTubePlayer({
  playback,
  connected,
  clockOffsetMs = null,
  onCommand,
}: YouTubePlayerProps) {
  const [apiStatus, setApiStatus] = useState<ApiStatus>("loading");
  const [apiAttempt, setApiAttempt] = useState(0);
  const [playerReady, setPlayerReady] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [muted, setMuted] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [ended, setEnded] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [seekPreview, setSeekPreview] = useState<number | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const mountRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<YouTubeIframeApi | null>(null);
  const playerRef = useRef<YouTubePlayerInstance | null>(null);
  const playbackRef = useRef(playback);
  const loadedVideoIdRef = useRef<string | null>(null);
  const appliedRevisionRef = useRef<number | null>(null);
  const autoplayTimerRef = useRef(0);
  const seekPreviewRef = useRef<number | null>(null);
  const pendingRef = useRef(false);
  const mountedRef = useRef(true);
  const clockOffsetRef = useRef<number | null>(clockOffsetMs);
  const updateReceivedAtRef = useRef(Date.now());
  const lastPlaybackRef = useRef<PlaybackUpdate | null>(null);
  const playerReadyRef = useRef(false);
  const playerErrorRef = useRef<string | null>(null);
  const isBufferingRef = useRef(false);
  const autoplayBlockedRef = useRef(false);
  const endedRef = useRef(false);
  const needsReconcileRef = useRef(false);
  const endHandledRef = useRef(false);
  const connectedRef = useRef(connected);
  connectedRef.current = connected;
  const runCommandRef = useRef<((command: PlaybackCommand) => Promise<void>) | null>(null);
  runCommandRef.current = runCommand;

  playbackRef.current = playback;
  clockOffsetRef.current = clockOffsetMs;

  if (lastPlaybackRef.current !== playback) {
    lastPlaybackRef.current = playback;
    updateReceivedAtRef.current = Date.now();
  }

  playerReadyRef.current = playerReady;
  playerErrorRef.current = playerError;
  isBufferingRef.current = isBuffering;
  autoplayBlockedRef.current = autoplayBlocked;
  endedRef.current = ended;

  const expectedPositionFor = useCallback(
    (update: PlaybackUpdate, clientNow = Date.now()): number => {
      const offset = clockOffsetRef.current;
      const serverNow =
        offset !== null && Number.isFinite(offset)
          ? clientTimeToServerTime(clientNow, offset)
          : update.serverTime +
            Math.max(0, clientNow - updateReceivedAtRef.current);

      return clampPosition(
        projectPlaybackPosition(update.state, serverNow),
      );
    },
    [],
  );

  const clearAutoplayCheck = useCallback(() => {
    if (autoplayTimerRef.current) {
      window.clearTimeout(autoplayTimerRef.current);
      autoplayTimerRef.current = 0;
    }
  }, []);

  const attemptPlay = useCallback(() => {
    const player = playerRef.current;

    if (!player) {
      return;
    }

    clearAutoplayCheck();
    setAutoplayBlocked(false);
    autoplayBlockedRef.current = false;

    autoplayTimerRef.current = window.setTimeout(() => {
      autoplayTimerRef.current = 0;
      const activePlayer = playerRef.current;

      if (!activePlayer || !mountedRef.current) {
        return;
      }

      const state = readPlayerState(activePlayer);

      if (state !== PLAYER_STATE_PLAYING && state !== PLAYER_STATE_BUFFERING) {
        setAutoplayBlocked(true);
        autoplayBlockedRef.current = true;
        setIsBuffering(false);
      }
    }, AUTOPLAY_CHECK_DELAY_MS);

    try {
      player.playVideo();
    } catch {
      clearAutoplayCheck();
      setAutoplayBlocked(true);
      autoplayBlockedRef.current = true;
      setIsBuffering(false);
    }
  }, [clearAutoplayCheck]);

  const correctLatestPlayback = useCallback(
    (ensureTransport: boolean) => {
      const player = playerRef.current;
      const update = playbackRef.current;

      if (
        !player ||
        !update ||
        !playerReadyRef.current ||
        playerErrorRef.current ||
        endedRef.current ||
        autoplayBlockedRef.current ||
        seekPreviewRef.current !== null ||
        pendingRef.current
      ) {
        return;
      }

      const state = update.state;
      const videoId = state.videoId;

      if (!videoId || loadedVideoIdRef.current !== videoId) {
        return;
      }

      const playerState = readPlayerState(player);

      // Defensive guard: if the player is not yet playing and we're being
      // called with ensureTransport (e.g. from handlePlayerStateChange), do not
      // spuriously attempt to play or pause. The applyCanonicalPlayback
      // effect is responsible for triggering play; a mid-state player that is
      // buffering or cued must not be re-interfered with by the drift check.
      if (ensureTransport && playerState !== PLAYER_STATE_PLAYING) {
        if (playerState === PLAYER_STATE_CUED) {
          return;
        }
        if (playerState === PLAYER_STATE_PAUSED) {
          return;
        }
      }

      if (
        playerState === PLAYER_STATE_BUFFERING ||
        playerState === PLAYER_STATE_ENDED ||
        isBufferingRef.current
      ) {
        return;
      }

      // If the player is already playing and the canonical state changed to paused
      // mid-transition, do not spuriously attempt to pause. The
      // applyCanonicalPlayback effect is responsible for triggering pause; a
      // mid-state player that is playing must not be re-interfered with by the
      // drift check.
      if (state.status === "paused" && playerState === PLAYER_STATE_PLAYING) {
        return;
      }

      const expectedPosition = expectedPositionFor(update);
      const actualPosition = readPlayerPosition(player);
      const drift = calculatePlaybackDrift(expectedPosition, actualPosition);
      if (playbackDriftExceedsThreshold(state.status, drift)) {
        seekPlayer(player, expectedPosition);
        setCurrentTime(expectedPosition);
      }

      if (!ensureTransport) {
        return;
      }

      if (state.status === "playing") {
        if (playerState !== PLAYER_STATE_PLAYING) {
          attemptPlay();
        }
      } else if (
        playerState !== PLAYER_STATE_PAUSED &&
        playerState !== PLAYER_STATE_CUED
      ) {
        pausePlayer(player);
        setIsPlaying(false);
      }
    },
    [attemptPlay, expectedPositionFor],
  );

  const applyCanonicalPlayback = useCallback(
    (update: PlaybackUpdate) => {
      const player = playerRef.current;

      if (!player) {
        return;
      }

      const state = update.state;
      const videoId = state.videoId;

      if (!videoId) {
        clearAutoplayCheck();
        needsReconcileRef.current = false;
        pausePlayer(player);
        setIsPlaying(false);
        setIsBuffering(false);
        return;
      }

      const targetPosition = expectedPositionFor(update);

      if (loadedVideoIdRef.current !== videoId) {
        loadedVideoIdRef.current = videoId;
        appliedRevisionRef.current = state.revision;
        needsReconcileRef.current = false;
        setPlayerError(null);
        playerErrorRef.current = null;
        setCommandError(null);
        setEnded(false);
        endedRef.current = false;
        endHandledRef.current = false;
        setAutoplayBlocked(false);
        autoplayBlockedRef.current = false;
        setIsBuffering(true);
        isBufferingRef.current = true;
        setIsPlaying(false);
        setCurrentTime(targetPosition);
        setDuration(0);
        seekPreviewRef.current = null;
        setSeekPreview(null);

        try {
          player.cueVideoById({
            videoId,
            startSeconds: targetPosition,
          });
        } catch {
          setPlayerError("The YouTube player could not load this video.");
          playerErrorRef.current =
            "The YouTube player could not load this video.";
          setIsBuffering(false);
          isBufferingRef.current = false;
          return;
        }

        if (state.status === "playing") {
          attemptPlay();
        } else {
          clearAutoplayCheck();
          pausePlayer(player);
        }

        return;
      }

      if (appliedRevisionRef.current === state.revision) {
        return;
      }

      appliedRevisionRef.current = state.revision;

      const playerState = readPlayerState(player);
      const buffering = playerState === PLAYER_STATE_BUFFERING;
      const drift = calculatePlaybackDrift(
        targetPosition,
        readPlayerPosition(player),
      );

      if (state.status === "playing") {
        clearAutoplayCheck();
        setEnded(false);
        endedRef.current = false;
        endHandledRef.current = false;

        if (buffering) {
          needsReconcileRef.current = true;
          return;
        }

        if (playbackDriftExceedsThreshold(state.status, drift)) {
          seekPlayer(player, targetPosition);
          setCurrentTime(targetPosition);
        }

        attemptPlay();
        return;
      }

      clearAutoplayCheck();
      pausePlayer(player);
      setAutoplayBlocked(false);
      autoplayBlockedRef.current = false;
      setIsPlaying(false);
      setIsBuffering(false);
      isBufferingRef.current = false;

      if (buffering) {
        needsReconcileRef.current = true;
        return;
      }

      needsReconcileRef.current = false;

      if (playbackDriftExceedsThreshold(state.status, drift)) {
        seekPlayer(player, targetPosition);
      }

      setCurrentTime(targetPosition);
    },
    [attemptPlay, clearAutoplayCheck, expectedPositionFor],
  );

  const handlePlayerStateChange = useCallback(
    (state: number) => {
      if (!mountedRef.current) {
        return;
      }

      const wasBuffering = isBufferingRef.current;

      switch (state) {
        case PLAYER_STATE_PLAYING:
          clearAutoplayCheck();
          setAutoplayBlocked(false);
          autoplayBlockedRef.current = false;
          setIsBuffering(false);
          isBufferingRef.current = false;
          setIsPlaying(true);
          setEnded(false);
          endedRef.current = false;
          endHandledRef.current = false;

          if (wasBuffering || needsReconcileRef.current) {
            needsReconcileRef.current = false;
            correctLatestPlayback(true);
          }
          break;
        case PLAYER_STATE_PAUSED:
          setIsBuffering(false);
          isBufferingRef.current = false;
          setIsPlaying(false);
          endHandledRef.current = false;

          if (wasBuffering || needsReconcileRef.current) {
            needsReconcileRef.current = false;
            correctLatestPlayback(true);
          }
          break;
        case PLAYER_STATE_BUFFERING:
          setIsBuffering(true);
          isBufferingRef.current = true;
          break;
        case PLAYER_STATE_CUED:
          setIsBuffering(false);
          isBufferingRef.current = false;
          setIsPlaying(false);
          endHandledRef.current = false;

          if (wasBuffering || needsReconcileRef.current) {
            needsReconcileRef.current = false;
            correctLatestPlayback(true);
          }
          break;
        case PLAYER_STATE_ENDED:
          if (endHandledRef.current) {
            break;
          }

          endHandledRef.current = true;
          clearAutoplayCheck();
          setAutoplayBlocked(false);
          autoplayBlockedRef.current = false;
          needsReconcileRef.current = false;
          setIsBuffering(false);
          isBufferingRef.current = false;
          setIsPlaying(false);
          setEnded(true);
          endedRef.current = true;

          const player = playerRef.current;

          if (player) {
            setCurrentTime(readPlayerDuration(player));
          }

          const videoId = playbackRef.current.state.videoId;

          if (connectedRef.current && videoId && player) {
            const durationSeconds = readPlayerDuration(player);
            const positionSeconds =
              durationSeconds > 0 ? durationSeconds : readPlayerPosition(player);

            void runCommandRef.current?.({
              action: "pause",
              videoId,
              positionSeconds,
            });
          }
          break;
        default:
          setIsBuffering(false);
          isBufferingRef.current = false;
          setIsPlaying(false);

          if (wasBuffering || needsReconcileRef.current) {
            needsReconcileRef.current = false;
            correctLatestPlayback(true);
          }
          break;
      }
    },
    [clearAutoplayCheck, correctLatestPlayback],
  );

  const handlePlayerError = useCallback(
    (code: number) => {
      if (!mountedRef.current) {
        return;
      }

      clearAutoplayCheck();
      needsReconcileRef.current = false;
      setAutoplayBlocked(false);
      autoplayBlockedRef.current = false;
      setIsBuffering(false);
      isBufferingRef.current = false;
      setIsPlaying(false);
      const message = playerErrorMessage(code);
      setPlayerError(message);
      playerErrorRef.current = message;
    },
    [clearAutoplayCheck],
  );

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      clearAutoplayCheck();

      const player = playerRef.current;
      playerRef.current = null;

      try {
        player?.destroy();
      } catch {}

      mountRef.current?.replaceChildren();
    };
  }, [clearAutoplayCheck]);

  useEffect(() => {
    let cancelled = false;

    setApiStatus("loading");

    loadYouTubeIframeApi()
      .then((api) => {
        if (cancelled) {
          return;
        }

        apiRef.current = api;
        setApiStatus("ready");
      })
      .catch(() => {
        if (cancelled) {
          return;
        }

        apiRef.current = null;
        setApiStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [apiAttempt]);

  useEffect(() => {
    if (apiStatus !== "ready" || playerRef.current) {
      return;
    }

    const api = apiRef.current;
    const mount = mountRef.current;
    const initialVideoId = playbackRef.current.state.videoId;

    if (!api || !mount || !initialVideoId) {
      return;
    }

    setPlayerReady(false);
    playerReadyRef.current = false;
    setPlayerError(null);
    playerErrorRef.current = null;
    setIsBuffering(true);
    isBufferingRef.current = true;
    setEnded(false);
    endedRef.current = false;
    setAutoplayBlocked(false);
    autoplayBlockedRef.current = false;
    needsReconcileRef.current = false;

    const target = document.createElement("div");
    target.className = "h-full w-full";
    mount.replaceChildren(target);

    let player: YouTubePlayerInstance;

    try {
      player = new api.Player(target, {
        videoId: initialVideoId,
        width: "100%",
        height: "100%",
        playerVars: {
          autoplay: 0,
          controls: 0,
          disablekb: 1,
          playsinline: 1,
          rel: 0,
          modestbranding: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: () => {
            if (playerRef.current !== player || !mountedRef.current) {
              return;
            }

            loadedVideoIdRef.current = initialVideoId;
            appliedRevisionRef.current = null;
            playerReadyRef.current = true;
            setPlayerReady(true);
            applyCanonicalPlayback(playbackRef.current);
          },
          onStateChange: (event) => {
            handlePlayerStateChange(event.data);
          },
          onError: (event) => {
            handlePlayerError(event.data);
          },
        },
      });
    } catch {
      const message = "The YouTube player could not start. Try again.";
      setPlayerError(message);
      playerErrorRef.current = message;
      setIsBuffering(false);
      isBufferingRef.current = false;
      return;
    }

    playerRef.current = player;
    loadedVideoIdRef.current = initialVideoId;
    appliedRevisionRef.current = null;
  }, [
    apiStatus,
    applyCanonicalPlayback,
    handlePlayerError,
    handlePlayerStateChange,
  ]);

  useEffect(() => {
    if (playerReady) {
      applyCanonicalPlayback(playback);
    }
  }, [applyCanonicalPlayback, playback, playerReady]);

  useEffect(() => {
    if (!playerReady || playerError) {
      return;
    }

    const timer = window.setInterval(() => {
      correctLatestPlayback(false);
    }, DRIFT_CHECK_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [correctLatestPlayback, playerError, playerReady]);

  useEffect(() => {
    if (!playerReady || playerError) {
      return;
    }

    const updatePosition = () => {
      const player = playerRef.current;

      if (!player) {
        return;
      }

      setCurrentTime(readPlayerPosition(player));
      setDuration(readPlayerDuration(player));
    };

    updatePosition();
    const timer = window.setInterval(updatePosition, POSITION_TICK_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [playerError, playerReady]);

  async function runCommand(command: PlaybackCommand): Promise<void> {
    if (pendingRef.current) {
      return;
    }

    pendingRef.current = true;
    setPending(true);
    setCommandError(null);

    try {
      const ack = await onCommand(command);

      if (!mountedRef.current) {
        return;
      }

      if (!ack.ok) {
        setCommandError(playbackErrorMessage(ack.code));
      }
    } catch {
      if (mountedRef.current) {
        setCommandError(playbackErrorMessage("INTERNAL"));
      }
    } finally {
      pendingRef.current = false;

      if (mountedRef.current) {
        setPending(false);
      }
    }
  }

  function handleTogglePlayback() {
    const videoId = playbackRef.current.state.videoId;

    if (!videoId || !connected) {
      return;
    }

    const player = playerRef.current;
    const positionSeconds = ended
      ? 0
      : clampPosition(
          player
            ? readPlayerPosition(player)
            : expectedPositionFor(playbackRef.current),
        );

    void runCommand(
      isPlaying
        ? { action: "pause", videoId, positionSeconds }
        : { action: "play", videoId, positionSeconds },
    );
  }

  function handleToggleMute() {
    const player = playerRef.current;

    if (!player) {
      return;
    }

    try {
      if (player.isMuted()) {
        player.unMute();
        setMuted(false);
      } else {
        player.mute();
        setMuted(true);
      }
    } catch {}
  }

  function handleJoinPlayback() {
    const player = playerRef.current;

    if (!player) {
      return;
    }

    const targetPosition = expectedPositionFor(playbackRef.current);
    const drift = calculatePlaybackDrift(
      targetPosition,
      readPlayerPosition(player),
    );

    if (Math.abs(drift) > PLAYING_DRIFT_THRESHOLD_SECONDS) {
      seekPlayer(player, targetPosition);
      setCurrentTime(targetPosition);
    }

    attemptPlay();
  }

  function handleSeekChange(event: ChangeEvent<HTMLInputElement>) {
    const nextPosition = clampPosition(Number(event.currentTarget.value));
    seekPreviewRef.current = nextPosition;
    setSeekPreview(nextPosition);
  }

  function commitSeek(value?: number) {
    const currentPreview = seekPreviewRef.current;

    if (currentPreview === null) {
      return;
    }

    const nextPosition =
      value === undefined ? currentPreview : clampPosition(value);

    seekPreviewRef.current = null;
    setSeekPreview(null);

    const videoId = playbackRef.current.state.videoId;

    if (!videoId || !connected) {
      return;
    }

    void runCommand({
      action: "seek",
      videoId,
      positionSeconds: nextPosition,
    });
  }

  function handleSeekKeyUp(event: KeyboardEvent<HTMLInputElement>) {
    if (
      event.key === "ArrowLeft" ||
      event.key === "ArrowRight" ||
      event.key === "ArrowUp" ||
      event.key === "ArrowDown" ||
      event.key === "Home" ||
      event.key === "End" ||
      event.key === "PageUp" ||
      event.key === "PageDown"
    ) {
      commitSeek(Number(event.currentTarget.value));
    }
  }

  function handleRetryPlayer() {
    const player = playerRef.current;
    playerRef.current = null;

    try {
      player?.destroy();
    } catch {}

    mountRef.current?.replaceChildren();
    clearAutoplayCheck();
    loadedVideoIdRef.current = null;
    appliedRevisionRef.current = null;
    seekPreviewRef.current = null;
    needsReconcileRef.current = false;
    setSeekPreview(null);
    setPlayerReady(false);
    playerReadyRef.current = false;
    setPlayerError(null);
    playerErrorRef.current = null;
    setMuted(false);
    setAutoplayBlocked(false);
    autoplayBlockedRef.current = false;
    setIsBuffering(false);
    isBufferingRef.current = false;
    setIsPlaying(false);
    setEnded(false);
    endedRef.current = false;
    setCommandError(null);
    setApiAttempt((attempt) => attempt + 1);
  }

  const videoId = playback.state.videoId;
  const rangeMaximum = duration > 0 ? duration : MAX_PLAYBACK_POSITION_SECONDS;
  const displayPosition = seekPreview ?? currentTime;
  const controlsDisabled =
    !connected ||
    !playerReady ||
    pending ||
    playerError !== null ||
    videoId === null;
  const playLabel = isPlaying ? "Pause" : ended ? "Replay" : "Play";

  return (
    <div className="mt-4">
      <div className="relative aspect-video overflow-hidden rounded-xl border border-white/10 bg-black">
        <div
          ref={mountRef}
          className="pointer-events-none absolute inset-0"
        />

        {apiStatus === "loading" ? (
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
            <p role="status" className="text-sm text-slate-300">
              Loading the YouTube player…
            </p>
          </div>
        ) : null}

        {apiStatus === "error" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
            <p role="alert" className="text-sm text-rose-200">
              The YouTube player could not be loaded.
            </p>
            <button
              type="button"
              onClick={handleRetryPlayer}
              className="rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-xs font-semibold text-slate-100 transition hover:bg-white/15"
            >
              Retry player
            </button>
          </div>
        ) : null}

        {apiStatus === "ready" && !playerReady && !playerError ? (
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
            <p role="status" className="text-sm text-slate-300">
              Preparing the video…
            </p>
          </div>
        ) : null}

        {playerError ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-950/80 px-6 text-center">
            <p role="alert" className="max-w-sm text-sm text-rose-200">
              {playerError}
            </p>
            <button
              type="button"
              onClick={handleRetryPlayer}
              className="rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-xs font-semibold text-slate-100 transition hover:bg-white/15"
            >
              Retry player
            </button>
          </div>
        ) : null}

        {autoplayBlocked && !playerError ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-950/75 px-6 text-center">
            <p className="max-w-sm text-sm text-slate-200">
              Your browser paused playback for this tab.
            </p>
            <button
              type="button"
              onClick={handleJoinPlayback}
              className="rounded-lg bg-rose-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-400"
            >
              Tap to join playback
            </button>
          </div>
        ) : null}

        {isBuffering &&
        !autoplayBlocked &&
        !playerError &&
        apiStatus === "ready" ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-3">
            <span
              role="status"
              className="rounded-full border border-white/10 bg-slate-950/80 px-3 py-1 text-xs text-slate-200"
            >
              Buffering…
            </span>
          </div>
        ) : null}
      </div>

      <div className="mt-3 flex min-w-0 flex-col gap-3 rounded-xl border border-white/5 bg-slate-950/40 p-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleTogglePlayback}
            disabled={controlsDisabled}
            className="h-9 w-16 shrink-0 rounded-lg bg-rose-500 px-2 text-xs font-semibold text-white transition hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {playLabel}
          </button>

          <button
            type="button"
            onClick={handleToggleMute}
            disabled={controlsDisabled}
            aria-pressed={muted}
            className="h-9 w-16 shrink-0 rounded-lg border border-white/10 bg-white/5 px-2 text-xs font-semibold text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {muted ? "Unmute" : "Mute"}
          </button>

          <span className="shrink-0 font-mono text-xs tabular-nums text-slate-400">
            {formatTime(displayPosition)} / {duration > 0 ? formatTime(duration) : "--:--"}
          </span>

          <label htmlFor="playback-position" className="sr-only">
            Playback position
          </label>
          <input
            id="playback-position"
            type="range"
            min={0}
            max={rangeMaximum}
            step={1}
            value={Math.min(displayPosition, rangeMaximum)}
            onChange={handleSeekChange}
            onPointerUp={(event) =>
              commitSeek(Number(event.currentTarget.value))
            }
            onKeyUp={handleSeekKeyUp}
            onBlur={(event) => commitSeek(Number(event.currentTarget.value))}
            disabled={controlsDisabled || duration <= 0}
            aria-valuetext={`${formatTime(displayPosition)} of ${duration > 0 ? formatTime(duration) : "unknown duration"}`}
            className="min-w-[8rem] flex-1 accent-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <span className="truncate">
            {connected
              ? "Playback changes are shared with everyone in the room."
              : "Reconnect to control playback."}
          </span>
          <span className="font-mono text-slate-400">{videoId}</span>
        </div>
      </div>

      {commandError ? (
        <p role="alert" className="mt-2 text-xs text-rose-300">
          {commandError}
        </p>
      ) : null}
    </div>
  );
}
