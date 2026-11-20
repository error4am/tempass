export function normalizeApiBaseUrl(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed.replace(/\/+$/, "") : "";
}

export const API_BASE_URL = normalizeApiBaseUrl(import.meta.env.VITE_API_URL);

export function joinApiUrl(baseUrl: string, path: string): string {
  if (!baseUrl) {
    return path;
  }

  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

export function apiUrl(path: string): string {
  return joinApiUrl(API_BASE_URL, path);
}

/** Public STUN is enough on most home networks, but not behind strict NATs. */
export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
];

function isIceServer(value: unknown): value is RTCIceServer {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as { urls?: unknown; username?: unknown; credential?: unknown };
  const urls = candidate.urls;

  if (typeof urls !== "string" && !Array.isArray(urls)) {
    return false;
  }

  const list = Array.isArray(urls) ? urls : [urls];

  return (
    list.length > 0 &&
    list.every((url) => typeof url === "string" && url.length > 0) &&
    (candidate.username === undefined || typeof candidate.username === "string") &&
    (candidate.credential === undefined || typeof candidate.credential === "string")
  );
}

/**
 * `VITE_ICE_SERVERS` is a JSON array of RTCIceServer entries, for example:
 * `[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:turn.example.com:3478","username":"u","credential":"p"}]`
 */
export function parseIceServers(value: string | undefined): RTCIceServer[] {
  const trimmed = value?.trim();

  if (!trimmed) {
    return DEFAULT_ICE_SERVERS;
  }

  try {
    const parsed: unknown = JSON.parse(trimmed);

    if (Array.isArray(parsed)) {
      const servers = parsed.filter(isIceServer);

      if (servers.length > 0) {
        return servers;
      }
    }
  } catch {
    /* fall through to the defaults */
  }

  return DEFAULT_ICE_SERVERS;
}

export const ICE_SERVERS = parseIceServers(import.meta.env.VITE_ICE_SERVERS);
