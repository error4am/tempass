import {
  apiErrorSchema,
  chatMediaResponseSchema,
  type ChatMedia,
} from "@tempass/shared";

import { ApiError } from "./api";
import { apiUrl } from "./config";

export interface UploadImageOptions {
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export interface ChatMediaLoader {
  load: (mediaId: string) => Promise<string>;
  dispose: () => void;
}

export function uploadChatImage(
  roomId: string,
  token: string,
  file: File,
  options: UploadImageOptions = {},
): Promise<ChatMedia> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(abortError());
      return;
    }

    const request = new XMLHttpRequest();
    const form = new FormData();
    form.append("image", file, file.name);

    request.open("POST", apiUrl(`/api/rooms/${encodeURIComponent(roomId)}/media`));
    request.setRequestHeader("Authorization", `Bearer ${token}`);
    request.responseType = "json";

    const handleAbort = () => {
      request.abort();
    };

    const cleanup = () => {
      options.signal?.removeEventListener("abort", handleAbort);
    };

    options.signal?.addEventListener("abort", handleAbort, { once: true });

    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        options.onProgress?.(Math.min(1, event.loaded / event.total));
      }
    };

    request.onload = () => {
      cleanup();

      if (request.status >= 200 && request.status < 300) {
        const parsed = chatMediaResponseSchema.safeParse(request.response);

        if (!parsed.success) {
          reject(new ApiError("INTERNAL", "The server returned an unexpected response", request.status));
          return;
        }

        options.onProgress?.(1);
        resolve(parsed.data.media);
        return;
      }

      reject(toApiError(request.response, request.status));
    };

    request.onerror = () => {
      cleanup();
      reject(new ApiError("NETWORK", "Could not reach the Tempass server", 0));
    };

    request.onabort = () => {
      cleanup();
      reject(abortError());
    };

    request.send(form);
  });
}

export function createChatMediaLoader(roomId: string, token: string): ChatMediaLoader {
  const urls = new Map<string, string>();
  const pending = new Map<string, Promise<string>>();
  let disposed = false;

  function load(mediaId: string): Promise<string> {
    if (disposed) {
      // React StrictMode runs an effect's cleanup and setup again in
      // development, so the same loader is disposed and then reused. Revive it
      // instead of failing every image in the room.
      disposed = false;
    }

    const cached = urls.get(mediaId);

    if (cached) {
      return Promise.resolve(cached);
    }

    const inFlight = pending.get(mediaId);

    if (inFlight) {
      return inFlight;
    }

    const promise = (async () => {
      let response: Response;

      try {
        response = await fetch(
          apiUrl(
            `/api/rooms/${encodeURIComponent(roomId)}/media/${encodeURIComponent(mediaId)}`,
          ),
          { headers: { Authorization: `Bearer ${token}` } },
        );
      } catch {
        throw new ApiError("NETWORK", "Could not reach the Tempass server", 0);
      }

      if (!response.ok) {
        throw new ApiError("MEDIA_NOT_FOUND", "That image is no longer available", response.status);
      }

      const blob = await response.blob();

      if (disposed) {
        throw new ApiError("INTERNAL", "The room is closed", 0);
      }

      const url = URL.createObjectURL(blob);
      urls.set(mediaId, url);
      return url;
    })().finally(() => {
      pending.delete(mediaId);
    });

    pending.set(mediaId, promise);
    return promise;
  }

  function dispose() {
    disposed = true;

    for (const url of urls.values()) {
      URL.revokeObjectURL(url);
    }

    urls.clear();
    pending.clear();
  }

  return { load, dispose };
}

function toApiError(body: unknown, status: number): ApiError {
  const parsed = apiErrorSchema.safeParse(body);

  if (parsed.success) {
    return new ApiError(parsed.data.code, parsed.data.message, status);
  }

  return new ApiError("INTERNAL", "The server returned an unexpected response", status);
}

function abortError(): Error {
  const error = new Error("Upload cancelled");
  error.name = "AbortError";
  return error;
}
