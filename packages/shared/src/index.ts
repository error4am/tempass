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

export const MEDIA_ID_LENGTH = 22;
export const MAX_CHAT_IMAGE_BYTES = 10 * 1024 * 1024;
export const ROOM_MEDIA_MAX_BYTES = 50 * 1024 * 1024;
export const GLOBAL_MEDIA_MAX_BYTES = 256 * 1024 * 1024;

export const CHAT_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

export type ChatImageMimeType = (typeof CHAT_IMAGE_MIME_TYPES)[number];

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

const graphemeSegmenter =
  typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter("en", { granularity: "grapheme" })
    : null;

/**
 * Splits text into user-perceived characters. Falls back to code points when
 * Intl.Segmenter is unavailable.
 */
export function splitChatGraphemes(value: string): string[] {
  if (graphemeSegmenter) {
    return Array.from(graphemeSegmenter.segment(value), (segment) => segment.segment);
  }

  return Array.from(value);
}

export function countChatGraphemes(value: string): number {
  return splitChatGraphemes(value).length;
}

export const chatMessageTextSchema = z
  .string()
  .trim()
  .refine((value) => countChatGraphemes(value) <= MAX_CHAT_MESSAGE_LENGTH, {
    message: `Message must be at most ${MAX_CHAT_MESSAGE_LENGTH} characters`,
  })
  .refine((value) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value), {
    message: "Message contains invalid characters",
  });

export const chatMediaIdSchema = z
  .string()
  .regex(new RegExp(`^[A-Za-z0-9_-]{${MEDIA_ID_LENGTH}}$`), "Invalid media ID");

export const chatMediaSchema = z.object({
  id: chatMediaIdSchema,
  mimeType: z.enum(CHAT_IMAGE_MIME_TYPES),
  sizeBytes: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export type ChatMedia = z.infer<typeof chatMediaSchema>;

export const chatMediaResponseSchema = z.object({
  media: chatMediaSchema,
});

export type ChatMediaResponse = z.infer<typeof chatMediaResponseSchema>;

export const chatMessageSchema = z.object({
  id: z.string().min(1),
  senderId: z.string().min(1),
  senderName: displayNameSchema,
  text: chatMessageTextSchema,
  sentAt: z.iso.datetime(),
  media: chatMediaSchema.optional(),
});

export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const sendChatMessagePayloadSchema = z
  .object({
    text: chatMessageTextSchema.optional(),
    mediaId: chatMediaIdSchema.optional(),
  })
  .strict()
  .superRefine((payload, context) => {
    if (!payload.mediaId && (payload.text ?? "").length === 0) {
      context.addIssue({
        code: "custom",
        message: "A message must contain text, an image, or both",
        path: ["text"],
      });
    }
  });

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

/** The rates the player offers; YouTube accepts values in this range. */
export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

export const MIN_PLAYBACK_RATE = 0.25;
export const MAX_PLAYBACK_RATE = 2;

export const playbackRateSchema = z
  .number()
  .finite()
  .min(MIN_PLAYBACK_RATE)
  .max(MAX_PLAYBACK_RATE);

export const playbackStateSchema = z
  .object({
    videoId: youtubeVideoIdSchema.nullable(),
    status: playbackStatusSchema,
    positionSeconds: playbackPositionSchema,
    /** Absent means 1×; the server always writes it. */
    rate: playbackRateSchema.optional(),
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

const ratePlaybackCommandSchema = z
  .object({
    action: z.literal("rate"),
    videoId: youtubeVideoIdSchema,
    positionSeconds: playbackPositionSchema,
    rate: playbackRateSchema,
  })
  .strict();

export const playbackUpdateCommandSchema = z.discriminatedUnion("action", [
  playPlaybackCommandSchema,
  pausePlaybackCommandSchema,
  seekPlaybackCommandSchema,
  ratePlaybackCommandSchema,
]);

export const playbackCommandSchema = z.discriminatedUnion("action", [
  selectPlaybackCommandSchema,
  playPlaybackCommandSchema,
  pausePlaybackCommandSchema,
  seekPlaybackCommandSchema,
  ratePlaybackCommandSchema,
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

/**
 * Source-companion ("bridge") protocol.
 *
 * Some sites cannot be embedded and refuse framing, but a real user can still
 * play them in their own tab. The companion script — running on that tab —
 * owns the <video> element and reports its state to the room, while the room
 * sends play/pause/seek commands back to it.
 */
export const bridgeSourceSchema = z
  .object({
    url: z.string().url().max(2048),
    title: z.string().max(200).optional(),
  })
  .strict();

export const bridgeStateSchema = z
  .object({
    source: bridgeSourceSchema,
    status: z.enum(["playing", "paused"]),
    positionSeconds: playbackPositionSchema,
    durationSeconds: playbackPositionSchema,
    updatedAt: z.number().int().nonnegative(),
    revision: z.number().int().nonnegative(),
  })
  .strict();

export type BridgeState = z.infer<typeof bridgeStateSchema>;

/** What the companion reports; the server owns `updatedAt` and `revision`. */
export const bridgeStateReportSchema = z
  .object({
    source: bridgeSourceSchema,
    status: z.enum(["playing", "paused"]),
    positionSeconds: playbackPositionSchema,
    durationSeconds: playbackPositionSchema,
  })
  .strict();

export type BridgeStateReport = z.infer<typeof bridgeStateReportSchema>;

export const bridgeCommandSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("play"),
      positionSeconds: playbackPositionSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("pause"),
      positionSeconds: playbackPositionSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("seek"),
      positionSeconds: playbackPositionSchema,
    })
    .strict(),
]);

export type BridgeCommand = z.infer<typeof bridgeCommandSchema>;

export const bridgeStateAckSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      state: bridgeStateSchema,
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      code: z.enum(playbackErrorCodes),
    })
    .strict(),
]);

export type BridgeStateAck = z.infer<typeof bridgeStateAckSchema>;

/**
 * WebRTC signalling relay. The companion captures the presenter's tab and
 * offers it to each participant; the server only passes these payloads along.
 */
export const webrtcSignalSchema = z
  .object({
    to: z.string().min(1).max(64),
    data: z.unknown(),
  })
  .strict();

export type WebrtcSignal = z.infer<typeof webrtcSignalSchema>;

export const roomPeersSchema = z.object({
  peers: z.array(z.object({ socketId: z.string().min(1).max(64) }).strict()),
});

export type RoomPeers = z.infer<typeof roomPeersSchema>;

/**
 * Live tab sharing.
 *
 * One participant presents a single captured tab (view only, no remote
 * control). The server owns who is presenting so the two clients cannot both
 * start a stream; the media itself never touches the server.
 */
export const tabShareSurfaces = ["browser", "window", "monitor", "unknown"] as const;

export const tabShareSurfaceSchema = z.enum(tabShareSurfaces);

export type TabShareSurface = z.infer<typeof tabShareSurfaceSchema>;

export const tabShareStateSchema = z
  .object({
    presenterId: z.string().min(1),
    presenterName: displayNameSchema,
    /** Server clock, so both clients can show the same start time. */
    startedAt: z.number().int().nonnegative(),
    surface: tabShareSurfaceSchema,
  })
  .strict();

export type TabShareState = z.infer<typeof tabShareStateSchema>;

export const tabShareStartPayloadSchema = z
  .object({
    surface: tabShareSurfaceSchema,
  })
  .strict();

export type TabShareStartPayload = z.infer<typeof tabShareStartPayloadSchema>;

export const tabShareErrorCodes = [
  "INVALID_INPUT",
  "UNAUTHORIZED",
  "SHARE_BUSY",
] as const;

export type TabShareErrorCode = (typeof tabShareErrorCodes)[number];

export const tabShareAckSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      state: tabShareStateSchema.nullable(),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      code: z.enum(tabShareErrorCodes),
    })
    .strict(),
]);

export type TabShareAck = z.infer<typeof tabShareAckSchema>;

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
    /**
     * "participant" (default) is a person watching in the Tempass room.
     * "bridge" is the companion script running on the source website: it owns
     * the <video> element and is the only client allowed to report media state.
     */
    role: z.enum(["participant", "bridge"]).optional(),
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
  "MEDIA_NOT_FOUND",
  "UNSUPPORTED_MEDIA_TYPE",
  "MEDIA_TOO_LARGE",
  "MEDIA_LIMIT_REACHED",
  "RATE_LIMITED",
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
  BRIDGE_STATE: "bridge:state",
  BRIDGE_COMMAND: "bridge:command",
  ROOM_PEERS: "room:peers",
  WEBRTC_SIGNAL: "webrtc:signal",
  SHARE_START: "share:start",
  SHARE_STOP: "share:stop",
  SHARE_STATE: "share:state",
} as const;

export interface ClientToServerEvents {
  "room:leave": (payload: unknown, ack?: (response: LeaveRoomAck) => void) => void;
  "chat:message": (payload: unknown, ack?: (response: ChatSendAck) => void) => void;
  "playback:command": (
    payload: unknown,
    ack?: (response: PlaybackCommandAck) => void,
  ) => void;
  "clock:sync": (payload: unknown, ack?: (response: ClockSyncAck) => void) => void;
  "bridge:state": (payload: unknown, ack?: (response: BridgeStateAck) => void) => void;
  "bridge:command": (payload: unknown, ack?: (response: { ok: boolean }) => void) => void;
  "webrtc:signal": (payload: unknown, ack?: (response: { ok: boolean }) => void) => void;
  "share:start": (payload: unknown, ack?: (response: TabShareAck) => void) => void;
  "share:stop": (payload: unknown, ack?: (response: TabShareAck) => void) => void;
}

export interface ServerToClientEvents {
  "room:snapshot": (snapshot: RoomSnapshot) => void;
  "presence:update": (update: PresenceUpdate) => void;
  "chat:message": (message: ChatMessage) => void;
  "playback:state": (update: PlaybackUpdate) => void;
  "bridge:state": (state: BridgeState | null) => void;
  "bridge:command": (command: BridgeCommand) => void;
  "room:peers": (peers: RoomPeers) => void;
  "webrtc:signal": (message: { from: string; data: unknown }) => void;
  "share:state": (state: TabShareState | null) => void;
}

export function roomInvitePath(roomId: string): string {
  return `/join/${roomId}`;
}
