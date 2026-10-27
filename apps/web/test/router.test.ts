// @vitest-environment node
import { describe, expect, it } from "vitest";

import { matchRoute } from "../src/lib/router";

const ROOM_ID = "AbCdEfGhIjKlMnOpQrStUv";

describe("matchRoute", () => {
  it("matches the home route", () => {
    expect(matchRoute("/")).toEqual({ name: "home" });
    expect(matchRoute("")).toEqual({ name: "home" });
  });

  it("matches join and room routes", () => {
    expect(matchRoute(`/join/${ROOM_ID}`)).toEqual({ name: "join", roomId: ROOM_ID });
    expect(matchRoute(`/room/${ROOM_ID}/`)).toEqual({ name: "room", roomId: ROOM_ID });
  });

  it("returns not found for unknown paths", () => {
    expect(matchRoute("/nope")).toEqual({ name: "notFound" });
    expect(matchRoute(`/join/${ROOM_ID}/extra`)).toEqual({ name: "notFound" });
  });
});
