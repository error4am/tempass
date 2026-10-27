// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  APP_NAME,
  MAX_CHAT_MESSAGE_LENGTH,
  chatMessageSchema,
  chatSendAckSchema,
  healthResponseSchema,
  sendChatMessagePayloadSchema,
} from "../src/index";

describe("shared contracts", () => {
  it("exposes the product name", () => {
    expect(APP_NAME).toBe("Tempass");
  });

  it("accepts a valid health response", () => {
    const result = healthResponseSchema.safeParse({
      status: "ok",
      service: "tempass-server",
      uptime: 12.5,
    });

    expect(result.success).toBe(true);
  });

  it("rejects an invalid health response", () => {
    const result = healthResponseSchema.safeParse({
      status: "degraded",
      service: "",
      uptime: -1,
    });

    expect(result.success).toBe(false);
  });
});

describe("chat contracts", () => {
  it("trims valid message text and enforces the length limit", () => {
    expect(sendChatMessagePayloadSchema.parse({ text: "  hello  " })).toEqual({
      text: "hello",
    });
    expect(
      sendChatMessagePayloadSchema.safeParse({
        text: "x".repeat(MAX_CHAT_MESSAGE_LENGTH),
      }).success,
    ).toBe(true);
    expect(
      sendChatMessagePayloadSchema.safeParse({
        text: "x".repeat(MAX_CHAT_MESSAGE_LENGTH + 1),
      }).success,
    ).toBe(false);
  });

  it("rejects empty, whitespace-only, malformed, and extra-field payloads", () => {
    expect(sendChatMessagePayloadSchema.safeParse({ text: "" }).success).toBe(false);
    expect(sendChatMessagePayloadSchema.safeParse({ text: " \n\t " }).success).toBe(false);
    expect(sendChatMessagePayloadSchema.safeParse("hello").success).toBe(false);
    expect(
      sendChatMessagePayloadSchema.safeParse({ text: "hello", senderId: "forged" }).success,
    ).toBe(false);
  });

  it("validates canonical messages and structured acknowledgements", () => {
    const message = {
      id: "message-id",
      senderId: "participant-id",
      senderName: "Alex",
      text: "hello",
      sentAt: "2026-01-02T03:04:05.000Z",
    };

    expect(chatMessageSchema.safeParse(message).success).toBe(true);
    expect(
      chatMessageSchema.safeParse({ ...message, sentAt: "not-a-date" }).success,
    ).toBe(false);
    expect(chatSendAckSchema.parse({ ok: true, message })).toEqual({ ok: true, message });
    expect(chatSendAckSchema.parse({ ok: false, code: "RATE_LIMITED" })).toEqual({
      ok: false,
      code: "RATE_LIMITED",
    });
  });
});
