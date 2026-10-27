// @vitest-environment node
import request from "supertest";
import { describe, expect, it } from "vitest";

import { healthResponseSchema } from "@tempass/shared";

import { createApp } from "../src/app";

describe("GET /health", () => {
  it("returns the expected health payload", async () => {
    const response = await request(createApp()).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: "ok",
      service: "tempass-server",
    });
    expect(healthResponseSchema.safeParse(response.body).success).toBe(true);
  });

  it("returns a JSON 404 for unknown routes", async () => {
    const response = await request(createApp()).get("/missing");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ code: "NOT_FOUND", message: "Route not found" });
  });
});
