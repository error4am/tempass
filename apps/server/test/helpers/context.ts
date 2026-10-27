import { createApp } from "../../src/app";
import { RoomService } from "../../src/domain/roomService";
import type { RoomServiceOptions } from "../../src/domain/types";
import { MemoryRoomRepository } from "../../src/storage/memoryRoomRepository";

export const TEST_WEB_ORIGIN = "http://localhost:5173";

export function createTestContext(options: Partial<RoomServiceOptions> = {}) {
  const roomService = new RoomService(new MemoryRoomRepository(), {
    capacity: 2,
    reconnectGraceMs: 1_000,
    emptyRoomTtlMs: 5_000,
    roomMaxAgeMs: 60_000,
    ...options,
  });

  const app = createApp({
    roomService,
    webOrigin: TEST_WEB_ORIGIN,
    corsOrigin: TEST_WEB_ORIGIN,
  });

  return { roomService, app };
}
