// @vitest-environment node
import { describe, expect, it } from "vitest";

import { APP_NAME, healthResponseSchema } from "../src/index";

describe("shared contracts", () => {
  it("exposes the product name", () => {
    expect(APP_NAME).toBe("Tempass");
  });

  it("accepts a valid health response", () => {
    const result = healthResponseSchema.safeParse({
      status: "ok",
      service: "tempass-server",
      uptime: 12.5,
    });

    expect(result.success).toBe(true);
  });

  it("rejects an invalid health response", () => {
    const result = healthResponseSchema.safeParse({
      status: "degraded",
      service: "",
      uptime: -1,
    });

    expect(result.success).toBe(false);
  });
});
