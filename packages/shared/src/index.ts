import { z } from "zod";

export const APP_NAME = "Tempass";

export const MAX_DISPLAY_NAME_LENGTH = 24;
export const MIN_PASSWORD_LENGTH = 4;
export const MAX_PASSWORD_LENGTH = 64;
export const ROOM_ID_LENGTH = 22;
export const MAX_CHAT_MESSAGE_LENGTH = 500;
export const CHAT_HISTORY_LIMIT = 100;
export const YOUTUBE_VIDEO_ID_LENGTH = 11;
export const MAX_PLAYBACK_POSITION_SECONDS = 86_400;

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

export const chatMessageTextSchema = z
  .string()
  .trim()
  .min(1, "Message cannot be empty")
  .max(MAX_CHAT_MESSAGE_LENGTH, `Message must be at most ${MAX_CHAT_MESSAGE_LENGTH} characters`)
  .refine((value) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value), {
    message: "Message contains invalid characters",
  });

export const chatMessageSchema = z.object({
  id: z.string().min(1),
  senderId: z.string().min(1),
  senderName: displayNameSchema,
  text: chatMessageTextSchema,
  sentAt: z.iso.datetime(),
});

export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const sendChatMessagePayloadSchema = z
  .object({
    text: chatMessageTextSchema,
  })
  .strict();

export type SendChatMessagePayload = z.infer<typeof sendChatMessagePayloadSchema>;

export const chatErrorCodes = [
  "INVALID_INPUT",
  "UNAUTHORIZED",
  "RATE_LIMITED",
  "INTERNAL",
] as const;

export type ChatErrorCode = (typeof chatErrorCodes)[number];

export const chatSendAckSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    message: chatMessageSchema,
  }),
  z.object({
    ok: z.literal(false),
    code: z.enum(chatErrorCodes),
  }),
]);

export type ChatSendAck = z.infer<typeof chatSendAckSchema>;

export const youtubeVideoIdSchema = z
  .string()
  .regex(
    new RegExp(`^[A-Za-z0-9_-]{${YOUTUBE_VIDEO_ID_LENGTH}}$`),
    "Invalid YouTube video ID",
  );

export const playbackPositionSchema = z
  .number()
  .finite()
  .min(0)
  .max(MAX_PLAYBACK_POSITION_SECONDS);

export const playbackStatusSchema = z.enum(["idle", "paused", "playing"]);

export const playbackStateSchema = z
  .object({
    videoId: youtubeVideoIdSchema.nullable(),
    status: playbackStatusSchema,
    positionSeconds: playbackPositionSchema,
    updatedAt: z.number().int().nonnegative(),
    revision: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((state, context) => {
    if ((state.status === "idle") !== (state.videoId === null)) {
      context.addIssue({
        code: "custom",
        message: "Idle playback must not have a video; active playback must have one",
      });
    }
  });

export type PlaybackStatus = z.infer<typeof playbackStatusSchema>;
export type PlaybackState = z.infer<typeof playbackStateSchema>;

const selectPlaybackCommandSchema = z
  .object({
    action: z.literal("select"),
    videoId: youtubeVideoIdSchema,
  })
  .strict();

const playPlaybackCommandSchema = z
  .object({
    action: z.literal("play"),
    videoId: youtubeVideoIdSchema,
    positionSeconds: playbackPositionSchema,
  })
  .strict();

const pausePlaybackCommandSchema = z
  .object({
    action: z.literal("pause"),
    videoId: youtubeVideoIdSchema,
    positionSeconds: playbackPositionSchema,
  })
  .strict();

const seekPlaybackCommandSchema = z
  .object({
    action: z.literal("seek"),
    videoId: youtubeVideoIdSchema,
    positionSeconds: playbackPositionSchema,
  })
  .strict();

export const playbackUpdateCommandSchema = z.discriminatedUnion("action", [
  playPlaybackCommandSchema,
  pausePlaybackCommandSchema,
  seekPlaybackCommandSchema,
]);

export const playbackCommandSchema = z.discriminatedUnion("action", [
  selectPlaybackCommandSchema,
  playPlaybackCommandSchema,
  pausePlaybackCommandSchema,
  seekPlaybackCommandSchema,
]);

export type PlaybackUpdateCommand = z.infer<typeof playbackUpdateCommandSchema>;
export type PlaybackCommand = z.infer<typeof playbackCommandSchema>;

export const playbackErrorCodes = [
  "INVALID_INPUT",
  "UNAUTHORIZED",
  "VIDEO_MISMATCH",
  "RATE_LIMITED",
  "INTERNAL",
] as const;

export type PlaybackErrorCode = (typeof playbackErrorCodes)[number];

export const playbackUpdateSchema = z
  .object({
    state: playbackStateSchema,
    serverTime: z.number().int().nonnegative(),
  })
  .strict();

export type PlaybackUpdate = z.infer<typeof playbackUpdateSchema>;

export const clockSyncRequestSchema = z
  .object({
    clientTime: z.number().int().nonnegative(),
  })
  .strict();

export type ClockSyncRequest = z.infer<typeof clockSyncRequestSchema>;

export const clockSyncErrorCodes = [
  "INVALID_INPUT",
  "UNAUTHORIZED",
  "INTERNAL",
] as const;

export type ClockSyncErrorCode = (typeof clockSyncErrorCodes)[number];

export const clockSyncAckSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      clientTime: z.number().int().nonnegative(),
      serverTime: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      code: z.enum(clockSyncErrorCodes),
    })
    .strict(),
]);

export type ClockSyncAck = z.infer<typeof clockSyncAckSchema>;

export const playbackCommandAckSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      state: playbackStateSchema,
      serverTime: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      code: z.enum(playbackErrorCodes),
    })
    .strict(),
]);

export type PlaybackCommandAck = z.infer<typeof playbackCommandAckSchema>;

export const roomSnapshotSchema = z.object({
  room: publicRoomSchema,
  self: publicParticipantSchema,
  participants: z.array(publicParticipantSchema),
  messages: z.array(chatMessageSchema),
  playback: playbackStateSchema,
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
  "VIDEO_MISMATCH",
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
  CHAT_MESSAGE: "chat:message",
  PLAYBACK_COMMAND: "playback:command",
  PLAYBACK_STATE: "playback:state",
  CLOCK_SYNC: "clock:sync",
} as const;

export interface ClientToServerEvents {
  "room:leave": (payload: unknown, ack?: (response: LeaveRoomAck) => void) => void;
  "chat:message": (payload: unknown, ack?: (response: ChatSendAck) => void) => void;
  "playback:command": (
    payload: unknown,
    ack?: (response: PlaybackCommandAck) => void,
  ) => void;
  "clock:sync": (payload: unknown, ack?: (response: ClockSyncAck) => void) => void;
}

export interface ServerToClientEvents {
  "room:snapshot": (snapshot: RoomSnapshot) => void;
  "presence:update": (update: PresenceUpdate) => void;
  "chat:message": (message: ChatMessage) => void;
  "playback:state": (update: PlaybackUpdate) => void;
}

export function roomInvitePath(roomId: string): string {
  return `/join/${roomId}`;
}
