import { youtubeVideoIdSchema } from "@tempass/shared";

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);

const SHORT_HOSTS = new Set(["youtu.be", "www.youtu.be"]);

export function isYouTubeVideoId(value: string): boolean {
  return youtubeVideoIdSchema.safeParse(value).success;
}

export function parseYouTubeVideoId(value: string): string | null {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  if (isYouTubeVideoId(trimmed)) {
    return trimmed;
  }

  const withProtocol = /^[A-Za-z][A-Za-z\d+.-]*:\/\//.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let url: URL;

  try {
    url = new URL(withProtocol);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return null;
  }

  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split("/").filter(Boolean);

  if (SHORT_HOSTS.has(host)) {
    return segments.length === 1 && isYouTubeVideoId(segments[0] ?? "")
      ? (segments[0] ?? null)
      : null;
  }

  if (!YOUTUBE_HOSTS.has(host)) {
    return null;
  }

  if (segments.length === 1 && segments[0] === "watch") {
    const videoId = url.searchParams.get("v");
    return videoId !== null && isYouTubeVideoId(videoId) ? videoId : null;
  }

  if (
    segments.length === 2 &&
    (segments[0] === "embed" || segments[0] === "shorts" || segments[0] === "live")
  ) {
    const videoId = segments[1] ?? "";
    return isYouTubeVideoId(videoId) ? videoId : null;
  }

  return null;
}
