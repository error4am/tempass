// @vitest-environment node
import { describe, expect, it } from "vitest";

import { joinApiUrl, normalizeApiBaseUrl } from "../src/lib/config";

describe("API base URL configuration", () => {
  it("uses same-origin requests when no backend URL is configured", () => {
    expect(normalizeApiBaseUrl(undefined)).toBe("");
    expect(normalizeApiBaseUrl("")).toBe("");
    expect(normalizeApiBaseUrl("   ")).toBe("");
    expect(joinApiUrl("", "/api/rooms")).toBe("/api/rooms");
  });

  it("normalizes a deployed backend origin", () => {
    expect(normalizeApiBaseUrl(" https://tempass-server.onrender.com/ ")).toBe(
      "https://tempass-server.onrender.com",
    );
  });

  it("joins paths to a configured backend without duplicating slashes", () => {
    const baseUrl = normalizeApiBaseUrl("https://tempass-server.onrender.com/");

    expect(joinApiUrl(baseUrl, "/api/rooms")).toBe(
      "https://tempass-server.onrender.com/api/rooms",
    );
    expect(joinApiUrl(baseUrl, "api/rooms")).toBe(
      "https://tempass-server.onrender.com/api/rooms",
    );
  });
});
