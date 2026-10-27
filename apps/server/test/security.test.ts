// @vitest-environment node
import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "../src/security/password";
import {
  createRoomId,
  createSessionToken,
  hashToken,
} from "../src/security/tokens";

describe("password hashing", () => {
  it("hashes passwords with a salt and verifies them", async () => {
    const password = "correct horse battery staple";
    const first = await hashPassword(password);
    const second = await hashPassword(password);

    expect(first).not.toBe(second);
    expect(first).not.toContain(password);
    await expect(verifyPassword(password, first)).resolves.toBe(true);
    await expect(verifyPassword(password, second)).resolves.toBe(true);
  });

  it("rejects incorrect passwords and malformed hashes", async () => {
    const stored = await hashPassword("hunter22");

    await expect(verifyPassword("hunter23", stored)).resolves.toBe(false);
    await expect(verifyPassword("hunter22", "not-a-hash")).resolves.toBe(false);
    await expect(verifyPassword("hunter22", "scrypt$1$2$3$bad")).resolves.toBe(false);
  });
});

describe("token generation", () => {
  it("creates unpredictable room IDs and session tokens", () => {
    const roomIds = new Set(Array.from({ length: 50 }, () => createRoomId()));
    const tokens = new Set(Array.from({ length: 50 }, () => createSessionToken()));

    expect(roomIds.size).toBe(50);
    expect(tokens.size).toBe(50);

    for (const roomId of roomIds) {
      expect(roomId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    }

    for (const token of tokens) {
      expect(token.length).toBeGreaterThanOrEqual(40);
    }
  });

  it("stores only a deterministic hash of session tokens", () => {
    const token = createSessionToken();
    const hash = hashToken(token);

    expect(hash).not.toBe(token);
    expect(hashToken(token)).toBe(hash);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});
