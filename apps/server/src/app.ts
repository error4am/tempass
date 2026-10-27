import cors from "cors";
import express from "express";

import { config } from "./config";
import { errorHandler } from "./http/middleware/errorHandler";
import { healthRouter } from "./http/routes/health";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: "8kb" }));
  app.use(healthRouter);

  app.use((_request, response) => {
    response.status(404).json({ code: "NOT_FOUND", message: "Route not found" });
  });

  app.use(errorHandler);

  return app;
}
