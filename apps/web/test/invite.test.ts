// @vitest-environment node
import { describe, expect, it } from "vitest";

import { extractRoomId } from "../src/lib/invite";

const ROOM_ID = "AbCdEfGhIjKlMnOpQrStUv";

describe("extractRoomId", () => {
  it("accepts a raw room code", () => {
    expect(extractRoomId(ROOM_ID)).toBe(ROOM_ID);
    expect(extractRoomId(`  ${ROOM_ID}  `)).toBe(ROOM_ID);
  });

  it("accepts join and room invitation URLs", () => {
    expect(extractRoomId(`http://localhost:5173/join/${ROOM_ID}`)).toBe(ROOM_ID);
    expect(extractRoomId(`https://tempass.example/join/${ROOM_ID}?from=copy`)).toBe(ROOM_ID);
    expect(extractRoomId(`/room/${ROOM_ID}/`)).toBe(ROOM_ID);
  });

  it("rejects malformed links and codes", () => {
    expect(extractRoomId("")).toBeNull();
    expect(extractRoomId("not-a-room")).toBeNull();
    expect(extractRoomId("https://example.com/join/short")).toBeNull();
    expect(extractRoomId(`https://example.com/other/${ROOM_ID}`)).toBeNull();
  });
});
