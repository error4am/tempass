import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  CHAT_HISTORY_LIMIT,
  SOCKET_EVENTS,
  type ChatMessage,
  type ChatSendAck,
  type PlaybackCommand,
  type PlaybackCommandAck,
  type PublicParticipant,
  type RoomSnapshot,
} from "@tempass/shared";

import { ChatPanel } from "../components/ChatPanel";
import { CompanionCard } from "../components/CompanionCard";
import {
  CheckIcon,
  CopyIcon,
  KeyIcon,
  LinkIcon,
  PowerIcon,
  UsersIcon,
} from "../components/Icons";
import { Shell } from "../components/Shell";
import { WatchStage } from "../components/WatchStage";
import { createChatMediaLoader, uploadChatImage } from "../lib/media";
import { roomErrorMessage } from "../lib/roomErrors";
import { navigate } from "../lib/router";
import { clearSession, type RoomSession } from "../lib/session";
import { sendPlaybackCommand } from "../realtime/playback";
import { connectRoomSocket, type RoomSocket } from "../realtime/socket";
import { useRoomBridge } from "../realtime/useRoomBridge";
import { useRoomPlayback } from "../realtime/useRoomPlayback";
import { useRoomStream } from "../realtime/useRoomStream";
import { useServerClock } from "../realtime/useServerClock";
import { useTabShare } from "../realtime/useTabShare";

type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "error";

interface RoomProps {
  roomId: string;
  session: RoomSession;
}

const STATUS_LABELS: Record<ConnectionStatus, string> = {
  connecting: "Connecting…",
  connected: "Connected",
  reconnecting: "Reconnecting…",
  error: "Connection problem",
};

const STATUS_STYLES: Record<ConnectionStatus, string> = {
  connecting: "border-white/[0.08] bg-[#1c1b1d] text-[#b8afb2]",
  connected: "border-[#4edea3]/30 bg-[#4edea3]/10 text-[#4edea3]",
  reconnecting: "border-amber-400/30 bg-amber-400/10 text-amber-200",
  error: "border-rose-400/30 bg-rose-500/10 text-rose-300",
};

export function Room({ roomId, session }: RoomProps) {
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [participants, setParticipants] = useState<PublicParticipant[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [socket, setSocket] = useState<RoomSocket | null>(null);
  const socketRef = useRef<RoomSocket | null>(null);
  const { playback, applyUpdate } = useRoomPlayback(roomId, socket, snapshot);
  const { bridge, sendCommand: sendBridgeCommand } = useRoomBridge(roomId, socket);
  const stream = useRoomStream(socket);
  const tabShare = useTabShare(socket, session.participantId);
  const serverClock = useServerClock(roomId, socket);

  const mediaLoader = useMemo(
    () => createChatMediaLoader(roomId, session.token),
    [roomId, session.token],
  );

  useEffect(() => () => mediaLoader.dispose(), [mediaLoader]);

  const handleUploadImage = useCallback(
    (
      file: File,
      options: { onProgress: (fraction: number) => void; signal: AbortSignal },
    ) => uploadChatImage(roomId, session.token, file, options),
    [roomId, session.token],
  );

  const handlePlaybackCommand = useCallback(
    (command: PlaybackCommand): Promise<PlaybackCommandAck> =>
      sendPlaybackCommand(socket, command, { onAccepted: applyUpdate }),
    [applyUpdate, socket],
  );

  const inviteUrl = `${window.location.origin}/join/${roomId}`;

  useEffect(() => {
    const roomSocket = connectRoomSocket(session.token);
    socketRef.current = roomSocket;
    setSocket(roomSocket);

    setStatus("connecting");
    setErrorMessage(null);

    roomSocket.on("connect", () => {
      setStatus("connected");
      setErrorMessage(null);
    });

    roomSocket.on("disconnect", (reason) => {
      if (reason === "io client disconnect") {
        return;
      }

      if (reason === "io server disconnect") {
        setStatus("error");
        setErrorMessage("The room was closed by the server. Create a new room or join again.");
        clearSession(roomId);
        return;
      }

      setStatus("reconnecting");
    });

    roomSocket.on("connect_error", (error) => {
      const code = (error as Error & { data?: { code?: string } }).data?.code;

      if (code === "UNAUTHORIZED" || code === "ROOM_NOT_FOUND") {
        setStatus("error");
        setErrorMessage(roomErrorMessage(code, error.message));
        clearSession(roomId);
        roomSocket.disconnect();
        return;
      }

      setStatus("reconnecting");
    });

    roomSocket.on(SOCKET_EVENTS.ROOM_SNAPSHOT, (nextSnapshot) => {
      setSnapshot(nextSnapshot);
      setParticipants(nextSnapshot.participants);
      setMessages(nextSnapshot.messages);
      setStatus("connected");
      setErrorMessage(null);
    });

    roomSocket.on(SOCKET_EVENTS.PRESENCE_UPDATE, (update) => {
      setParticipants(update.participants);
    });

    roomSocket.on(SOCKET_EVENTS.CHAT_MESSAGE, (message) => {
      setMessages((current) => {
        if (current.some((existing) => existing.id === message.id)) {
          return current;
        }

        const next = [...current, message];
        return next.length > CHAT_HISTORY_LIMIT ? next.slice(-CHAT_HISTORY_LIMIT) : next;
      });
    });

    return () => {
      roomSocket.removeAllListeners();
      roomSocket.disconnect();
      socketRef.current = null;
      setSocket((current) => (current === roomSocket ? null : current));
    };
  }, [roomId, session.token]);

  function sendChatMessage(text: string, mediaId?: string): Promise<ChatSendAck> {
    const socket = socketRef.current;

    if (!socket?.connected) {
      return Promise.resolve({ ok: false, code: "UNAUTHORIZED" });
    }

    return new Promise((resolve) => {
      let settled = false;
      const timer = window.setTimeout(() => {
        finish({ ok: false, code: "INTERNAL" });
      }, 5_000);

      function finish(ack: ChatSendAck) {
        if (settled) {
          return;
        }

        settled = true;
        window.clearTimeout(timer);
        resolve(ack);
      }

      socket.emit(
        SOCKET_EVENTS.CHAT_MESSAGE,
        mediaId ? { text, mediaId } : { text },
        finish,
      );
    });
  }

  function handleLeave() {
    const socket = socketRef.current;
    let finished = false;

    const finish = () => {
      if (finished) {
        return;
      }

      finished = true;
      socket?.disconnect();
      clearSession(roomId);
      navigate("/");
    };

    if (socket?.connected) {
      socket.emit(SOCKET_EVENTS.ROOM_LEAVE, {}, finish);
      window.setTimeout(finish, 1_000);
    } else {
      finish();
    }
  }

  async function handleCopy() {
    setCopyError(null);

    try {
      if (!navigator.clipboard) {
        throw new Error("Clipboard unavailable");
      }

      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      setCopyError("Copy failed. Select the link and copy it manually.");
    }
  }

  const capacity = snapshot?.room.capacity ?? null;
  const statusLabel = STATUS_LABELS[status];

  const headerContent = (
    <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2.5 sm:justify-end">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="inline-flex max-w-[14rem] items-center gap-1.5 rounded-md border border-white/[0.08] bg-[#1c1b1d] px-2.5 py-1 font-mono text-[11px] text-[#b8afb2]">
          <span className="shrink-0 text-[#8d8487]">ROOM //</span>
          <code className="truncate text-[#e5e1e4]">{roomId}</code>
        </span>

        <span className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-[#1c1b1d] px-2.5 py-1 font-mono text-[11px] text-[#e5e1e4]">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[#4edea3]" />
          {participants.length}/{capacity ?? "—"} watching
        </span>

        <span
          aria-live="polite"
          className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[11px] font-medium ${STATUS_STYLES[status]}`}
        >
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 rounded-full ${
              status === "connected"
                ? "bg-[#4edea3]"
                : status === "error"
                  ? "bg-rose-400"
                  : "bg-amber-300"
            }`}
          />
          {statusLabel}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-white/[0.08] bg-[#201f22] px-3 font-mono text-[11px] font-medium text-[#e5e1e4] transition hover:bg-[#2a2a2c]"
        >
          {copied ? (
            <CheckIcon className="h-3.5 w-3.5 text-[#4edea3]" />
          ) : (
            <LinkIcon className="h-3.5 w-3.5 text-[#b8afb2]" />
          )}
          <span>{copied ? "Copied" : "Copy invite"}</span>
        </button>

        <button
          type="button"
          onClick={handleLeave}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-white/[0.08] bg-transparent px-3 font-mono text-[11px] font-medium text-[#b8afb2] transition hover:border-rose-400/30 hover:bg-rose-500/10 hover:text-rose-200"
        >
          <PowerIcon className="h-3.5 w-3.5" />
          <span>Leave room</span>
        </button>
      </div>
    </div>
  );

  return (
    <Shell wide headerContent={headerContent}>
      <div className="flex flex-1 flex-col gap-4">
        {status === "reconnecting" ? (
          <p
            role="status"
            className="rounded-xl border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-sm text-amber-100"
          >
            Connection lost. Tempass is trying to reconnect you to the room.
          </p>
        ) : null}

        {status === "error" ? (
          <section
            role="alert"
            className="rounded-xl border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-100"
          >
            <p>{errorMessage ?? "Something went wrong."}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => navigate(`/join/${roomId}`)}
                className="rounded-lg bg-[#ff516a] px-3 py-2 text-xs font-semibold text-white hover:bg-[#ea6479]"
              >
                Join again
              </button>
              <button
                type="button"
                onClick={() => navigate("/")}
                className="rounded-lg border border-white/[0.08] bg-[#201f22] px-3 py-2 text-xs font-semibold text-[#e5e1e4] hover:bg-[#2a2a2c]"
              >
                Back home
              </button>
            </div>
          </section>
        ) : null}

        <div className="grid min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(340px,24rem)] xl:grid-cols-[minmax(0,1fr)_minmax(360px,26rem)]">
          <WatchStage
            playback={playback}
            bridge={bridge}
            stream={stream}
            onBridgeCommand={sendBridgeCommand}
            companionSlot={<CompanionCard roomId={roomId} token={session.token} />}
            share={tabShare}
            connected={status === "connected"}
            clockOffsetMs={serverClock.offsetMs}
            onCommand={handlePlaybackCommand}
          />

          <div className="min-w-0 lg:relative lg:min-h-[36rem]">
            <div className="lg:absolute lg:inset-0">
              <ChatPanel
                messages={messages}
                selfId={session.participantId}
                connected={status === "connected"}
                onSend={sendChatMessage}
                onUploadImage={handleUploadImage}
                loadImageUrl={mediaLoader.load}
              />
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <section
            aria-labelledby="participants-heading"
            className="min-w-0 rounded-xl border border-white/[0.08] bg-[#1c1b1d] p-5"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <UsersIcon className="h-4 w-4 text-[#4edea3]" />
                <h2
                  id="participants-heading"
                  className="font-display text-sm font-semibold text-[#e5e1e4]"
                >
                  Participants
                </h2>
              </div>
              <span className="rounded-full border border-[#4edea3]/25 bg-[#4edea3]/10 px-2.5 py-0.5 font-mono text-[11px] font-medium text-[#4edea3]">
                {participants.length}/{capacity ?? "-"}
              </span>
            </div>

            <ul className="mt-3.5 space-y-2">
              {participants.map((participant) => {
                const isSelf = participant.id === session.participantId;

                return (
                  <li
                    key={participant.id}
                    className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-[#0e0e10] px-3.5 py-2.5"
                  >
                    <div className="relative shrink-0">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full border border-[#ff516a]/30 bg-[#ff516a]/18 text-xs font-semibold uppercase text-[#ffb2b7]">
                        {participant.displayName.slice(0, 1)}
                      </span>
                      <span
                        aria-hidden="true"
                        className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-[#0e0e10] ${
                          participant.connected ? "bg-[#4edea3]" : "bg-amber-300"
                        }`}
                      />
                    </div>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-[#e5e1e4]">
                        {participant.displayName}
                        {isSelf ? (
                          <span className="ml-1.5 font-mono text-[11px] font-normal text-[#ffb2b7]">
                            (you)
                          </span>
                        ) : null}
                      </span>
                      <span
                        className={`block font-mono text-[11px] ${
                          participant.connected ? "text-[#4edea3]" : "text-amber-300"
                        }`}
                      >
                        {participant.connected ? "Connected" : "Reconnecting…"}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>

            {participants.length === 1 ? (
              <p className="mt-3 rounded-lg border border-white/[0.06] bg-[#0e0e10]/70 px-3 py-2 text-xs text-[#8d8487]">
                Waiting for the second person to join…
              </p>
            ) : null}
          </section>

          <section
            aria-labelledby="invite-heading"
            className="flex min-w-0 flex-col justify-between gap-3 rounded-xl border border-white/[0.08] bg-[#1c1b1d] p-5"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <KeyIcon className="h-4 w-4 text-[#ff516a]" />
                <h2
                  id="invite-heading"
                  className="font-display text-sm font-semibold text-[#e5e1e4]"
                >
                  Invitation link
                </h2>
              </div>
              <span className="font-mono text-[11px] text-[#8d8487]">
                #{roomId.slice(0, 8)}
              </span>
            </div>

            <p className="text-xs text-[#b8afb2]">
              Share this private link with the other participant.
            </p>

            <div>
              <label htmlFor="invite-link" className="sr-only">
                Invitation link
              </label>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  id="invite-link"
                  readOnly
                  value={inviteUrl}
                  onFocus={(event) => event.currentTarget.select()}
                  className="h-10 min-w-0 flex-1 rounded-lg border border-white/[0.08] bg-[#0e0e10] px-3 font-mono text-xs text-[#e5e1e4] focus:border-[#ff516a]/60 focus:outline-none"
                />

                <button
                  type="button"
                  onClick={handleCopy}
                  className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-white/[0.08] bg-[#201f22] px-4 text-xs font-semibold text-[#e5e1e4] transition hover:bg-[#2a2a2c]"
                >
                  {copied ? (
                    <CheckIcon className="h-3.5 w-3.5 text-[#4edea3]" />
                  ) : (
                    <CopyIcon className="h-3.5 w-3.5 text-[#b8afb2]" />
                  )}
                  <span>{copied ? "Copied" : "Copy invitation link"}</span>
                </button>
              </div>
            </div>

            {copyError ? (
              <p role="alert" className="text-xs text-rose-300">
                {copyError}
              </p>
            ) : null}
          </section>
        </div>
      </div>
    </Shell>
  );
}
