import type { RoomErrorCode } from "@tempass/shared";

const STATUS_BY_CODE: Record<RoomErrorCode, number> = {
  ROOM_NOT_FOUND: 404,
  ROOM_FULL: 409,
  BAD_PASSWORD: 401,
  INVALID_INPUT: 400,
  UNAUTHORIZED: 401,
  INTERNAL: 500,
};

const MESSAGE_BY_CODE: Record<RoomErrorCode, string> = {
  ROOM_NOT_FOUND: "Room not found or expired",
  ROOM_FULL: "This room is full",
  BAD_PASSWORD: "Incorrect room password",
  INVALID_INPUT: "Invalid request data",
  UNAUTHORIZED: "Not authorized",
  INTERNAL: "Something went wrong",
};

export class RoomError extends Error {
  readonly code: RoomErrorCode;
  readonly status: number;

  constructor(code: RoomErrorCode, message: string = MESSAGE_BY_CODE[code]) {
    super(message);
    this.name = "RoomError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
  }
}
