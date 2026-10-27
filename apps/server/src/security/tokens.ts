import { createHash, randomBytes } from "node:crypto";

const ROOM_ID_BYTES = 16;
const PARTICIPANT_ID_BYTES = 16;
const MESSAGE_ID_BYTES = 16;
const SESSION_TOKEN_BYTES = 32;

export function createRoomId(): string {
  return randomBytes(ROOM_ID_BYTES).toString("base64url");
}

export function createParticipantId(): string {
  return randomBytes(PARTICIPANT_ID_BYTES).toString("base64url");
}

export function createMessageId(): string {
  return randomBytes(MESSAGE_ID_BYTES).toString("base64url");
}

export function createSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
