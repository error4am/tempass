import { Router } from "express";

import { healthResponseSchema } from "@tempass/shared";

export const healthRouter = Router();

healthRouter.get("/health", (_request, response) => {
  const payload = healthResponseSchema.parse({
    status: "ok",
    service: "tempass-server",
    uptime: process.uptime(),
  });

  response.status(200).json(payload);
});
