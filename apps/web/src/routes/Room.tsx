import { useEffect, useRef, useState } from "react";

import {
  CHAT_HISTORY_LIMIT,
  SOCKET_EVENTS,
  type ChatMessage,
  type ChatSendAck,
  type PublicParticipant,
  type RoomSnapshot,
} from "@tempass/shared";

import { ChatPanel } from "../components/ChatPanel";
import { Shell } from "../components/Shell";
import { roomErrorMessage } from "../lib/roomErrors";
import { navigate } from "../lib/router";
import { clearSession, type RoomSession } from "../lib/session";
import { connectRoomSocket, type RoomSocket } from "../realtime/socket";

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
  connecting: "border-slate-400/20 bg-slate-400/10 text-slate-300",
  connected: "border-emerald-400/20 bg-emerald-400/10 text-emerald-300",
  reconnecting: "border-amber-400/20 bg-amber-400/10 text-amber-200",
  error: "border-rose-400/20 bg-rose-400/10 text-rose-300",
};

export function Room({ roomId, session }: RoomProps) {
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [participants, setParticipants] = useState<PublicParticipant[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const socketRef = useRef<RoomSocket | null>(null);

  const inviteUrl = `${window.location.origin}/join/${roomId}`;

  useEffect(() => {
    const socket = connectRoomSocket(session.token);
    socketRef.current = socket;

    setStatus("connecting");
    setErrorMessage(null);

    socket.on("connect", () => {
      setStatus("connected");
      setErrorMessage(null);
    });

    socket.on("disconnect", (reason) => {
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

    socket.on("connect_error", (error) => {
      const code = (error as Error & { data?: { code?: string } }).data?.code;

      if (code === "UNAUTHORIZED" || code === "ROOM_NOT_FOUND") {
        setStatus("error");
        setErrorMessage(roomErrorMessage(code, error.message));
        clearSession(roomId);
        socket.disconnect();
        return;
      }

      setStatus("reconnecting");
    });

    socket.on(SOCKET_EVENTS.ROOM_SNAPSHOT, (nextSnapshot) => {
      setSnapshot(nextSnapshot);
      setParticipants(nextSnapshot.participants);
      setMessages(nextSnapshot.messages);
      setStatus("connected");
      setErrorMessage(null);
    });

    socket.on(SOCKET_EVENTS.PRESENCE_UPDATE, (update) => {
      setParticipants(update.participants);
    });

    socket.on(SOCKET_EVENTS.CHAT_MESSAGE, (message) => {
      setMessages((current) => {
        if (current.some((existing) => existing.id === message.id)) {
          return current;
        }

        const next = [...current, message];
        return next.length > CHAT_HISTORY_LIMIT ? next.slice(-CHAT_HISTORY_LIMIT) : next;
      });
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [roomId, session.token]);

  function sendChatMessage(text: string): Promise<ChatSendAck> {
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

      socket.emit(SOCKET_EVENTS.CHAT_MESSAGE, { text }, finish);
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

  const capacity = snapshot?.room.capacity ?? participants.length;
  const statusLabel = STATUS_LABELS[status];

  return (
    <Shell>
      <div className="flex flex-1 flex-col gap-4">
        <section className="flex flex-col justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-5 sm:flex-row sm:items-center">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Room</p>
            <h1 className="mt-1 font-mono text-xl font-semibold tracking-tight text-slate-100 sm:text-2xl">
              {roomId}
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              {participants.length} of {capacity} participants
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span
              aria-live="polite"
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${STATUS_STYLES[status]}`}
            >
              <span
                aria-hidden="true"
                className={`h-1.5 w-1.5 rounded-full ${
                  status === "connected"
                    ? "bg-emerald-400"
                    : status === "error"
                      ? "bg-rose-400"
                      : "bg-amber-300"
                }`}
              />
              {statusLabel}
            </span>

            <button
              type="button"
              onClick={handleLeave}
              className="h-9 rounded-lg border border-white/10 bg-white/5 px-4 text-sm font-medium text-slate-300 transition hover:bg-white/10"
            >
              Leave room
            </button>
          </div>
        </section>

        {status === "reconnecting" ? (
          <p
            role="status"
            className="rounded-xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100"
          >
            Connection lost. Tempass is trying to reconnect you to the room.
          </p>
        ) : null}

        {status === "error" ? (
          <section
            role="alert"
            className="rounded-xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100"
          >
            <p>{errorMessage ?? "Something went wrong."}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => navigate(`/join/${roomId}`)}
                className="rounded-lg bg-rose-500 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-400"
              >
                Join again
              </button>
              <button
                type="button"
                onClick={() => navigate("/")}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10"
              >
                Back home
              </button>
            </div>
          </section>
        ) : null}

        <div className="grid flex-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
          <div className="flex min-w-0 flex-col gap-4">
            <section
              aria-labelledby="room-stage-heading"
              className="rounded-2xl border border-white/10 bg-white/[0.03] p-5"
            >
              <h2 id="room-stage-heading" className="text-sm font-semibold text-slate-200">
                Watch together
              </h2>
              <p className="mt-1 text-sm text-slate-400">
                The YouTube player arrives in a later milestone.
              </p>

              <div className="mt-4 flex aspect-video items-center justify-center rounded-xl border border-dashed border-white/10 bg-slate-900/50 px-6 text-center">
                <div>
                  <p className="text-sm font-medium text-slate-300">Shared playback is next</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Room creation, invitation, presence, and chat are working now.
                  </p>
                </div>
              </div>
            </section>

            <ChatPanel
              messages={messages}
              selfId={session.participantId}
              connected={status === "connected"}
              onSend={sendChatMessage}
            />
          </div>

          <div className="flex flex-col gap-4">
            <section
              aria-labelledby="participants-heading"
              className="rounded-2xl border border-white/10 bg-white/[0.03] p-5"
            >
              <div className="flex items-baseline justify-between gap-3">
                <h2 id="participants-heading" className="text-sm font-semibold text-slate-200">
                  Participants
                </h2>
                <span className="text-xs text-slate-500">
                  {participants.length}/{capacity}
                </span>
              </div>

              <ul className="mt-3 space-y-2">
                {participants.map((participant) => {
                  const isSelf = participant.id === session.participantId;

                  return (
                    <li
                      key={participant.id}
                      className="flex items-center gap-3 rounded-xl border border-white/5 bg-slate-900/40 px-3 py-2"
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-rose-500/20 text-xs font-semibold uppercase text-rose-200">
                        {participant.displayName.slice(0, 1)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-slate-200">
                          {participant.displayName}
                          {isSelf ? <span className="ml-1 text-xs text-slate-500">(you)</span> : null}
                        </span>
                        <span className="block text-xs text-slate-500">
                          {participant.connected ? "Connected" : "Reconnecting…"}
                        </span>
                      </span>
                      <span
                        aria-hidden="true"
                        className={`h-2 w-2 rounded-full ${
                          participant.connected ? "bg-emerald-400" : "bg-amber-300"
                        }`}
                      />
                    </li>
                  );
                })}
              </ul>

              {participants.length === 1 ? (
                <p className="mt-3 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2 text-xs text-slate-500">
                  Waiting for the second person to join…
                </p>
              ) : null}
            </section>

            <section
              aria-labelledby="invite-heading"
              className="rounded-2xl border border-white/10 bg-white/[0.03] p-5"
            >
              <h2 id="invite-heading" className="text-sm font-semibold text-slate-200">
                Invitation link
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Share it with the other participant.
              </p>

              <label htmlFor="invite-link" className="sr-only">
                Invitation link
              </label>
              <input
                id="invite-link"
                readOnly
                value={inviteUrl}
                onFocus={(event) => event.currentTarget.select()}
                className="mt-3 h-10 w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 font-mono text-xs text-slate-300"
              />

              <button
                type="button"
                onClick={handleCopy}
                className="mt-3 h-9 w-full rounded-lg bg-rose-500 px-3 text-xs font-semibold text-white transition hover:bg-rose-400"
              >
                {copied ? "Copied" : "Copy invitation link"}
              </button>

              {copyError ? (
                <p role="alert" className="mt-2 text-xs text-rose-300">
                  {copyError}
                </p>
              ) : null}
            </section>
          </div>
        </div>
      </div>
    </Shell>
  );
}
