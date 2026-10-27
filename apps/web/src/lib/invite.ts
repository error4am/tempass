import { ROOM_ID_LENGTH } from "@tempass/shared";

const ROOM_ID_PATTERN = new RegExp(`^[A-Za-z0-9_-]{${ROOM_ID_LENGTH}}$`);

export function extractRoomId(input: string): string | null {
  const trimmed = input.trim();

  if (ROOM_ID_PATTERN.test(trimmed)) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed, "http://tempass.local");
    const match = /^\/(?:join|room)\/([^/]+)\/?$/.exec(url.pathname);

    if (match?.[1] && ROOM_ID_PATTERN.test(match[1])) {
      return match[1];
    }
  } catch {
    return null;
  }

  return null;
}
