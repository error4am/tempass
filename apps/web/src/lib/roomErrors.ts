const ROOM_ERROR_MESSAGES: Record<string, string> = {
  ROOM_NOT_FOUND: "This room does not exist or has expired.",
  ROOM_FULL: "This room is full.",
  BAD_PASSWORD: "That room password is incorrect.",
  INVALID_INPUT: "Please check the form and try again.",
  UNAUTHORIZED: "Your room session expired. Join the room again.",
  NETWORK: "Could not reach the Tempass server. Is it running?",
  INTERNAL: "Something went wrong. Please try again.",
};

const PLAYBACK_ERROR_MESSAGES: Record<string, string> = {
  INVALID_INPUT: "That playback command was not valid. Try again.",
  UNAUTHORIZED: "Your room session expired. Join the room again.",
  VIDEO_MISMATCH: "That video changed. The latest selection is shown.",
  RATE_LIMITED: "Playback is moving too quickly. Try again in a moment.",
  INTERNAL: "Could not update playback. Please try again.",
};

const CHAT_ERROR_MESSAGES: Record<string, string> = {
  INVALID_INPUT: "That message could not be sent. Check it and try again.",
  UNAUTHORIZED: "Your room session expired. Join the room again to chat.",
  RATE_LIMITED: "You are sending messages too quickly. Wait a moment and try again.",
  INTERNAL: "Could not send the message. Please try again.",
};

export function roomErrorMessage(code: string, fallback?: string): string {
  return ROOM_ERROR_MESSAGES[code] ?? fallback ?? ROOM_ERROR_MESSAGES.INTERNAL ?? "Something went wrong.";
}

export function chatErrorMessage(code: string): string {
  return CHAT_ERROR_MESSAGES[code] ?? CHAT_ERROR_MESSAGES.INTERNAL ?? "Could not send the message.";
}

export function playbackErrorMessage(code: string): string {
  return (
    PLAYBACK_ERROR_MESSAGES[code] ??
    PLAYBACK_ERROR_MESSAGES.INTERNAL ??
    "Could not update playback."
  );
}
