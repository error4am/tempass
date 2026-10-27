import cors from "cors";
import express from "express";

import type { RoomService } from "./domain/roomService";
import { errorHandler } from "./http/middleware/errorHandler";
import { createRoomsRouter } from "./http/routes/rooms";
import { healthRouter } from "./http/routes/health";

interface AppDependencies {
  roomService: RoomService;
  webOrigin: string;
  corsOrigin: string;
}

export function createApp({ roomService, webOrigin, corsOrigin }: AppDependencies) {
  const app = express();

  app.disable("x-powered-by");
  app.use(cors({ origin: corsOrigin }));
  app.use(express.json({ limit: "8kb" }));
  app.use(healthRouter);
  app.use(createRoomsRouter(roomService, webOrigin));

  app.use((_request, response) => {
    response.status(404).json({ code: "NOT_FOUND", message: "Route not found" });
  });

  app.use(errorHandler);

  return app;
}
