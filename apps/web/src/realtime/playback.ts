import {
  SOCKET_EVENTS,
  playbackCommandAckSchema,
  playbackCommandSchema,
  type PlaybackCommand,
  type PlaybackCommandAck,
  type PlaybackUpdate,
} from "@tempass/shared";

import { playbackUpdateFromAck } from "../lib/playback";
import type { RoomSocket } from "./socket";

export const PLAYBACK_COMMAND_TIMEOUT_MS = 5_000;

interface SendPlaybackCommandOptions {
  timeoutMs?: number;
  onAccepted?: (update: PlaybackUpdate) => void;
}

export function sendPlaybackCommand(
  socket: RoomSocket | null,
  command: PlaybackCommand,
  options: SendPlaybackCommandOptions = {},
): Promise<PlaybackCommandAck> {
  const parsedCommand = playbackCommandSchema.safeParse(command);

  if (!parsedCommand.success) {
    return Promise.resolve({ ok: false, code: "INVALID_INPUT" });
  }

  if (!socket?.connected) {
    return Promise.resolve({ ok: false, code: "UNAUTHORIZED" });
  }

  return new Promise((resolve) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      finish({ ok: false, code: "INTERNAL" });
    }, options.timeoutMs ?? PLAYBACK_COMMAND_TIMEOUT_MS);

    function finish(ack: PlaybackCommandAck) {
      if (settled) {
        return;
      }

      settled = true;
      window.clearTimeout(timer);

      const acceptedUpdate = playbackUpdateFromAck(ack);

      if (acceptedUpdate) {
        try {
          options.onAccepted?.(acceptedUpdate);
        } catch {}
      }

      resolve(ack);
    }

    try {
      socket.emit(
        SOCKET_EVENTS.PLAYBACK_COMMAND,
        parsedCommand.data,
        (rawAck: unknown) => {
          const ack = playbackCommandAckSchema.safeParse(rawAck);
          finish(ack.success ? ack.data : { ok: false, code: "INTERNAL" });
        },
      );
    } catch {
      finish({ ok: false, code: "INTERNAL" });
    }
  });
}
