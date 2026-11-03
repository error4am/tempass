import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MAX_CHAT_IMAGE_BYTES,
  type ChatMedia,
  type ChatMessage,
  type ChatSendAck,
} from "@tempass/shared";

import { ChatPanel } from "../src/components/ChatPanel";

const MEDIA: ChatMedia = {
  id: "AAAAAAAAAAAAAAAAAAAAAA",
  mimeType: "image/png",
  sizeBytes: 128,
  width: 320,
  height: 200,
};

const ACCEPTED: ChatSendAck = {
  ok: true,
  message: {
    id: "message-media",
    senderId: "participant-alex",
    senderName: "Alex",
    text: "",
    sentAt: "2026-01-02T03:06:00.000Z",
    media: MEDIA,
  },
};

function imageFile(name = "cat.png", type = "image/png", size = 128): File {
  const file = new File([new Uint8Array(Math.min(size, 256))], name, { type });

  if (size > file.size) {
    Object.defineProperty(file, "size", { value: size });
  }

  return file;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ChatPanel image sharing", () => {
  it("uploads an image and sends it with an empty text body", async () => {
    const upload = deferred<ChatMedia>();
    const onUploadImage = vi.fn(() => upload.promise);
    const onSend = vi.fn().mockResolvedValue(ACCEPTED);

    render(
      <ChatPanel
        messages={[]}
        selfId="participant-alex"
        connected
        onSend={onSend}
        onUploadImage={onUploadImage}
      />,
    );

    fireEvent.change(screen.getByLabelText("Image file"), {
      target: { files: [imageFile()] },
    });

    expect(onUploadImage).toHaveBeenCalledTimes(1);
    expect(screen.getByAltText("Selected image preview").getAttribute("src")).toBe(
      "blob:preview",
    );
    expect(
      (screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled,
    ).toBe(true);

    await act(async () => {
      upload.resolve(MEDIA);
    });

    await screen.findByText("Ready to send");

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith("", MEDIA.id);
    });
    await waitFor(() => {
      expect(screen.queryByAltText("Selected image preview")).toBeNull();
    });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
  });

  it("reports upload progress and blocks sending until the upload completes", async () => {
    const upload = deferred<ChatMedia>();
    let reportProgress: ((fraction: number) => void) | undefined;
    const onUploadImage = vi.fn(
      (
        _file: File,
        options: { onProgress: (fraction: number) => void; signal: AbortSignal },
      ) => {
        reportProgress = options.onProgress;
        return upload.promise;
      },
    );

    render(
      <ChatPanel
        messages={[]}
        selfId="participant-alex"
        connected
        onSend={vi.fn()}
        onUploadImage={onUploadImage}
      />,
    );

    fireEvent.change(screen.getByLabelText("Image file"), {
      target: { files: [imageFile()] },
    });

    expect(screen.getByLabelText("Upload progress")).toBeTruthy();

    await act(async () => {
      reportProgress?.(0.42);
    });

    expect(screen.getByText("42%")).toBeTruthy();

    await act(async () => {
      upload.resolve(MEDIA);
    });

    await screen.findByText("Ready to send");
    expect(
      (screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("shows upload errors, keeps the preview removable, and never sends", async () => {
    const onUploadImage = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error("too large"), { code: "MEDIA_TOO_LARGE" }));
    const onSend = vi.fn();

    render(
      <ChatPanel
        messages={[]}
        selfId="participant-alex"
        connected
        onSend={onSend}
        onUploadImage={onUploadImage}
      />,
    );

    fireEvent.change(screen.getByLabelText("Image file"), {
      target: { files: [imageFile()] },
    });

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("too large");
    });
    expect(screen.getByAltText("Selected image preview")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled,
    ).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(screen.queryByAltText("Selected image preview")).toBeNull();
    expect(onSend).not.toHaveBeenCalled();
  });

  it("retries a failed upload with the same file", async () => {
    const file = imageFile();
    const onUploadImage = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("failed"), { code: "INTERNAL" }))
      .mockResolvedValueOnce(MEDIA);

    render(
      <ChatPanel
        messages={[]}
        selfId="participant-alex"
        connected
        onSend={vi.fn()}
        onUploadImage={onUploadImage}
      />,
    );

    fireEvent.change(screen.getByLabelText("Image file"), { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("Could not upload");
    });

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await screen.findByText("Ready to send");

    expect(onUploadImage).toHaveBeenCalledTimes(2);
    expect(onUploadImage).toHaveBeenLastCalledWith(
      file,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("aborts the upload and revokes the preview when removed", async () => {
    const upload = deferred<ChatMedia>();
    let signal: AbortSignal | undefined;
    const onUploadImage = vi.fn(
      (
        _file: File,
        options: { onProgress: (fraction: number) => void; signal: AbortSignal },
      ) => {
        signal = options.signal;
        return upload.promise;
      },
    );

    render(
      <ChatPanel
        messages={[]}
        selfId="participant-alex"
        connected
        onSend={vi.fn()}
        onUploadImage={onUploadImage}
      />,
    );

    fireEvent.change(screen.getByLabelText("Image file"), {
      target: { files: [imageFile()] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(signal?.aborted).toBe(true);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
    expect(screen.queryByAltText("Selected image preview")).toBeNull();

    await act(async () => {
      upload.reject(Object.assign(new Error("cancelled"), { name: "AbortError" }));
    });
  });

  it("rejects unsupported and oversized files before uploading", async () => {
    const onUploadImage = vi.fn();

    render(
      <ChatPanel
        messages={[]}
        selfId="participant-alex"
        connected
        onSend={vi.fn()}
        onUploadImage={onUploadImage}
      />,
    );

    fireEvent.change(screen.getByLabelText("Image file"), {
      target: { files: [imageFile("vector.svg", "image/svg+xml")] },
    });

    expect(screen.getByRole("alert").textContent).toContain("JPEG, PNG, WebP, or GIF");
    expect(onUploadImage).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Image file"), {
      target: { files: [imageFile("huge.png", "image/png", MAX_CHAT_IMAGE_BYTES + 1)] },
    });

    expect(screen.getByRole("alert").textContent).toContain("10 MB or smaller");
    expect(onUploadImage).not.toHaveBeenCalled();
  });

  it("loads an image message lazily and opens it in a dismissible viewer", async () => {
    const message: ChatMessage = {
      id: "message-with-image",
      senderId: "participant-sam",
      senderName: "Sam",
      text: "",
      sentAt: "2026-01-02T03:05:00.000Z",
      media: MEDIA,
    };
    const loadImageUrl = vi.fn().mockResolvedValue("blob:fetched-image");

    render(
      <ChatPanel
        messages={[message]}
        selfId="participant-alex"
        connected
        onSend={vi.fn()}
        loadImageUrl={loadImageUrl}
      />,
    );

    const image = await screen.findByAltText("Shared image");
    expect(loadImageUrl).toHaveBeenCalledWith(MEDIA.id);
    expect(image.getAttribute("loading")).toBe("lazy");
    expect(image.getAttribute("width")).toBe("320");
    expect(image.getAttribute("height")).toBe("200");

    fireEvent.click(screen.getByRole("button", { name: "Open image" }));
    expect(screen.getByRole("dialog", { name: "Shared image" })).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("shows an unavailable placeholder when image loading fails", async () => {
    const message: ChatMessage = {
      id: "message-broken-image",
      senderId: "participant-sam",
      senderName: "Sam",
      text: "missing",
      sentAt: "2026-01-02T03:05:00.000Z",
      media: MEDIA,
    };

    render(
      <ChatPanel
        messages={[message]}
        selfId="participant-alex"
        connected
        onSend={vi.fn()}
        loadImageUrl={vi.fn().mockRejectedValue(new Error("gone"))}
      />,
    );

    await screen.findByText("Image unavailable.");
    expect(screen.queryByAltText("Shared image")).toBeNull();
  });
});
