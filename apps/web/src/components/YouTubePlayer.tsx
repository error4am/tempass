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
  PLAYBACK_RATES,
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
import { PauseIcon, PlayIcon, VolumeOffIcon, VolumeOnIcon } from "./Icons";

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

/** The room's speed is authoritative; nudge the player only when it differs. */
function applyPlaybackRate(player: YouTubePlayerInstance, rate: number): void {
  const nextRate =
    Number.isFinite(rate) && rate > 0 ? rate : 1;

  try {
    if (Math.abs(player.getPlaybackRate() - nextRate) < 0.01) {
      return;
    }
  } catch {
    /* fall through and try to set it */
  }

  try {
    player.setPlaybackRate(nextRate);
  } catch {
    /* some videos only allow 1× */
  }
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

      // Keep the player at the room's speed even after a seek or a rebuffer.
      applyPlaybackRate(player, state.rate ?? 1);

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

        applyPlaybackRate(player, state.rate ?? 1);

        return;
      }

      if (appliedRevisionRef.current === state.revision) {
        return;
      }

      appliedRevisionRef.current = state.revision;

      applyPlaybackRate(player, state.rate ?? 1);

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

  function handleRateChange(event: ChangeEvent<HTMLSelectElement>) {
    const nextRate = Number(event.currentTarget.value);
    const videoId = playbackRef.current.state.videoId;

    if (!videoId || !connected || !Number.isFinite(nextRate)) {
      return;
    }

    const player = playerRef.current;
    const positionSeconds = clampPosition(
      player
        ? readPlayerPosition(player)
        : expectedPositionFor(playbackRef.current),
    );

    void runCommand({
      action: "rate",
      videoId,
      positionSeconds,
      rate: nextRate,
    });
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

    applyPlaybackRate(player, playbackRef.current.state.rate ?? 1);
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
  const rate = playback.state.rate ?? 1;
  const rateOptions = (PLAYBACK_RATES as readonly number[]).includes(rate)
    ? PLAYBACK_RATES
    : [...PLAYBACK_RATES, rate].sort((a, b) => a - b);
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
      <div className="relative aspect-video max-h-[75dvh] w-full overflow-hidden rounded-xl border border-white/[0.08] bg-black shadow-2xl shadow-black/60">
        <div
          ref={mountRef}
          className="pointer-events-none absolute inset-0"
        />

        {apiStatus === "loading" ? (
          <div className="absolute inset-0 flex items-center justify-center bg-[#0e0e10]/70 px-6 text-center backdrop-blur-sm">
            <p role="status" className="font-mono text-xs text-[#e5e1e4]">
              Loading the YouTube player…
            </p>
          </div>
        ) : null}

        {apiStatus === "error" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0e0e10]/85 px-6 text-center backdrop-blur-sm">
            <p role="alert" className="text-sm text-rose-200">
              The YouTube player could not be loaded.
            </p>
            <button
              type="button"
              onClick={handleRetryPlayer}
              className="rounded-lg border border-white/[0.1] bg-[#201f22] px-3.5 py-2 text-xs font-semibold text-[#e5e1e4] transition hover:bg-[#2a2a2c]"
            >
              Retry player
            </button>
          </div>
        ) : null}

        {apiStatus === "ready" && !playerReady && !playerError ? (
          <div className="absolute inset-0 flex items-center justify-center bg-[#0e0e10]/70 px-6 text-center backdrop-blur-sm">
            <p role="status" className="font-mono text-xs text-[#e5e1e4]">
              Preparing the video…
            </p>
          </div>
        ) : null}

        {playerError ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0e0e10]/85 px-6 text-center backdrop-blur-sm">
            <p role="alert" className="max-w-sm text-sm text-rose-200">
              {playerError}
            </p>
            <button
              type="button"
              onClick={handleRetryPlayer}
              className="rounded-lg border border-white/[0.1] bg-[#201f22] px-3.5 py-2 text-xs font-semibold text-[#e5e1e4] transition hover:bg-[#2a2a2c]"
            >
              Retry player
            </button>
          </div>
        ) : null}

        {autoplayBlocked && !playerError ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0e0e10]/80 px-6 text-center backdrop-blur-sm">
            <p className="max-w-sm text-sm text-[#e5e1e4]">
              Your browser paused playback for this tab.
            </p>
            <button
              type="button"
              onClick={handleJoinPlayback}
              className="rounded-lg bg-[#ff516a] px-4 py-2 text-sm font-semibold text-white shadow-[0_0_20px_-4px_rgba(255,81,106,0.45)] transition hover:bg-[#ea6479]"
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
              className="rounded-full border border-white/[0.1] bg-[#0e0e10]/85 px-3 py-1 font-mono text-[11px] text-[#e5e1e4] backdrop-blur-md"
            >
              Buffering…
            </span>
          </div>
        ) : null}
      </div>

      <div className="mt-3 flex min-w-0 flex-col gap-3 rounded-xl border border-white/[0.08] bg-[#131315] p-3.5">
        <div className="flex items-center">
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
            className="h-1.5 w-full cursor-pointer accent-[#ff516a] disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>

        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={handleTogglePlayback}
              disabled={controlsDisabled}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-[#ff516a] px-3.5 text-xs font-semibold text-white shadow-[0_0_16px_-4px_rgba(255,81,106,0.45)] transition hover:bg-[#ea6479] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPlaying ? (
                <PauseIcon className="h-3.5 w-3.5" />
              ) : (
                <PlayIcon className="h-3.5 w-3.5" />
              )}
              <span>{playLabel}</span>
            </button>

            <button
              type="button"
              onClick={handleToggleMute}
              disabled={controlsDisabled}
              aria-pressed={muted}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-white/[0.08] bg-[#201f22] px-3 text-xs font-semibold text-[#e5e1e4] transition hover:bg-[#2a2a2c] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {muted ? (
                <VolumeOffIcon className="h-3.5 w-3.5 text-[#b8afb2]" />
              ) : (
                <VolumeOnIcon className="h-3.5 w-3.5 text-[#b8afb2]" />
              )}
              <span>{muted ? "Unmute" : "Mute"}</span>
            </button>

            <span className="shrink-0 font-mono text-xs tabular-nums">
              <span className="font-medium text-[#ffb2b7]">
                {formatTime(displayPosition)}
              </span>
              <span className="mx-1 text-[#6c666d]">/</span>
              <span className="text-[#b8afb2]">
                {duration > 0 ? formatTime(duration) : "--:--"}
              </span>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="hidden items-center gap-1.5 rounded-md border border-[#4edea3]/20 bg-[#4edea3]/10 px-2.5 py-1 font-mono text-[11px] text-[#4edea3] xl:inline-flex">
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 rounded-full bg-[#4edea3]"
              />
              {connected
                ? "Synced with room"
                : "Reconnect to control playback."}
            </span>

            <label htmlFor="playback-rate" className="sr-only">
              Playback speed
            </label>
            <select
              id="playback-rate"
              value={rate}
              onChange={handleRateChange}
              disabled={controlsDisabled}
              title="Playback speed (shared with everyone)"
              className="h-8 shrink-0 rounded-md border border-white/[0.08] bg-[#201f22] px-2 font-mono text-xs font-semibold text-[#e5e1e4] transition hover:bg-[#2a2a2c] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {rateOptions.map((option) => (
                <option
                  key={option}
                  value={option}
                  className="bg-[#18181b] text-[#e5e1e4]"
                >
                  {option}×
                </option>
              ))}
            </select>

            <span className="rounded-md border border-white/[0.06] bg-[#0e0e10] px-2 py-1 font-mono text-[11px] text-[#8d8487]">
              {videoId}
            </span>
          </div>
        </div>

        <p className="text-[11px] text-[#8d8487] xl:hidden">
          {connected
            ? "Playback changes are shared with everyone in the room."
            : "Reconnect to control playback."}
        </p>
      </div>

      {commandError ? (
        <p role="alert" className="mt-2 text-xs text-rose-300">
          {commandError}
        </p>
      ) : null}
    </div>
  );
}
