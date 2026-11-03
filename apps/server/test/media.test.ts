// @vitest-environment node
import { randomUUID } from "node:crypto";

import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import {
  chatMediaResponseSchema,
  type ChatMedia,
  type ChatSendAck,
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

function pngBytes(width = 2, height = 3, padding = 0): Buffer {
  const buffer = Buffer.alloc(24 + padding);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

function upload(
  test: TestRuntime,
  roomId: string,
  token: string,
  buffer: Buffer,
  contentType = "image/png",
) {
  return request(test.runtime.app)
    .post(`/api/rooms/${roomId}/media`)
    .set("Authorization", `Bearer ${token}`)
    .attach("image", buffer, { filename: "image.png", contentType });
}

function expectAccepted(ack: ChatSendAck): asserts ack is Extract<ChatSendAck, { ok: true }> {
  expect(ack.ok).toBe(true);
}

describe("room media over HTTP", () => {
  it("uploads a PNG and serves the same bytes back with image headers", async () => {
    const test = await setup();
    const creator = await createRoomViaHttp(test.runtime.app, { displayName: "Alex" });
    const buffer = pngBytes(640, 480);

    const uploaded = await upload(test, creator.room.id, creator.sessionToken, buffer).expect(201);
    const { media } = chatMediaResponseSchema.parse(uploaded.body);

    expect(media).toMatchObject({
      mimeType: "image/png",
      sizeBytes: buffer.length,
      width: 640,
      height: 480,
    });
    expect(media.id).toMatch(/^[A-Za-z0-9_-]{22}$/);

    const served = await request(test.runtime.app)
      .get(`/api/rooms/${creator.room.id}/media/${media.id}`)
      .set("Authorization", `Bearer ${creator.sessionToken}`)
      .expect(200);

    expect(Buffer.from(served.body).equals(buffer)).toBe(true);
    expect(served.headers["content-type"]).toBe("image/png");
    expect(served.headers["content-length"]).toBe(String(buffer.length));
    expect(served.headers["x-content-type-options"]).toBe("nosniff");
    expect(served.headers["cache-control"]).toBe("private, max-age=300");
  });

  it("requires a session token from the same room for upload and download", async () => {
    const test = await setup();
    const creator = await createRoomViaHttp(test.runtime.app, { displayName: "Alex" });
    const outsider = await createRoomViaHttp(test.runtime.app, { displayName: "Mallory" });

    await request(test.runtime.app)
      .post(`/api/rooms/${creator.room.id}/media`)
      .attach("image", pngBytes(), { filename: "image.png", contentType: "image/png" })
      .expect(401);

    const uploaded = await upload(
      test,
      creator.room.id,
      creator.sessionToken,
      pngBytes(),
    ).expect(201);
    const { media } = chatMediaResponseSchema.parse(uploaded.body);

    await request(test.runtime.app)
      .post(`/api/rooms/${creator.room.id}/media`)
      .set("Authorization", `Bearer ${outsider.sessionToken}`)
      .attach("image", pngBytes(), { filename: "image.png", contentType: "image/png" })
      .expect(401);

    await request(test.runtime.app)
      .get(`/api/rooms/${creator.room.id}/media/${media.id}`)
      .expect(401);

    await request(test.runtime.app)
      .get(`/api/rooms/${creator.room.id}/media/${media.id}`)
      .set("Authorization", `Bearer ${outsider.sessionToken}`)
      .expect(401);

    await request(test.runtime.app)
      .get(`/api/rooms/${creator.room.id}/media/${media.id}`)
      .set("Authorization", `Bearer ${creator.sessionToken}`)
      .expect(200);
  });

  it("rejects SVG, malformed images, and unknown media IDs", async () => {
    const test = await setup();
    const creator = await createRoomViaHttp(test.runtime.app, { displayName: "Alex" });

    const svg = await upload(
      test,
      creator.room.id,
      creator.sessionToken,
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
      "image/svg+xml",
    ).expect(415);
    expect(svg.body.code).toBe("UNSUPPORTED_MEDIA_TYPE");

    const malformed = await request(test.runtime.app)
      .post(`/api/rooms/${creator.room.id}/media`)
      .set("Authorization", `Bearer ${creator.sessionToken}`)
      .attach("image", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), {
        filename: "broken.png",
        contentType: "image/png",
      })
      .expect(400);
    expect(malformed.body.code).toBe("INVALID_INPUT");

    await request(test.runtime.app)
      .get(`/api/rooms/${creator.room.id}/media/${"A".repeat(22)}`)
      .set("Authorization", `Bearer ${creator.sessionToken}`)
      .expect(404);
  });

  it("enforces the per-image, per-room, and global byte limits", async () => {
    const test = await setup({
      mediaMaxImageBytes: 32,
      mediaRoomMaxBytes: 24,
      mediaGlobalMaxBytes: 24,
    });
    const firstRoom = await createRoomViaHttp(test.runtime.app, { displayName: "Alex" });
    const secondRoom = await createRoomViaHttp(test.runtime.app, { displayName: "Sam" });

    const tooLarge = await upload(
      test,
      firstRoom.room.id,
      firstRoom.sessionToken,
      pngBytes(2, 3, 9),
    ).expect(413);
    expect(tooLarge.body.code).toBe("MEDIA_TOO_LARGE");

    await upload(test, firstRoom.room.id, firstRoom.sessionToken, pngBytes()).expect(201);

    const roomFull = await upload(
      test,
      firstRoom.room.id,
      firstRoom.sessionToken,
      pngBytes(),
    ).expect(413);
    expect(roomFull.body.code).toBe("MEDIA_LIMIT_REACHED");

    const globalFull = await upload(
      test,
      secondRoom.room.id,
      secondRoom.sessionToken,
      pngBytes(),
    ).expect(413);
    expect(globalFull.body.code).toBe("MEDIA_LIMIT_REACHED");

    expect(test.runtime.roomService.mediaStore.count).toBe(1);
    expect(test.runtime.roomService.mediaStore.totalBytes).toBe(24);
  });

  it("rate limits uploads per participant", async () => {
    const test = await setup({ mediaUploadRateLimitMaxUploads: 1 });
    const creator = await createRoomViaHttp(test.runtime.app, { displayName: "Alex" });

    await upload(test, creator.room.id, creator.sessionToken, pngBytes()).expect(201);

    const limited = await upload(
      test,
      creator.room.id,
      creator.sessionToken,
      pngBytes(),
    ).expect(429);
    expect(limited.body.code).toBe("RATE_LIMITED");
  });

  it("deletes media when the room expires", async () => {
    let now = Date.now();
    const test = await setup({ now: () => now, roomMaxAgeMs: 1_000 });
    const creator = await createRoomViaHttp(test.runtime.app, { displayName: "Alex" });
    const uploaded = await upload(
      test,
      creator.room.id,
      creator.sessionToken,
      pngBytes(),
    ).expect(201);
    const { media } = chatMediaResponseSchema.parse(uploaded.body);

    expect(test.runtime.roomService.mediaStore.count).toBe(1);

    now += 5_000;
    test.runtime.sweep();

    expect(test.runtime.roomService.mediaStore.count).toBe(0);
    expect(test.runtime.roomService.mediaStore.getRoomBytes(creator.room.id)).toBe(0);

    await request(test.runtime.app)
      .get(`/api/rooms/${creator.room.id}/media/${media.id}`)
      .set("Authorization", `Bearer ${creator.sessionToken}`)
      .expect(401);
  });

  it("attaches media metadata to chat messages and keeps text-only messages unchanged", async () => {
    const test = await setup();
    const creator = await createRoomViaHttp(test.runtime.app, { displayName: "Alex" });
    const guest = await joinRoomViaHttp(test.runtime.app, creator.room.id, {
      displayName: "Sam",
    });
    const first = await connectSocket(test.url, creator.sessionToken);
    const second = await connectSocket(test.url, guest.sessionToken);

    const uploaded = await upload(
      test,
      creator.room.id,
      creator.sessionToken,
      pngBytes(320, 200),
    ).expect(201);
    const { media }: { media: ChatMedia } = chatMediaResponseSchema.parse(uploaded.body);

    const mediaDelivery = waitForChatMessage(second.socket);
    const mediaAck = await sendChatMessage(first.socket, { text: "", mediaId: media.id });
    expectAccepted(mediaAck);
    expect(mediaAck.message.text).toBe("");
    expect(mediaAck.message.media).toEqual(media);
    expect(await mediaDelivery).toEqual(mediaAck.message);

    const textDelivery = waitForChatMessage(second.socket);
    const textAck = await sendChatMessage(first.socket, { text: "Just text" });
    expectAccepted(textAck);
    expect(textAck.message).not.toHaveProperty("media");
    expect(await textDelivery).toEqual(textAck.message);

    const invalidAck = await sendChatMessage(first.socket, {
      text: "Missing image",
      mediaId: randomUUID().replaceAll("-", "").slice(0, 22),
    });
    expect(invalidAck).toEqual({ ok: false, code: "INVALID_INPUT" });

    await delay(30);
    expect(first.socket.connected).toBe(true);
    expect(second.socket.connected).toBe(true);

    first.socket.close();
    second.socket.close();
  });
});
