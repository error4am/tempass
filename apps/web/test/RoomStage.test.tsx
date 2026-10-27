import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SOCKET_EVENTS,
  type ClockSyncAck,
  type PlaybackCommandAck,
  type RoomSnapshot,
} from "@tempass/shared";

import { Room } from "../src/routes/Room";
import type { RoomSocket } from "../src/realtime/socket";

const socketMock = vi.hoisted(() => ({
  connect: vi.fn(),
}));

const loaderMock = vi.hoisted(() => ({
  load: vi.fn(() => new Promise(() => {})),
}));

vi.mock("../src/realtime/socket", () => ({
  connectRoomSocket: socketMock.connect,
}));

vi.mock("../src/lib/youtubeIframe", () => ({
  loadYouTubeIframeApi: loaderMock.load,
}));

const ROOM_ID = "AbCdEfGhIjKlMnOpQrStUv";
const VIDEO_ID = "dQw4w9WgXcQ";
const SESSION = {
  token: "session-token-that-is-long-enough",
  participantId: "participant-alex",
  displayName: "Alex",
};

type Handler = (...args: unknown[]) => void;

interface FakeSocket {
  socket: RoomSocket;
  emit: (event: string, ...args: unknown[]) => void;
}

function createFakeSocket(ack: PlaybackCommandAck): FakeSocket {
  const handlers = new Map<string, Set<Handler>>();
  const emitToClient = (event: string, ...args: unknown[]) => {
    for (const handler of [...(handlers.get(event) ?? [])]) {
      handler(...args);
    }
  };

  const socket = {
    connected: true,
    on: vi.fn((event: string, handler: Handler) => {
      const eventHandlers = handlers.get(event) ?? new Set<Handler>();
      eventHandlers.add(handler);
      handlers.set(event, eventHandlers);
    }),
    off: vi.fn((event: string, handler: Handler) => {
      handlers.get(event)?.delete(handler);
    }),
    removeAllListeners: vi.fn(() => {
      handlers.clear();
    }),
    disconnect: vi.fn(),
    emit: vi.fn(
      (
        event: string,
        payload: unknown,
        callback?: (response: PlaybackCommandAck | ClockSyncAck) => void,
      ) => {
        if (event === SOCKET_EVENTS.PLAYBACK_COMMAND) {
          callback?.(ack);
        }

        if (event === SOCKET_EVENTS.CLOCK_SYNC) {
          const clientTime = (payload as { clientTime: number }).clientTime;
          callback?.({
            ok: true,
            clientTime,
            serverTime: clientTime + 500,
          });
        }
      },
    ),
  } as unknown as RoomSocket;

  return { socket, emit: emitToClient };
}

function roomSnapshot(): RoomSnapshot {
  return {
    room: {
      id: ROOM_ID,
      createdAt: 1_000,
      requiresPassword: false,
      capacity: 2,
      participantCount: 1,
    },
    self: {
      id: SESSION.participantId,
      displayName: SESSION.displayName,
      connected: true,
      joinedAt: 1_000,
    },
    participants: [
      {
        id: SESSION.participantId,
        displayName: SESSION.displayName,
        connected: true,
        joinedAt: 1_000,
      },
    ],
    messages: [],
    playback: {
      videoId: null,
      status: "idle",
      positionSeconds: 0,
      updatedAt: 1_000,
      revision: 0,
    },
    serverTime: 1_000,
  };
}

beforeEach(() => {
  socketMock.connect.mockReset();
  loaderMock.load.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("Room playback integration", () => {
  it("selects a video through the room socket and waits for accepted canonical state", async () => {
    const accepted: PlaybackCommandAck = {
      ok: true,
      state: {
        videoId: VIDEO_ID,
        status: "paused",
        positionSeconds: 0,
        updatedAt: 2_000,
        revision: 1,
      },
      serverTime: 2_000,
    };
    const fake = createFakeSocket(accepted);
    socketMock.connect.mockReturnValue(fake.socket);

    render(<Room roomId={ROOM_ID} session={SESSION} />);

    act(() => {
      fake.emit("connect");
      fake.emit(SOCKET_EVENTS.ROOM_SNAPSHOT, roomSnapshot());
    });

    const input = await screen.findByLabelText("YouTube link or video ID");

    fireEvent.change(input, { target: { value: VIDEO_ID } });
    fireEvent.click(screen.getByRole("button", { name: "Select video" }));

    await waitFor(() => {
      expect(fake.socket.emit).toHaveBeenCalledWith(
        SOCKET_EVENTS.PLAYBACK_COMMAND,
        { action: "select", videoId: VIDEO_ID },
        expect.any(Function),
      );
    });

    await waitFor(() => {
      expect(screen.queryByText("No video selected")).toBeNull();
      expect(screen.getByText("Paused")).toBeTruthy();
    });

    expect(screen.getByText(VIDEO_ID)).toBeTruthy();
    expect(loaderMock.load).toHaveBeenCalledTimes(1);
  });
});
