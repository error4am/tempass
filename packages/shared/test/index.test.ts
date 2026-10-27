// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  APP_NAME,
  MAX_CHAT_MESSAGE_LENGTH,
  MAX_PLAYBACK_POSITION_SECONDS,
  chatMessageSchema,
  chatSendAckSchema,
  clockSyncAckSchema,
  clockSyncRequestSchema,
  healthResponseSchema,
  playbackCommandAckSchema,
  playbackCommandSchema,
  playbackStateSchema,
  playbackUpdateCommandSchema,
  playbackUpdateSchema,
  sendChatMessagePayloadSchema,
  youtubeVideoIdSchema,
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

describe("playback contracts", () => {
  const videoId = "dQw4w9WgXcQ";
  const pausedState = {
    videoId,
    status: "paused",
    positionSeconds: 12.5,
    updatedAt: 1_000,
    revision: 1,
  } as const;

  it("requires an exact YouTube video ID", () => {
    expect(youtubeVideoIdSchema.safeParse(videoId).success).toBe(true);
    expect(youtubeVideoIdSchema.safeParse("abcdefghij_").success).toBe(true);
    expect(youtubeVideoIdSchema.safeParse("abcdefghij-").success).toBe(true);
    expect(youtubeVideoIdSchema.safeParse("abcdefghij").success).toBe(false);
    expect(youtubeVideoIdSchema.safeParse("abcdefghijkL").success).toBe(false);
    expect(youtubeVideoIdSchema.safeParse("abcdefghij!").success).toBe(false);
  });

  it("validates playback states and rejects inconsistent combinations", () => {
    const idleState = {
      videoId: null,
      status: "idle",
      positionSeconds: 0,
      updatedAt: 1_000,
      revision: 0,
    };

    expect(playbackStateSchema.safeParse(idleState).success).toBe(true);
    expect(playbackStateSchema.safeParse(pausedState).success).toBe(true);
    expect(playbackStateSchema.safeParse({ ...pausedState, status: "playing" }).success).toBe(
      true,
    );
    expect(playbackStateSchema.safeParse({ ...idleState, videoId }).success).toBe(false);
    expect(playbackStateSchema.safeParse({ ...pausedState, videoId: null }).success).toBe(false);
    expect(
      playbackStateSchema.safeParse({
        ...pausedState,
        positionSeconds: MAX_PLAYBACK_POSITION_SECONDS + 1,
      }).success,
    ).toBe(false);
    expect(
      playbackStateSchema.safeParse({ ...pausedState, positionSeconds: Infinity }).success,
    ).toBe(false);
    expect(playbackStateSchema.safeParse({ ...pausedState, positionSeconds: NaN }).success).toBe(
      false,
    );
    expect(playbackStateSchema.safeParse({ ...pausedState, positionSeconds: -1 }).success).toBe(
      false,
    );
    expect(playbackStateSchema.safeParse({ ...pausedState, extra: true }).success).toBe(false);
  });

  it("validates strict select, play, pause, and seek commands", () => {
    expect(playbackCommandSchema.parse({ action: "select", videoId })).toEqual({
      action: "select",
      videoId,
    });
    expect(
      playbackCommandSchema.parse({ action: "play", videoId, positionSeconds: 3 }),
    ).toEqual({ action: "play", videoId, positionSeconds: 3 });
    expect(
      playbackUpdateCommandSchema.safeParse({
        action: "pause",
        videoId,
        positionSeconds: 3,
      }).success,
    ).toBe(true);
    expect(
      playbackUpdateCommandSchema.safeParse({
        action: "seek",
        videoId,
        positionSeconds: 3,
      }).success,
    ).toBe(true);
    expect(
      playbackCommandSchema.safeParse({ action: "select", videoId, positionSeconds: 0 })
        .success,
    ).toBe(false);
    expect(
      playbackCommandSchema.safeParse({ action: "play", videoId, positionSeconds: -1 })
        .success,
    ).toBe(false);
    expect(
      playbackCommandSchema.safeParse({ action: "play", videoId, positionSeconds: 0, extra: 1 })
        .success,
    ).toBe(false);
    expect(
      playbackUpdateCommandSchema.safeParse({ action: "select", videoId }).success,
    ).toBe(false);
  });

  it("validates clock synchronization requests and acknowledgements", () => {
    expect(clockSyncRequestSchema.parse({ clientTime: 1_500 })).toEqual({
      clientTime: 1_500,
    });
    expect(
      clockSyncRequestSchema.safeParse({ clientTime: 1_500, serverTime: 1_700 })
        .success,
    ).toBe(false);
    expect(clockSyncRequestSchema.safeParse({ clientTime: -1 }).success).toBe(false);
    expect(clockSyncRequestSchema.safeParse({ clientTime: 1.5 }).success).toBe(false);

    expect(
      clockSyncAckSchema.parse({
        ok: true,
        clientTime: 1_500,
        serverTime: 1_700,
      }),
    ).toEqual({ ok: true, clientTime: 1_500, serverTime: 1_700 });
    expect(clockSyncAckSchema.parse({ ok: false, code: "INVALID_INPUT" })).toEqual({
      ok: false,
      code: "INVALID_INPUT",
    });
    expect(
      clockSyncAckSchema.safeParse({ ok: false, code: "BAD_PASSWORD" }).success,
    ).toBe(false);
  });

  it("validates playback updates and command acknowledgements", () => {
    expect(
      playbackUpdateSchema.parse({ state: pausedState, serverTime: 1_500 }),
    ).toEqual({ state: pausedState, serverTime: 1_500 });
    expect(
      playbackCommandAckSchema.parse({
        ok: true,
        state: pausedState,
        serverTime: 1_500,
      }),
    ).toEqual({ ok: true, state: pausedState, serverTime: 1_500 });
    expect(playbackCommandAckSchema.parse({ ok: false, code: "VIDEO_MISMATCH" })).toEqual({
      ok: false,
      code: "VIDEO_MISMATCH",
    });
    expect(
      playbackCommandAckSchema.safeParse({ ok: false, code: "BAD_PASSWORD" }).success,
    ).toBe(false);
  });
});
