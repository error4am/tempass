import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import {
  CHAT_IMAGE_MIME_TYPES,
  MAX_CHAT_IMAGE_BYTES,
  MAX_CHAT_MESSAGE_LENGTH,
  countChatGraphemes,
  type ChatMedia,
  type ChatMessage,
  type ChatSendAck,
} from "@tempass/shared";

import { isEmojiOnlyMessage } from "../lib/emoji";
import { chatErrorMessage, mediaErrorMessage } from "../lib/roomErrors";
import { EmojiPicker } from "./EmojiPicker";

interface ChatPanelProps {
  messages: ChatMessage[];
  selfId: string;
  connected: boolean;
  onSend: (text: string, mediaId?: string) => Promise<ChatSendAck>;
  onUploadImage?: (
    file: File,
    options: { onProgress: (fraction: number) => void; signal: AbortSignal },
  ) => Promise<ChatMedia>;
  loadImageUrl?: (mediaId: string) => Promise<string>;
}

interface PendingImage {
  file: File;
  previewUrl: string;
}

interface ViewerImage {
  url: string;
  alt: string;
}

const ACCEPTED_IMAGE_TYPES = CHAT_IMAGE_MIME_TYPES.join(",");
const MAX_IMAGE_MEGABYTES = Math.round(MAX_CHAT_IMAGE_BYTES / (1024 * 1024));

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

export function ChatPanel({
  messages,
  selfId,
  connected,
  onSend,
  onUploadImage,
  loadImageUrl,
}: ChatPanelProps) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);
  const [uploadedMedia, setUploadedMedia] = useState<ChatMedia | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [viewer, setViewer] = useState<ViewerImage | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [pendingCaret, setPendingCaret] = useState<number | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const emojiButtonRef = useRef<HTMLButtonElement | null>(null);
  const emojiPickerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const restoreFocus = useRef(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);
  const uploadController = useRef<AbortController | null>(null);
  const previewUrl = useRef<string | null>(null);

  useEffect(() => {
    if (!stickToBottom.current) {
      return;
    }

    const container = scrollRef.current;

    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (pendingCaret === null) {
      return;
    }

    const input = inputRef.current;

    if (input) {
      input.focus({ preventScroll: true });
      input.setSelectionRange(pendingCaret, pendingCaret);
    }

    setPendingCaret(null);
  }, [pendingCaret]);

  useEffect(() => {
    if (sending || !restoreFocus.current) {
      return;
    }

    restoreFocus.current = false;

    const activeElement = document.activeElement;
    const focusRemainsInComposer =
      activeElement === document.body || formRef.current?.contains(activeElement) === true;

    if (focusRemainsInComposer && activeElement !== inputRef.current) {
      inputRef.current?.focus({ preventScroll: true });
    }
  }, [sending]);

  useEffect(() => {
    return () => {
      uploadController.current?.abort();
      uploadController.current = null;

      if (previewUrl.current) {
        URL.revokeObjectURL(previewUrl.current);
        previewUrl.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!viewer) {
      return;
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setViewer(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [viewer]);

  function handleScroll() {
    const container = scrollRef.current;

    if (!container) {
      return;
    }

    stickToBottom.current =
      container.scrollHeight - container.scrollTop - container.clientHeight < 80;
  }

  function clearImage() {
    uploadController.current?.abort();
    uploadController.current = null;

    if (previewUrl.current) {
      URL.revokeObjectURL(previewUrl.current);
      previewUrl.current = null;
    }

    setPendingImage(null);
    setUploadedMedia(null);
    setUploading(false);
    setUploadProgress(0);
  }

  function startUpload(file: File) {
    if (!onUploadImage) {
      setError("Image sharing is not available right now.");
      return;
    }

    clearImage();

    const controller = new AbortController();
    uploadController.current = controller;
    const nextPreviewUrl = URL.createObjectURL(file);
    previewUrl.current = nextPreviewUrl;

    setPendingImage({ file, previewUrl: nextPreviewUrl });
    setUploadedMedia(null);
    setUploading(true);
    setUploadProgress(0);
    setError(null);

    void onUploadImage(file, {
      onProgress: (fraction) => {
        if (uploadController.current === controller) {
          setUploadProgress(Math.min(1, Math.max(0, fraction)));
        }
      },
      signal: controller.signal,
    })
      .then((media) => {
        if (uploadController.current !== controller) {
          return;
        }

        uploadController.current = null;
        setUploadedMedia(media);
        setUploading(false);
        setUploadProgress(1);
      })
      .catch((uploadError: unknown) => {
        if (uploadController.current !== controller) {
          return;
        }

        if ((uploadError as { name?: string }).name === "AbortError") {
          return;
        }

        setUploading(false);
        setError(mediaErrorMessage((uploadError as { code?: string }).code ?? "INTERNAL"));
      });
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    if (!(CHAT_IMAGE_MIME_TYPES as readonly string[]).includes(file.type)) {
      setError("Choose a JPEG, PNG, WebP, or GIF image.");
      return;
    }

    if (file.size > MAX_CHAT_IMAGE_BYTES) {
      setError(`Images must be ${MAX_IMAGE_MEGABYTES} MB or smaller.`);
      return;
    }

    startUpload(file);
  }

  function retryUpload() {
    if (pendingImage) {
      startUpload(pendingImage.file);
    }
  }

  function closeEmoji() {
    const focusInPicker = emojiPickerRef.current?.contains(document.activeElement) === true;
    setEmojiOpen(false);

    if (focusInPicker) {
      inputRef.current?.focus({ preventScroll: true });
    }
  }

  function toggleEmoji() {
    if (emojiOpen) {
      setEmojiOpen(false);
      inputRef.current?.focus({ preventScroll: true });
      return;
    }

    setEmojiOpen(true);
  }

  function handleEmojiSelect(char: string) {
    const start = inputRef.current?.selectionStart ?? draft.length;
    const end = inputRef.current?.selectionEnd ?? start;
    const next = `${draft.slice(0, start)}${char}${draft.slice(end)}`;

    setDraft(next);
    setError(null);
    setPendingCaret(start + char.length);
    closeEmoji();
  }

  async function submitMessage() {
    if (sending || !connected) {
      return;
    }

    if (uploading) {
      setError("Wait for the image to finish uploading.");
      return;
    }

    const text = draft.trim();

    if (!text && !uploadedMedia) {
      setError("Enter a message or attach an image before sending.");
      return;
    }

    if (countChatGraphemes(text) > MAX_CHAT_MESSAGE_LENGTH) {
      setError(`Messages must be at most ${MAX_CHAT_MESSAGE_LENGTH} characters.`);
      return;
    }

    restoreFocus.current = false;
    setSending(true);
    setError(null);

    try {
      const ack = uploadedMedia ? await onSend(text, uploadedMedia.id) : await onSend(text);

      if (ack.ok) {
        restoreFocus.current = true;
        setDraft("");
        clearImage();
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

  function handleKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape" && emojiOpen) {
      event.preventDefault();
      closeEmoji();
      return;
    }

    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    void submitMessage();
  }

  const sendDisabled =
    !connected || sending || uploading || (draft.trim().length === 0 && !uploadedMedia);
  const attachDisabled = !connected || sending || uploading;
  const emojiDisabled = !connected || sending;
  const graphemeCount = useMemo(() => countChatGraphemes(draft), [draft]);

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
                  {message.media ? (
                    <MessageImage
                      media={message.media}
                      loadImageUrl={loadImageUrl}
                      onOpen={setViewer}
                    />
                  ) : null}
                  {message.text ? (
                    <p
                      className={`mt-1 min-w-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-slate-300 ${
                        isEmojiOnlyMessage(message.text)
                          ? "text-3xl leading-9"
                          : "text-sm leading-6"
                      }`}
                    >
                      {message.text}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <form ref={formRef} className="mt-3 min-w-0 shrink-0 space-y-2" onSubmit={handleSubmit}>
        <label htmlFor="chat-input" className="sr-only">
          Message
        </label>
        <textarea
          ref={inputRef}
          id="chat-input"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setError(null);
          }}
          onKeyDown={handleKeyDown}
          rows={2}
          placeholder={connected ? "Write a message…" : "Reconnect to send messages"}
          disabled={!connected || sending}
          className="block w-full min-w-0 resize-none rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-rose-400/60 focus:outline-none focus:ring-2 focus:ring-rose-400/20 disabled:cursor-not-allowed disabled:opacity-60"
        />

        {pendingImage ? (
          <div className="flex min-w-0 items-center gap-3 rounded-xl border border-white/10 bg-slate-900/60 p-2">
            <img
              src={pendingImage.previewUrl}
              alt="Selected image preview"
              className="h-14 w-14 shrink-0 rounded-lg object-cover"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs text-slate-300">{pendingImage.file.name}</p>
              {uploading ? (
                <div className="mt-1 flex items-center gap-2">
                  <progress
                    aria-label="Upload progress"
                    value={Math.round(uploadProgress * 100)}
                    max={100}
                    className="h-1 min-w-0 flex-1"
                  />
                  <span className="shrink-0 text-[11px] text-slate-500">
                    {Math.round(uploadProgress * 100)}%
                  </span>
                </div>
              ) : uploadedMedia ? (
                <p className="mt-1 text-[11px] text-emerald-300">Ready to send</p>
              ) : (
                <p className="mt-1 text-[11px] text-slate-500">Upload failed</p>
              )}
            </div>
            {!uploading && !uploadedMedia ? (
              <button
                type="button"
                onClick={retryUpload}
                className="h-8 shrink-0 rounded-lg border border-white/10 bg-white/5 px-2 text-[11px] font-medium text-slate-300 transition hover:bg-white/10"
              >
                Retry
              </button>
            ) : null}
            <button
              type="button"
              onClick={clearImage}
              className="h-8 shrink-0 rounded-lg border border-white/10 bg-white/5 px-2 text-[11px] font-medium text-slate-300 transition hover:bg-white/10"
            >
              Remove
            </button>
          </div>
        ) : null}

        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <div className="relative shrink-0">
              <button
                ref={emojiButtonRef}
                type="button"
                onClick={toggleEmoji}
                aria-label="Add emoji"
                aria-expanded={emojiOpen}
                aria-haspopup="dialog"
                disabled={emojiDisabled}
                className="h-9 shrink-0 rounded-lg border border-white/10 bg-white/5 px-3 text-xs font-medium text-slate-300 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Emoji
              </button>
              {emojiOpen ? (
                <div
                  ref={emojiPickerRef}
                  className="absolute bottom-full left-0 z-20 mb-2"
                >
                  <EmojiPicker
                    onSelect={handleEmojiSelect}
                    onClose={closeEmoji}
                    excludeRef={emojiButtonRef}
                  />
                </div>
              ) : null}
            </div>
            {onUploadImage ? (
              <>
                <input
                  ref={fileInputRef}
                  id="chat-image-input"
                  type="file"
                  accept={ACCEPTED_IMAGE_TYPES}
                  aria-label="Image file"
                  className="sr-only"
                  onChange={handleFileChange}
                  disabled={attachDisabled}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  aria-label="Attach image"
                  title={`Attach an image (max ${MAX_IMAGE_MEGABYTES} MB)`}
                  disabled={attachDisabled}
                  className="h-9 shrink-0 rounded-lg border border-white/10 bg-white/5 px-3 text-xs font-medium text-slate-300 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Image
                </button>
              </>
            ) : null}
            <span className="min-w-0 truncate text-[11px] text-slate-500">
              {graphemeCount}/{MAX_CHAT_MESSAGE_LENGTH} · Enter sends, Shift+Enter adds a line
            </span>
          </div>
          <button
            type="submit"
            disabled={sendDisabled}
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

      {viewer ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Shared image"
          onClick={() => setViewer(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 p-4"
        >
          <button
            type="button"
            aria-label="Close image"
            onClick={() => setViewer(null)}
            className="absolute right-4 top-4 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/20"
          >
            Close
          </button>
          <img
            src={viewer.url}
            alt={viewer.alt}
            onClick={(event) => event.stopPropagation()}
            className="max-h-full max-w-full rounded-xl"
          />
        </div>
      ) : null}
    </section>
  );
}

interface MessageImageProps {
  media: ChatMedia;
  loadImageUrl?: (mediaId: string) => Promise<string>;
  onOpen: (image: ViewerImage) => void;
}

function MessageImage({ media, loadImageUrl, onOpen }: MessageImageProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!loadImageUrl) {
      setFailed(true);
      return;
    }

    let active = true;
    setUrl(null);
    setFailed(false);

    void loadImageUrl(media.id)
      .then((nextUrl) => {
        if (active) {
          setUrl(nextUrl);
        }
      })
      .catch(() => {
        if (active) {
          setFailed(true);
        }
      });

    return () => {
      active = false;
    };
  }, [media.id, loadImageUrl]);

  if (failed) {
    return <p className="mt-1 text-xs text-slate-500">Image unavailable.</p>;
  }

  if (!url) {
    return (
      <div
        aria-hidden="true"
        className="mt-1 max-h-64 w-full animate-pulse rounded-lg border border-white/5 bg-slate-900/60"
        style={{ aspectRatio: `${media.width} / ${media.height}` }}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => onOpen({ url, alt: "Shared image" })}
      aria-label="Open image"
      className="mt-1 block max-w-full cursor-zoom-in rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-400/40"
    >
      <img
        src={url}
        alt="Shared image"
        width={media.width}
        height={media.height}
        loading="lazy"
        decoding="async"
        className="max-h-64 w-auto max-w-full rounded-lg border border-white/5"
      />
    </button>
  );
}
