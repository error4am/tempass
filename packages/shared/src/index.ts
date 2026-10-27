import { z } from "zod";

export const APP_NAME = "Tempass";

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.string().min(1),
  uptime: z.number().nonnegative(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
