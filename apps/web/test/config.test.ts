// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  DEFAULT_ICE_SERVERS,
  joinApiUrl,
  normalizeApiBaseUrl,
  parseIceServers,
} from "../src/lib/config";

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

describe("ICE server configuration", () => {
  it("falls back to public STUN when nothing is configured", () => {
    expect(parseIceServers(undefined)).toBe(DEFAULT_ICE_SERVERS);
    expect(parseIceServers("   ")).toBe(DEFAULT_ICE_SERVERS);
    expect(parseIceServers("not json")).toBe(DEFAULT_ICE_SERVERS);
    expect(parseIceServers("[]")).toBe(DEFAULT_ICE_SERVERS);
    expect(parseIceServers('[{"urls":""}]')).toBe(DEFAULT_ICE_SERVERS);
  });

  it("accepts STUN and TURN entries with credentials", () => {
    const servers = parseIceServers(
      JSON.stringify([
        { urls: "stun:stun.l.google.com:19302" },
        {
          urls: ["turn:turn.example.com:3478", "turns:turn.example.com:5349"],
          username: "user",
          credential: "secret",
        },
      ]),
    );

    expect(servers).toHaveLength(2);
    expect(servers[1]).toMatchObject({
      username: "user",
      credential: "secret",
    });
  });

  it("drops malformed entries but keeps the valid ones", () => {
    const servers = parseIceServers(
      JSON.stringify([{ urls: 42 }, { urls: "stun:stun.example.com:3478" }]),
    );

    expect(servers).toHaveLength(1);
    expect(servers[0]?.urls).toBe("stun:stun.example.com:3478");
  });
});
