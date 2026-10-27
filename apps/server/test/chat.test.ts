// @vitest-environment node
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MAX_CHAT_MESSAGE_LENGTH,
  chatSendAckSchema,
  type ChatMessage,
  type ChatSendAck,
  type LeaveRoomAck,
} from "@tempass/shared";

import { createRoomViaHttp, joinRoomViaHttp } from "./helpers/http";
import type { TestRuntime } from "./helpers/runtime";
import { startTestRuntime } from "./helpers/runtime";
import {
  connectSocket,
  delay,
  sendChatMessage,
  waitForChatMessage,
} from "./helpers/socket";

let currentRuntime: TestRuntime | undefined;

afterEach(async () => {
  await currentRuntime?.close();
  currentRuntime = undefined;
});

async function setup(options: Parameters<typeof startTestRuntime>[0] = {}) {
  currentRuntime = await startTestRuntime(options);
  return currentRuntime;
}

async function createRoomWithTwoParticipants(
  test: TestRuntime,
  firstDisplayName = "Alex",
  secondDisplayName = "Sam",
) {
  const creator = await createRoomViaHttp(test.runtime.app, {
    displayName: firstDisplayName,
  });
  const guest = await joinRoomViaHttp(test.runtime.app, creator.room.id, {
    displayName: secondDisplayName,
  });

  const first = await connectSocket(test.url, creator.sessionToken);
  const second = await connectSocket(test.url, guest.sessionToken);

  return { creator, guest, first, second };
}

function expectAccepted(ack: ChatSendAck): asserts ack is Extract<ChatSendAck, { ok: true }> {
  expect(ack.ok).toBe(true);
}

describe("room chat over Socket.IO", () => {
  it("trims text and delivers the same canonical message to both participants", async () => {
    const test = await setup();
    const { creator, first, second } = await createRoomWithTwoParticipants(test);

    const senderDelivery = waitForChatMessage(first.socket);
    const peerDelivery = waitForChatMessage(second.socket);

    const ack = await sendChatMessage(first.socket, { text: "  Hello, Sam!  " });
    expectAccepted(ack);
    expect(chatSendAckSchema.safeParse(ack).success).toBe(true);

    const [senderMessage, peerMessage] = await Promise.all([senderDelivery, peerDelivery]);

    expect(ack.message).toEqual(senderMessage);
    expect(peerMessage).toEqual(senderMessage);
    expect(senderMessage).toMatchObject({
      senderId: creator.participant.id,
      senderName: "Alex",
      text: "Hello, Sam!",
    });
    expect(senderMessage.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(senderMessage.sentAt).toMatch(/Z$/);
    expect(new Date(senderMessage.sentAt).toISOString()).toBe(senderMessage.sentAt);
    expect(senderMessage).not.toHaveProperty("roomId");
    expect(senderMessage).not.toHaveProperty("sessionToken");
  });

  it("rejects empty, whitespace-only, overlong, malformed, and impersonating payloads", async () => {
    const test = await setup();
    const { guest, first, second } = await createRoomWithTwoParticipants(test);
    const received: ChatMessage[] = [];
    second.socket.on("chat:message", (message) => received.push(message));

    const invalidPayloads: unknown[] = [
      { text: "" },
      { text: "   \n\t " },
      { text: "x".repeat(MAX_CHAT_MESSAGE_LENGTH + 1) },
      { text: "hello", senderId: guest.participant.id },
      { text: "hello", senderName: "Mallory" },
      { text: "hello", sentAt: "2000-01-01T00:00:00.000Z" },
      { text: "hello", roomId: "AAAAAAAAAAAAAAAAAAAAAA" },
      "not-an-object",
      null,
    ];

    for (const payload of invalidPayloads) {
      const ack = await sendChatMessage(first.socket, payload);
      expect(ack).toEqual({ ok: false, code: "INVALID_INPUT" });
    }

    await delay(100);
    expect(received).toHaveLength(0);

    const maxLengthDelivery = waitForChatMessage(second.socket);
    const maxLengthAck = await sendChatMessage(first.socket, {
      text: "x".repeat(MAX_CHAT_MESSAGE_LENGTH),
    });
    expectAccepted(maxLengthAck);
    expect(maxLengthAck.message.text).toHaveLength(MAX_CHAT_MESSAGE_LENGTH);
    await maxLengthDelivery;

    const forgedAck = await sendChatMessage(first.socket, {
      text: "I am definitely Mallory",
      senderId: guest.participant.id,
      senderName: "Mallory",
    });
    expect(forgedAck).toEqual({ ok: false, code: "INVALID_INPUT" });

    const realDelivery = waitForChatMessage(
      second.socket,
      (message) => message.text === "It is really me",
    );
    const realAck = await sendChatMessage(first.socket, { text: "It is really me" });
    expectAccepted(realAck);
    const delivered = await realDelivery;
    expect(delivered.senderId).toBe(first.snapshot.self.id);
    expect(delivered.senderName).toBe("Alex");
    expect(received.some((message) => message.text === "I am definitely Mallory")).toBe(false);
  });

  it("delivers messages only to participants in the same room", async () => {
    const test = await setup();
    const { first, second } = await createRoomWithTwoParticipants(test);
    const otherRoom = await createRoomViaHttp(test.runtime.app, { displayName: "Bea" });
    const other = await connectSocket(test.url, otherRoom.sessionToken);

    const otherRoomMessages: ChatMessage[] = [];
    other.socket.on("chat:message", (message) => otherRoomMessages.push(message));

    const firstDelivery = waitForChatMessage(first.socket);
    const secondDelivery = waitForChatMessage(second.socket);
    const ack = await sendChatMessage(first.socket, { text: "Only for this room" });
    expectAccepted(ack);

    await Promise.all([firstDelivery, secondDelivery]);
    await delay(150);

    expect(otherRoomMessages).toHaveLength(0);
    expect(other.snapshot.messages).toEqual([]);
    expect(otherRoom.room.id).not.toBe(first.snapshot.room.id);
  });

  it("does not let a participant who left send messages to the previous room", async () => {
    const test = await setup();
    const { first, second } = await createRoomWithTwoParticipants(test);

    const leaveAck = await new Promise<LeaveRoomAck>((resolve) => {
      second.socket.emit("room:leave", {}, resolve);
    });
    expect(leaveAck).toEqual({ ok: true });

    const remainingMessages: ChatMessage[] = [];
    first.socket.on("chat:message", (message) => remainingMessages.push(message));

    const rejected = await sendChatMessage(second.socket, { text: "Still here?" });
    expect(rejected).toEqual({ ok: false, code: "UNAUTHORIZED" });

    await delay(100);
    expect(remainingMessages).toHaveLength(0);
    expect(test.runtime.roomService.getChatHistory(first.snapshot.room.id)).toEqual([]);

    const leftParticipantMessages: ChatMessage[] = [];
    second.socket.on("chat:message", (message) => leftParticipantMessages.push(message));

    const acceptedDelivery = waitForChatMessage(first.socket);
    const accepted = await sendChatMessage(first.socket, { text: "Alex is still here" });
    expectAccepted(accepted);
    await acceptedDelivery;
    await delay(100);

    expect(second.socket.connected).toBe(true);
    expect(leftParticipantMessages).toHaveLength(0);
  });

  it("returns recent history in order to a newly connected participant and isolates rooms", async () => {
    const test = await setup();
    const creator = await createRoomViaHttp(test.runtime.app, { displayName: "Alex" });
    const first = await connectSocket(test.url, creator.sessionToken);

    for (const text of ["one", "two", "three"]) {
      const ack = await sendChatMessage(first.socket, { text });
      expectAccepted(ack);
    }

    const guest = await joinRoomViaHttp(test.runtime.app, creator.room.id, {
      displayName: "Sam",
    });
    const second = await connectSocket(test.url, guest.sessionToken);

    expect(second.snapshot.messages.map((message) => message.text)).toEqual([
      "one",
      "two",
      "three",
    ]);
    expect(second.snapshot.messages.map((message) => message.senderName)).toEqual([
      "Alex",
      "Alex",
      "Alex",
    ]);

    second.socket.disconnect();
    const reconnected = await connectSocket(test.url, guest.sessionToken);
    expect(reconnected.snapshot.messages).toEqual(second.snapshot.messages);

    const otherRoom = await createRoomViaHttp(test.runtime.app, { displayName: "Bea" });
    const other = await connectSocket(test.url, otherRoom.sessionToken);

    expect(other.snapshot.messages).toEqual([]);
    expect(test.runtime.roomService.getChatHistory(otherRoom.room.id)).toEqual([]);
  });

  it("does not expose room history to unauthorized sockets", async () => {
    const test = await setup();
    const creator = await createRoomViaHttp(test.runtime.app, { displayName: "Alex" });
    const first = await connectSocket(test.url, creator.sessionToken);
    const ack = await sendChatMessage(first.socket, { text: "private history" });
    expectAccepted(ack);

    await expect(connectSocket(test.url, "B".repeat(43))).rejects.toMatchObject({
      data: { code: "UNAUTHORIZED" },
    });
  });

  it("keeps only the configured number of recent messages", async () => {
    const test = await setup({ chatHistoryLimit: 3 });
    const creator = await createRoomViaHttp(test.runtime.app, { displayName: "Alex" });
    const first = await connectSocket(test.url, creator.sessionToken);

    for (const text of ["one", "two", "three", "four"]) {
      const ack = await sendChatMessage(first.socket, { text });
      expectAccepted(ack);
    }

    const guest = await joinRoomViaHttp(test.runtime.app, creator.room.id, {
      displayName: "Sam",
    });
    const second = await connectSocket(test.url, guest.sessionToken);

    expect(second.snapshot.messages.map((message) => message.text)).toEqual([
      "two",
      "three",
      "four",
    ]);
    expect(test.runtime.roomService.getChatHistory(creator.room.id)).toHaveLength(3);
  });

  it("clears chat history when the room is permanently removed", async () => {
    let now = 1_000_000;
    const test = await setup({
      now: () => now,
      roomMaxAgeMs: 1_000,
      emptyRoomTtlMs: 10_000,
    });
    const creator = await createRoomViaHttp(test.runtime.app, { displayName: "Alex" });
    const first = await connectSocket(test.url, creator.sessionToken);
    const ack = await sendChatMessage(first.socket, { text: "old message" });
    expectAccepted(ack);

    expect(test.runtime.roomService.getChatHistory(creator.room.id)).toHaveLength(1);

    now += 1_000;
    test.runtime.sweep();

    expect(test.runtime.roomService.getChatHistory(creator.room.id)).toBeNull();
    expect(test.runtime.roomService.getSnapshot(creator.room.id, creator.participant.id)).toBeNull();
    await request(test.runtime.app).get(`/api/rooms/${creator.room.id}`).expect(404);
    await expect(connectSocket(test.url, creator.sessionToken)).rejects.toMatchObject({
      data: { code: "UNAUTHORIZED" },
    });

    const replacement = await createRoomViaHttp(test.runtime.app, { displayName: "Bea" });
    expect(test.runtime.roomService.getChatHistory(replacement.room.id)).toEqual([]);
  });

  it("rate limits rapid messages per socket without broadcasting rejected sends", async () => {
    const test = await setup({
      chatRateLimitMaxMessages: 3,
      chatRateLimitWindowMs: 10_000,
    });
    const creator = await createRoomViaHttp(test.runtime.app, { displayName: "Alex" });
    const first = await connectSocket(test.url, creator.sessionToken);
    const received: ChatMessage[] = [];
    first.socket.on("chat:message", (message) => received.push(message));

    for (let index = 0; index < 5; index += 1) {
      const rejected = await sendChatMessage(first.socket, { text: "   " });
      expect(rejected).toEqual({ ok: false, code: "INVALID_INPUT" });
    }

    for (const text of ["one", "two", "three"]) {
      const ack = await sendChatMessage(first.socket, { text });
      expectAccepted(ack);
    }

    const limited = await sendChatMessage(first.socket, { text: "too fast" });
    expect(limited).toEqual({ ok: false, code: "RATE_LIMITED" });

    await delay(100);
    expect(received.map((message) => message.text)).toEqual(["one", "two", "three"]);
    expect(test.runtime.roomService.getChatHistory(creator.room.id)).toHaveLength(3);
  });

  it("handles concurrent sends without corrupting or duplicating history", async () => {
    const test = await setup({ chatRateLimitMaxMessages: 50 });
    const { first, second } = await createRoomWithTwoParticipants(test);
    const received: ChatMessage[] = [];
    second.socket.on("chat:message", (message) => received.push(message));

    const texts = ["alpha", "bravo", "charlie", "delta", "echo"];
    const acks = await Promise.all(
      texts.map((text) => sendChatMessage(first.socket, { text })),
    );

    for (const ack of acks) {
      expectAccepted(ack);
    }

    await vi.waitFor(() => {
      expect(received).toHaveLength(texts.length);
    });
    await delay(100);

    const messageIds = new Set(received.map((message) => message.id));
    expect(messageIds.size).toBe(texts.length);
    expect(received.map((message) => message.text).sort()).toEqual([...texts].sort());
    expect(received).toHaveLength(texts.length);

    const history = test.runtime.roomService.getChatHistory(first.snapshot.room.id);
    expect(history).toHaveLength(texts.length);
    expect(history?.map((message) => message.id).sort()).toEqual([...messageIds].sort());

    const singleDelivery = waitForChatMessage(
      second.socket,
      (message) => message.text === "single",
    );
    const singleAck = await sendChatMessage(first.socket, { text: "single" });
    expectAccepted(singleAck);
    await singleDelivery;
    await delay(100);

    expect(received.filter((message) => message.text === "single")).toHaveLength(1);
  });

  it("keeps working after malformed payloads and preserves existing presence", async () => {
    const test = await setup();
    const { first, second } = await createRoomWithTwoParticipants(test);

    const malformed = await sendChatMessage(first.socket, { text: { nested: true } });
    expect(malformed).toEqual({ ok: false, code: "INVALID_INPUT" });

    expect(second.snapshot.participants).toHaveLength(2);
    expect(test.runtime.roomService.getPresence(first.snapshot.room.id)?.participants).toHaveLength(
      2,
    );

    const delivery = waitForChatMessage(second.socket);
    const ack = await sendChatMessage(first.socket, { text: "still alive" });
    expectAccepted(ack);
    await delivery;

    first.socket.disconnect();
    await vi.waitFor(() => {
      expect(
        test.runtime.roomService.getPresence(first.snapshot.room.id)?.participants.find(
          (participant) => participant.id === first.snapshot.self.id,
        )?.connected,
      ).toBe(false);
    });
  });
});
