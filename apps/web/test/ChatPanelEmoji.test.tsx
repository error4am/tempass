import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ChatMessage, ChatSendAck } from "@tempass/shared";

import { ChatPanel } from "../src/components/ChatPanel";

const ACCEPTED: ChatSendAck = {
  ok: true,
  message: {
    id: "message-1",
    senderId: "participant-alex",
    senderName: "Alex",
    text: "Sent",
    sentAt: "2026-01-03T03:04:05.000Z",
  },
};

afterEach(cleanup);

function renderPanel(messages: ChatMessage[] = [], onSend = vi.fn()) {
  render(<ChatPanel messages={messages} selfId="participant-alex" connected onSend={onSend} />);
  return {
    onSend,
    input: screen.getByLabelText("Message") as HTMLTextAreaElement,
  };
}

describe("ChatPanel emoji support", () => {
  it("inserts a picked emoji at the caret and keeps the caret after it", async () => {
    const { input } = renderPanel();

    fireEvent.change(input, { target: { value: "hi there" } });
    input.setSelectionRange(3, 3);

    fireEvent.click(screen.getByRole("button", { name: "Add emoji" }));
    fireEvent.click(screen.getByRole("button", { name: "grinning face" }));

    await waitFor(() => {
      expect(input.value).toBe("hi 😀there");
    });
    await waitFor(() => {
      expect(input.selectionStart).toBe(5);
    });
    expect(screen.queryByRole("dialog", { name: "Emoji picker" })).toBeNull();
  });

  it("filters by search and inserts the first match on Enter", async () => {
    const { input } = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Add emoji" }));

    const search = screen.getByLabelText("Search emoji");
    fireEvent.change(search, { target: { value: "pizza" } });
    fireEvent.keyDown(search, { key: "Enter" });

    await waitFor(() => {
      expect(input.value).toBe("🍕");
    });
  });

  it("closes on Escape and returns focus to the message input", async () => {
    const { input } = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Add emoji" }));
    const search = screen.getByLabelText("Search emoji");

    await waitFor(() => {
      expect(document.activeElement).toBe(search);
    });

    fireEvent.keyDown(search, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Emoji picker" })).toBeNull();
    });
    expect(document.activeElement).toBe(input);
  });

  it("counts grapheme clusters in the character counter", async () => {
    const { input } = renderPanel();

    fireEvent.change(input, { target: { value: "😀😀😀" } });

    expect(screen.getByText(/Enter sends/, { selector: "span" }).textContent).toContain("3/500");
  });

  it("accepts 500 emoji and rejects 501 without sending", async () => {
    const onSend = vi.fn().mockResolvedValue(ACCEPTED);
    const { input } = renderPanel([], onSend);
    const emoji = "😀";

    fireEvent.change(input, { target: { value: emoji.repeat(500) } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith(emoji.repeat(500));
    });

    fireEvent.change(input, { target: { value: emoji.repeat(501) } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("at most 500 characters");
    });
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("renders emoji-only messages jumbo and leaves other messages at body size", () => {
    const messages: ChatMessage[] = [
      {
        id: "message-emoji",
        senderId: "participant-sam",
        senderName: "Sam",
        text: "🎉🎉",
        sentAt: "2026-01-03T03:04:05.000Z",
      },
      {
        id: "message-text",
        senderId: "participant-sam",
        senderName: "Sam",
        text: "party time 🎉",
        sentAt: "2026-01-03T03:05:05.000Z",
      },
    ];

    renderPanel(messages);

    expect(screen.getByText("🎉🎉").className).toContain("text-3xl");
    expect(screen.getByText("party time 🎉").className).toContain("text-sm");
  });
});
