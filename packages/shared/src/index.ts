import { z } from "zod";

export const APP_NAME = "Tempass";

export const MAX_DISPLAY_NAME_LENGTH = 24;
export const MIN_PASSWORD_LENGTH = 4;
export const MAX_PASSWORD_LENGTH = 64;
export const ROOM_ID_LENGTH = 22;

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.string().min(1),
  uptime: z.number().nonnegative(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const roomIdSchema = z
  .string()
  .regex(new RegExp(`^[A-Za-z0-9_-]{${ROOM_ID_LENGTH}}$`), "Invalid room ID");

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, "Display name is required")
  .max(MAX_DISPLAY_NAME_LENGTH, `Display name must be at most ${MAX_DISPLAY_NAME_LENGTH} characters`)
  .refine((value) => !/[\u0000-\u001F\u007F]/.test(value), {
    message: "Display name contains invalid characters",
  });

export const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
  .max(MAX_PASSWORD_LENGTH, `Password must be at most ${MAX_PASSWORD_LENGTH} characters`);

export const createRoomRequestSchema = z
  .object({
    displayName: displayNameSchema,
    password: passwordSchema.optional(),
  })
  .strict();

export const joinRoomRequestSchema = z
  .object({
    displayName: displayNameSchema,
    password: passwordSchema.optional(),
  })
  .strict();

export type CreateRoomRequest = z.infer<typeof createRoomRequestSchema>;
export type JoinRoomRequest = z.infer<typeof joinRoomRequestSchema>;

export const publicParticipantSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  connected: z.boolean(),
  joinedAt: z.number().int().nonnegative(),
});

export type PublicParticipant = z.infer<typeof publicParticipantSchema>;

export const publicRoomSchema = z.object({
  id: roomIdSchema,
  createdAt: z.number().int().nonnegative(),
  requiresPassword: z.boolean(),
  capacity: z.number().int().positive(),
  participantCount: z.number().int().nonnegative(),
});

export type PublicRoom = z.infer<typeof publicRoomSchema>;

export const roomAccessResponseSchema = z.object({
  room: publicRoomSchema,
  participant: publicParticipantSchema,
  sessionToken: z.string().min(20),
  inviteUrl: z.url(),
});

export type RoomAccessResponse = z.infer<typeof roomAccessResponseSchema>;

export const roomSnapshotSchema = z.object({
  room: publicRoomSchema,
  self: publicParticipantSchema,
  participants: z.array(publicParticipantSchema),
  serverTime: z.number().int().nonnegative(),
});

export type RoomSnapshot = z.infer<typeof roomSnapshotSchema>;

export const presenceUpdateSchema = z.object({
  participants: z.array(publicParticipantSchema),
  serverTime: z.number().int().nonnegative(),
});

export type PresenceUpdate = z.infer<typeof presenceUpdateSchema>;

export const socketAuthSchema = z
  .object({
    token: z.string().min(20).max(200),
  })
  .strict();

export type SocketAuth = z.infer<typeof socketAuthSchema>;

export const leaveRoomPayloadSchema = z.object({}).strict();

export const leaveRoomAckSchema = z.object({
  ok: z.boolean(),
  code: z.string().optional(),
});

export type LeaveRoomAck = z.infer<typeof leaveRoomAckSchema>;

export const roomErrorCodes = [
  "ROOM_NOT_FOUND",
  "ROOM_FULL",
  "BAD_PASSWORD",
  "INVALID_INPUT",
  "UNAUTHORIZED",
  "INTERNAL",
] as const;

export type RoomErrorCode = (typeof roomErrorCodes)[number];

export const apiErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
});

export type ApiErrorBody = z.infer<typeof apiErrorSchema>;

export const SOCKET_EVENTS = {
  ROOM_SNAPSHOT: "room:snapshot",
  PRESENCE_UPDATE: "presence:update",
  ROOM_LEAVE: "room:leave",
} as const;

export interface ClientToServerEvents {
  "room:leave": (payload: unknown, ack?: (response: LeaveRoomAck) => void) => void;
}

export interface ServerToClientEvents {
  "room:snapshot": (snapshot: RoomSnapshot) => void;
  "presence:update": (update: PresenceUpdate) => void;
}

export function roomInvitePath(roomId: string): string {
  return `/join/${roomId}`;
}
