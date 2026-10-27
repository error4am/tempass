import type { ErrorRequestHandler } from "express";

import { RoomError } from "../../domain/errors";

export const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  if (error instanceof RoomError) {
    response.status(error.status).json({ code: error.code, message: error.message });
    return;
  }

  if (error instanceof SyntaxError) {
    response.status(400).json({ code: "INVALID_INPUT", message: "Malformed request body" });
    return;
  }

  console.error(
    "[tempass] request failed:",
    error instanceof Error ? error.message : "Unknown error",
  );

  response.status(500).json({ code: "INTERNAL", message: "Internal server error" });
};
