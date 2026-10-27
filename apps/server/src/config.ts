import { z } from "zod";

if (process.env.NODE_ENV !== "test") {
  try {
    process.loadEnvFile();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      throw error;
    }
  }
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  CORS_ORIGIN: z.url().default("http://localhost:5173"),
  WEB_ORIGIN: z.url().default("http://localhost:5173"),
  MAX_PARTICIPANTS: z.coerce.number().int().min(1).max(10).default(2),
  RECONNECT_GRACE_MS: z.coerce.number().int().min(1_000).max(600_000).default(30_000),
  EMPTY_ROOM_TTL_MS: z.coerce.number().int().min(1_000).default(300_000),
  ROOM_MAX_AGE_MS: z.coerce.number().int().min(60_000).default(43_200_000),
  CLEANUP_INTERVAL_MS: z.coerce.number().int().min(1_000).default(30_000),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
    .join("; ");
  throw new Error(`Invalid environment configuration: ${details}`);
}

export const config = {
  nodeEnv: parsed.data.NODE_ENV,
  port: parsed.data.PORT,
  corsOrigin: parsed.data.CORS_ORIGIN,
  webOrigin: parsed.data.WEB_ORIGIN,
  maxParticipants: parsed.data.MAX_PARTICIPANTS,
  reconnectGraceMs: parsed.data.RECONNECT_GRACE_MS,
  emptyRoomTtlMs: parsed.data.EMPTY_ROOM_TTL_MS,
  roomMaxAgeMs: parsed.data.ROOM_MAX_AGE_MS,
  cleanupIntervalMs: parsed.data.CLEANUP_INTERVAL_MS,
};
