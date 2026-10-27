import type { ErrorRequestHandler } from "express";

export const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  const status = error instanceof SyntaxError ? 400 : 500;
  const message = status === 400 ? "Malformed request body" : "Internal server error";

  console.error("[tempass] request failed:", error instanceof Error ? error.message : "Unknown error");

  response.status(status).json({ code: "REQUEST_FAILED", message });
};
