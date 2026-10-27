const ROOM_ERROR_MESSAGES: Record<string, string> = {
  ROOM_NOT_FOUND: "This room does not exist or has expired.",
  ROOM_FULL: "This room is full.",
  BAD_PASSWORD: "That room password is incorrect.",
  INVALID_INPUT: "Please check the form and try again.",
  UNAUTHORIZED: "Your room session expired. Join the room again.",
  NETWORK: "Could not reach the Tempass server. Is it running?",
  INTERNAL: "Something went wrong. Please try again.",
};

export function roomErrorMessage(code: string, fallback?: string): string {
  return ROOM_ERROR_MESSAGES[code] ?? fallback ?? ROOM_ERROR_MESSAGES.INTERNAL ?? "Something went wrong.";
}
