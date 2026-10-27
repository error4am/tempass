import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import {
  MAX_CHAT_MESSAGE_LENGTH,
  type ChatMessage,
  type ChatSendAck,
} from "@tempass/shared";

import { chatErrorMessage } from "../lib/roomErrors";

interface ChatPanelProps {
  messages: ChatMessage[];
  selfId: string;
  connected: boolean;
  onSend: (text: string) => Promise<ChatSendAck>;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ChatPanel({ messages, selfId, connected, onSend }: ChatPanelProps) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);

  useEffect(() => {
    if (!stickToBottom.current) {
      return;
    }

    const container = scrollRef.current;

    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages]);

  function handleScroll() {
    const container = scrollRef.current;

    if (!container) {
      return;
    }

    stickToBottom.current =
      container.scrollHeight - container.scrollTop - container.clientHeight < 80;
  }

  async function submitMessage() {
    if (sending || !connected) {
      return;
    }

    const text = draft.trim();

    if (!text) {
      setError("Enter a message before sending.");
      return;
    }

    if (text.length > MAX_CHAT_MESSAGE_LENGTH) {
      setError(`Messages must be at most ${MAX_CHAT_MESSAGE_LENGTH} characters.`);
      return;
    }

    setSending(true);
    setError(null);

    try {
      const ack = await onSend(text);

      if (ack.ok) {
        setDraft("");
      } else {
        setError(chatErrorMessage(ack.code));
      }
    } catch {
      setError(chatErrorMessage("INTERNAL"));
    } finally {
      setSending(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitMessage();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    void submitMessage();
  }

  return (
    <section
      aria-labelledby="chat-heading"
      className="flex h-[min(32rem,70dvh)] min-h-0 min-w-0 flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-5 lg:h-[28rem]"
    >
      <div className="flex min-w-0 shrink-0 items-baseline justify-between gap-3">
        <h2 id="chat-heading" className="text-sm font-semibold text-slate-200">
          Chat
        </h2>
        <span className="shrink-0 text-xs text-slate-500">Recent messages only</span>
      </div>

      {!connected ? (
        <p
          role="status"
          className="mt-3 shrink-0 rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs text-amber-100"
        >
          Chat is paused until the room connection is ready.
        </p>
      ) : null}

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        role="log"
        aria-live="polite"
        aria-label="Chat messages"
        className="mt-3 min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto rounded-xl border border-white/5 bg-slate-950/40 p-3"
      >
        {messages.length === 0 ? (
          <p className="px-1 py-6 text-center text-sm text-slate-500">
            No messages yet. Say hello.
          </p>
        ) : (
          <ol className="min-w-0 space-y-3">
            {messages.map((message) => {
              const isSelf = message.senderId === selfId;

              return (
                <li
                  key={message.id}
                  className={`min-w-0 rounded-xl border px-3 py-2 ${
                    isSelf
                      ? "border-rose-400/15 bg-rose-400/[0.06]"
                      : "border-white/5 bg-white/[0.03]"
                  }`}
                >
                  <div className="flex min-w-0 items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-xs font-semibold text-slate-200">
                      {message.senderName}
                      {isSelf ? (
                        <span className="ml-1 font-normal text-slate-500">(you)</span>
                      ) : null}
                    </span>
                    <time
                      dateTime={message.sentAt}
                      title={message.sentAt}
                      className="shrink-0 text-[11px] text-slate-500"
                    >
                      {formatTimestamp(message.sentAt)}
                    </time>
                  </div>
                  <p className="mt-1 min-w-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-sm leading-6 text-slate-300">
                    {message.text}
                  </p>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <form className="mt-3 min-w-0 shrink-0 space-y-2" onSubmit={handleSubmit}>
        <label htmlFor="chat-input" className="sr-only">
          Message
        </label>
        <textarea
          id="chat-input"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setError(null);
          }}
          onKeyDown={handleKeyDown}
          rows={2}
          maxLength={MAX_CHAT_MESSAGE_LENGTH}
          placeholder={connected ? "Write a message…" : "Reconnect to send messages"}
          disabled={!connected || sending}
          className="block w-full min-w-0 resize-none rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-rose-400/60 focus:outline-none focus:ring-2 focus:ring-rose-400/20 disabled:cursor-not-allowed disabled:opacity-60"
        />

        <div className="flex min-w-0 items-center justify-between gap-3">
          <span className="min-w-0 truncate text-[11px] text-slate-500">
            {draft.length}/{MAX_CHAT_MESSAGE_LENGTH} · Enter sends, Shift+Enter adds a line
          </span>
          <button
            type="submit"
            disabled={!connected || sending}
            className="h-9 shrink-0 rounded-lg bg-rose-500 px-4 text-xs font-semibold text-white transition hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>

        {error ? (
          <p role="alert" className="min-w-0 text-xs text-rose-300">
            {error}
          </p>
        ) : null}
      </form>
    </section>
  );
}
