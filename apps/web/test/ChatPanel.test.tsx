import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ChatMessage, ChatSendAck } from "@tempass/shared";

import { ChatPanel } from "../src/components/ChatPanel";

const MESSAGES: ChatMessage[] = [
  {
    id: "message-1",
    senderId: "participant-alex",
    senderName: "Alex",
    text: "Hello there",
    sentAt: "2026-01-02T03:04:05.000Z",
  },
  {
    id: "message-2",
    senderId: "participant-sam",
    senderName: "Sam",
    text: "Hi Alex\nReady to watch?",
    sentAt: "2026-01-02T03:05:00.000Z",
  },
];

const ACCEPTED: ChatSendAck = {
  ok: true,
  message: {
    id: "message-3",
    senderId: "participant-alex",
    senderName: "Alex",
    text: "Sent",
    sentAt: "2026-01-02T03:06:00.000Z",
  },
};

afterEach(cleanup);

describe("ChatPanel", () => {
  it("renders messages chronologically with sender names and timestamps", () => {
    render(
      <ChatPanel messages={MESSAGES} selfId="participant-alex" connected onSend={vi.fn()} />,
    );

    const items = within(screen.getByRole("log")).getAllByRole("listitem");

    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toContain("Alex");
    expect(items[0]?.textContent).toContain("Hello there");
    expect(items[0]?.textContent).toContain("(you)");
    expect(items[1]?.textContent).toContain("Sam");
    expect(items[1]?.textContent).toContain("Ready to watch?");
    expect(
      document.querySelector('time[datetime="2026-01-02T03:04:05.000Z"]'),
    ).not.toBeNull();
  });

  it("renders message text as plain text instead of HTML", () => {
    const htmlMessage: ChatMessage = {
      id: "message-html",
      senderId: "participant-sam",
      senderName: "Sam",
      text: "<strong>not bold</strong><script>alert('xss')</script>",
      sentAt: "2026-01-02T03:05:00.000Z",
    };

    const { container } = render(
      <ChatPanel messages={[htmlMessage]} selfId="participant-alex" connected onSend={vi.fn()} />,
    );

    expect(screen.getByText(htmlMessage.text)).toBeTruthy();
    expect(container.querySelector("strong")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
  });

  it("sends trimmed text on Enter, clears the draft, and restores focus", async () => {
    const onSend = vi.fn().mockResolvedValue(ACCEPTED);

    render(<ChatPanel messages={[]} selfId="participant-alex" connected onSend={onSend} />);

    const input = screen.getByLabelText("Message") as HTMLTextAreaElement;
    input.focus();
    fireEvent.change(input, { target: { value: "  Hello Sam  " } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith("Hello Sam");
    });
    await waitFor(() => {
      expect(input.value).toBe("");
    });
    expect(document.activeElement).toBe(input);
  });

  it("returns focus to the composer after a successful Send button click", async () => {
    const onSend = vi.fn().mockResolvedValue(ACCEPTED);

    render(<ChatPanel messages={[]} selfId="participant-alex" connected onSend={onSend} />);

    const input = screen.getByLabelText("Message") as HTMLTextAreaElement;
    const sendButton = screen.getByRole("button", { name: "Send" });

    input.focus();
    fireEvent.change(input, { target: { value: "Sent with the button" } });
    sendButton.focus();
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith("Sent with the button");
    });
    await waitFor(() => {
      expect(input.value).toBe("");
    });
    expect(document.activeElement).toBe(input);
  });

  it("does not take focus from another control when a send completes later", async () => {
    let resolveSend: (ack: ChatSendAck) => void = () => undefined;
    const onSend = vi.fn(
      () =>
        new Promise<ChatSendAck>((resolve) => {
          resolveSend = resolve;
        }),
    );

    render(
      <>
        <ChatPanel messages={[]} selfId="participant-alex" connected onSend={onSend} />
        <button type="button">Other control</button>
      </>,
    );

    const input = screen.getByLabelText("Message") as HTMLTextAreaElement;
    const otherControl = screen.getByRole("button", { name: "Other control" });

    input.focus();
    fireEvent.change(input, { target: { value: "Slow message" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith("Slow message");
    });

    otherControl.focus();
    resolveSend(ACCEPTED);

    await waitFor(() => {
      expect(input.value).toBe("");
    });
    expect(document.activeElement).toBe(otherControl);
  });

  it("keeps the draft and shows an error when the server rejects a message", async () => {
    const onSend = vi.fn().mockResolvedValue({ ok: false, code: "RATE_LIMITED" });

    render(<ChatPanel messages={[]} selfId="participant-alex" connected onSend={onSend} />);

    const input = screen.getByLabelText("Message") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "too fast" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("too quickly");
    });
    expect(input.value).toBe("too fast");
  });

  it("supports Shift+Enter without sending and rejects empty drafts", async () => {
    const onSend = vi.fn().mockResolvedValue(ACCEPTED);

    render(<ChatPanel messages={[]} selfId="participant-alex" connected onSend={onSend} />);

    const input = screen.getByLabelText("Message") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "line one" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("Enter a message");
    });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("disables sending while the room is reconnecting", () => {
    render(
      <ChatPanel messages={[]} selfId="participant-alex" connected={false} onSend={vi.fn()} />,
    );

    expect((screen.getByLabelText("Message") as HTMLTextAreaElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByText(/chat is paused/i)).toBeTruthy();
  });

  it("preserves the reading position when scrolled up and resumes following at the bottom", () => {
    const newMessage: ChatMessage = {
      id: "message-3",
      senderId: "participant-sam",
      senderName: "Sam",
      text: "A new message",
      sentAt: "2026-01-02T03:06:00.000Z",
    };
    const newestMessage: ChatMessage = {
      ...newMessage,
      id: "message-4",
      text: "The newest message",
    };

    const { rerender } = render(
      <ChatPanel messages={MESSAGES} selfId="participant-alex" connected onSend={vi.fn()} />,
    );
    const log = screen.getByRole("log");

    Object.defineProperties(log, {
      scrollHeight: { configurable: true, value: 600 },
      clientHeight: { configurable: true, value: 200 },
    });

    log.scrollTop = 0;
    fireEvent.scroll(log);

    rerender(
      <ChatPanel
        messages={[...MESSAGES, newMessage]}
        selfId="participant-alex"
        connected
        onSend={vi.fn()}
      />,
    );

    expect(log.scrollTop).toBe(0);

    log.scrollTop = 400;
    fireEvent.scroll(log);
    Object.defineProperty(log, "scrollHeight", { configurable: true, value: 700 });

    rerender(
      <ChatPanel
        messages={[...MESSAGES, newMessage, newestMessage]}
        selfId="participant-alex"
        connected
        onSend={vi.fn()}
      />,
    );

    expect(log.scrollTop).toBe(700);
  });
});
