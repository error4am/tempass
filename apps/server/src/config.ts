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

const originSchema = z
  .url()
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  }, "must use HTTP or HTTPS")
  .transform((value) => value.replace(/\/+$/, ""));

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    HOST: z.string().trim().min(1).optional(),
    CORS_ORIGIN: originSchema.default("http://localhost:5173"),
    WEB_ORIGIN: originSchema.default("http://localhost:5173"),
    MAX_PARTICIPANTS: z.coerce.number().int().min(1).max(10).default(2),
    RECONNECT_GRACE_MS: z.coerce.number().int().min(1_000).max(600_000).default(30_000),
    EMPTY_ROOM_TTL_MS: z.coerce.number().int().min(1_000).default(300_000),
    ROOM_MAX_AGE_MS: z.coerce.number().int().min(60_000).default(43_200_000),
    CLEANUP_INTERVAL_MS: z.coerce.number().int().min(1_000).default(30_000),
  })
  .superRefine((value, context) => {
    if (value.NODE_ENV !== "production") {
      return;
    }

    for (const key of ["CORS_ORIGIN", "WEB_ORIGIN"] as const) {
      const origin = new URL(value[key]);

      if (origin.protocol !== "https:") {
        context.addIssue({
          code: "custom",
          path: [key],
          message: `${key} must use HTTPS in production`,
        });
      }

      if (isLocalHostname(origin.hostname)) {
        context.addIssue({
          code: "custom",
          path: [key],
          message: `${key} must not use localhost in production`,
        });
      }
    }
  });

function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  host: string;
  port: number;
  corsOrigin: string;
  webOrigin: string;
  maxParticipants: number;
  reconnectGraceMs: number;
  emptyRoomTtlMs: number;
  roomMaxAgeMs: number;
  cleanupIntervalMs: number;
}

export function parseConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  return {
    nodeEnv: parsed.data.NODE_ENV,
    host:
      parsed.data.HOST ?? (parsed.data.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1"),
    port: parsed.data.PORT,
    corsOrigin: parsed.data.CORS_ORIGIN,
    webOrigin: parsed.data.WEB_ORIGIN,
    maxParticipants: parsed.data.MAX_PARTICIPANTS,
    reconnectGraceMs: parsed.data.RECONNECT_GRACE_MS,
    emptyRoomTtlMs: parsed.data.EMPTY_ROOM_TTL_MS,
    roomMaxAgeMs: parsed.data.ROOM_MAX_AGE_MS,
    cleanupIntervalMs: parsed.data.CLEANUP_INTERVAL_MS,
  };
}

export const config = parseConfig();
