import { createServer as createHttpServer } from "node:http";

import { createApp } from "./app";
import { config } from "./config";
import { RoomService } from "./domain/roomService";
import type { RoomServiceOptions } from "./domain/types";
import { attachRealtime, broadcastRoomPresence } from "./realtime/io";
import { MemoryRoomRepository } from "./storage/memoryRoomRepository";

export interface TempassRuntimeOptions {
  capacity?: number;
  reconnectGraceMs?: number;
  emptyRoomTtlMs?: number;
  roomMaxAgeMs?: number;
  cleanupIntervalMs?: number;
  corsOrigin?: string;
  webOrigin?: string;
  now?: RoomServiceOptions["now"];
}

export interface TempassRuntime {
  app: ReturnType<typeof createApp>;
  httpServer: ReturnType<typeof createHttpServer>;
  io: ReturnType<typeof attachRealtime>;
  roomService: RoomService;
  sweep: () => void;
  close: () => Promise<void>;
}

export function createRuntime(options: TempassRuntimeOptions = {}): TempassRuntime {
  const corsOrigin = options.corsOrigin ?? config.corsOrigin;
  const webOrigin = options.webOrigin ?? config.webOrigin;
  const cleanupIntervalMs = options.cleanupIntervalMs ?? config.cleanupIntervalMs;

  const roomService = new RoomService(new MemoryRoomRepository(), {
    capacity: options.capacity ?? config.maxParticipants,
    reconnectGraceMs: options.reconnectGraceMs ?? config.reconnectGraceMs,
    emptyRoomTtlMs: options.emptyRoomTtlMs ?? config.emptyRoomTtlMs,
    roomMaxAgeMs: options.roomMaxAgeMs ?? config.roomMaxAgeMs,
    ...(options.now ? { now: options.now } : {}),
  });

  const app = createApp({ roomService, webOrigin, corsOrigin });
  const httpServer = createHttpServer(app);
  const io = attachRealtime(httpServer, roomService, { corsOrigin });

  const sweep = () => {
    const changedRoomIds = roomService.sweep();

    for (const roomId of changedRoomIds) {
      if (roomService.getPresence(roomId)) {
        broadcastRoomPresence(io, roomService, roomId);
      } else {
        io.in(roomId).disconnectSockets(true);
      }
    }
  };

  const cleanupTimer = setInterval(sweep, cleanupIntervalMs);
  cleanupTimer.unref();

  let closing: Promise<void> | null = null;

  const close = (): Promise<void> => {
    closing ??= (async () => {
      clearInterval(cleanupTimer);
      await new Promise<void>((resolve) => {
        io.close(() => resolve());
      });

      if (httpServer.listening) {
        await new Promise<void>((resolve, reject) => {
          httpServer.close((error) => {
            if (error) {
              reject(error);
              return;
            }

            resolve();
          });
        });
      }
    })();

    return closing;
  };

  return { app, httpServer, io, roomService, sweep, close };
}
