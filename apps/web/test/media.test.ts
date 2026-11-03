import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatMedia } from "@tempass/shared";

import { createChatMediaLoader, uploadChatImage } from "../src/lib/media";

const MEDIA: ChatMedia = {
  id: "AAAAAAAAAAAAAAAAAAAAAA",
  mimeType: "image/png",
  sizeBytes: 128,
  width: 320,
  height: 200,
};

class FakeXMLHttpRequest {
  static last: FakeXMLHttpRequest | undefined;

  upload: { onprogress?: (event: ProgressEvent) => void } = {};
  responseType = "";
  status = 0;
  response: unknown = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  open = vi.fn();
  setRequestHeader = vi.fn();
  send = vi.fn();
  abort = vi.fn(() => {
    this.onabort?.();
  });

  constructor() {
    FakeXMLHttpRequest.last = this;
  }
}

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:object-1");
  URL.revokeObjectURL = vi.fn();
  FakeXMLHttpRequest.last = undefined;
  vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("uploadChatImage", () => {
  it("posts multipart form data and resolves the uploaded media", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "cat.png", { type: "image/png" });
    const promise = uploadChatImage("room-one", "token-one", file);
    const request = FakeXMLHttpRequest.last;

    expect(request).toBeDefined();
    expect(request?.open).toHaveBeenCalledWith(
      "POST",
      expect.stringContaining("/api/rooms/room-one/media"),
    );
    expect(request?.setRequestHeader).toHaveBeenCalledWith(
      "Authorization",
      "Bearer token-one",
    );

    request!.status = 201;
    request!.response = { media: MEDIA };
    request!.onload?.();

    await expect(promise).resolves.toEqual(MEDIA);
  });

  it("reports upload progress and rejects with the server error code", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "cat.png", { type: "image/png" });
    const onProgress = vi.fn();
    const promise = uploadChatImage("room-one", "token-one", file, { onProgress });
    const request = FakeXMLHttpRequest.last!;

    request.upload.onprogress?.({
      lengthComputable: true,
      loaded: 5,
      total: 10,
    } as ProgressEvent);

    expect(onProgress).toHaveBeenCalledWith(0.5);

    request.status = 413;
    request.response = { code: "MEDIA_TOO_LARGE", message: "Too big" };
    request.onload?.();

    await expect(promise).rejects.toMatchObject({ code: "MEDIA_TOO_LARGE", status: 413 });
  });

  it("rejects an already aborted upload without starting a request", async () => {
    const controller = new AbortController();
    controller.abort();
    const file = new File([new Uint8Array([1])], "cat.png", { type: "image/png" });

    await expect(
      uploadChatImage("room-one", "token-one", file, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(FakeXMLHttpRequest.last).toBeUndefined();
  });
});

describe("createChatMediaLoader", () => {
  it("fetches an image once, caches its object URL, and revokes it on dispose", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      blob: async () => new Blob(["image"], { type: "image/png" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const loader = createChatMediaLoader("room-one", "token-one");
    const first = loader.load(MEDIA.id);
    const second = loader.load(MEDIA.id);

    await expect(Promise.all([first, second])).resolves.toEqual([
      "blob:object-1",
      "blob:object-1",
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/api/rooms/room-one/media/${MEDIA.id}`),
      { headers: { Authorization: "Bearer token-one" } },
    );

    await expect(loader.load(MEDIA.id)).resolves.toBe("blob:object-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    loader.dispose();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:object-1");
    await expect(loader.load(MEDIA.id)).rejects.toMatchObject({ code: "INTERNAL" });
  });

  it("rejects with MEDIA_NOT_FOUND when the server refuses the image", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404 }),
    );

    const loader = createChatMediaLoader("room-one", "token-one");

    await expect(loader.load(MEDIA.id)).rejects.toMatchObject({
      code: "MEDIA_NOT_FOUND",
      status: 404,
    });
    loader.dispose();
  });
});
