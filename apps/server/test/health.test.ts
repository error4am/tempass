// @vitest-environment node
import request from "supertest";
import { describe, expect, it } from "vitest";

import { healthResponseSchema } from "@tempass/shared";

import { createTestContext } from "./helpers/context";

describe("GET /health", () => {
  it("returns the expected health payload", async () => {
    const { app } = createTestContext();
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: "ok",
      service: "tempass-server",
    });
    expect(healthResponseSchema.safeParse(response.body).success).toBe(true);
  });

  it("returns a JSON 404 for unknown routes", async () => {
    const { app } = createTestContext();
    const response = await request(app).get("/missing");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ code: "NOT_FOUND", message: "Route not found" });
  });
});
