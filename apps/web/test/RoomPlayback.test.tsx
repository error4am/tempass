import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SOCKET_EVENTS,
  type PlaybackState,
  type PlaybackUpdate,
  type RoomSnapshot,
} from "@tempass/shared";

import type { RoomSocket } from "../src/realtime/socket";
import { useRoomPlayback } from "../src/realtime/useRoomPlayback";

const ROOM_ONE = "A".repeat(22);
const ROOM_TWO = "B".repeat(22);
const VIDEO_ONE = "dQw4w9WgXcQ";
const VIDEO_TWO = "M7lc1UVf-VE";
const VIDEO_THREE = "abcdefghijk";
const VIDEO_FOUR = "zyxwvutsrqp";

type PlaybackHandler = (update: PlaybackUpdate) => void;

interface FakeSocket {
  socket: RoomSocket;
  handlers: Set<PlaybackHandler>;
  emitPlayback: (update: PlaybackUpdate) => void;
}

afterEach(cleanup);

function createFakeSocket(): FakeSocket {
  const handlers = new Set<PlaybackHandler>();
  const socket = {
    on: vi.fn((event: string, handler: PlaybackHandler) => {
      if (event === SOCKET_EVENTS.PLAYBACK_STATE) {
        handlers.add(handler);
      }
    }),
    off: vi.fn((event: string, handler: PlaybackHandler) => {
      if (event === SOCKET_EVENTS.PLAYBACK_STATE) {
        handlers.delete(handler);
      }
    }),
  } as unknown as RoomSocket;

  return {
    socket,
    handlers,
    emitPlayback: (update) => {
      for (const handler of [...handlers]) {
        handler(update);
      }
    },
  };
}

function roomSnapshot(
  roomId: string,
  revision: number,
  videoId: string,
  serverTime: number,
  status: PlaybackState["status"] = "paused",
): RoomSnapshot {
  return {
    room: {
      id: roomId,
      createdAt: 1_000,
      requiresPassword: false,
      capacity: 2,
      participantCount: 1,
    },
    self: {
      id: "participant-alex",
      displayName: "Alex",
      connected: true,
      joinedAt: 1_000,
    },
    participants: [
      {
        id: "participant-alex",
        displayName: "Alex",
        connected: true,
        joinedAt: 1_000,
      },
    ],
    messages: [],
    playback: {
      videoId,
      status,
      positionSeconds: 10,
      updatedAt: serverTime - 1_000,
      revision,
    },
    serverTime,
  };
}

function playbackUpdate(
  revision: number,
  videoId: string,
  serverTime: number,
): PlaybackUpdate {
  return {
    state: {
      videoId,
      status: "playing",
      positionSeconds: 20,
      updatedAt: serverTime - 1_000,
      revision,
    },
    serverTime,
  };
}

interface HarnessProps {
  roomId: string;
  socket: RoomSocket;
  snapshot: RoomSnapshot | null;
}

function PlaybackHarness({ roomId, socket, snapshot }: HarnessProps) {
  const { playback } = useRoomPlayback(roomId, socket, snapshot);

  return (
    <p data-testid="playback">
      {playback
        ? `${playback.state.videoId}:${playback.state.revision}:${playback.serverTime}`
        : "none"}
    </p>
  );
}

describe("useRoomPlayback", () => {
  it("applies snapshots and live updates while ignoring duplicate and older revisions", () => {
    const fake = createFakeSocket();
    const initial = roomSnapshot(ROOM_ONE, 1, VIDEO_ONE, 1_000);
    const { rerender } = render(
      <PlaybackHarness roomId={ROOM_ONE} socket={fake.socket} snapshot={initial} />,
    );

    expect(screen.getByTestId("playback").textContent).toBe(`${VIDEO_ONE}:1:1000`);

    act(() => {
      fake.emitPlayback(playbackUpdate(2, VIDEO_TWO, 2_000));
    });
    expect(screen.getByTestId("playback").textContent).toBe(`${VIDEO_TWO}:2:2000`);

    act(() => {
      fake.emitPlayback(playbackUpdate(1, VIDEO_THREE, 3_000));
      fake.emitPlayback(playbackUpdate(2, VIDEO_FOUR, 4_000));
    });
    expect(screen.getByTestId("playback").textContent).toBe(`${VIDEO_TWO}:2:2000`);

    const reconnected = roomSnapshot(ROOM_ONE, 3, VIDEO_THREE, 5_000, "playing");
    rerender(
      <PlaybackHarness
        roomId={ROOM_ONE}
        socket={fake.socket}
        snapshot={reconnected}
      />,
    );

    expect(screen.getByTestId("playback").textContent).toBe(
      `${VIDEO_THREE}:3:5000`,
    );
  });

  it("resubscribes when the socket changes and cleans up on unmount", () => {
    const first = createFakeSocket();
    const second = createFakeSocket();
    const initial = roomSnapshot(ROOM_ONE, 1, VIDEO_ONE, 1_000);
    const { rerender, unmount } = render(
      <PlaybackHarness roomId={ROOM_ONE} socket={first.socket} snapshot={initial} />,
    );

    expect(first.handlers.size).toBe(1);

    rerender(
      <PlaybackHarness roomId={ROOM_ONE} socket={second.socket} snapshot={initial} />,
    );

    expect(first.handlers.size).toBe(0);
    expect(second.handlers.size).toBe(1);

    act(() => {
      second.emitPlayback(playbackUpdate(2, VIDEO_TWO, 2_000));
      first.emitPlayback(playbackUpdate(3, VIDEO_THREE, 3_000));
    });
    expect(screen.getByTestId("playback").textContent).toBe(`${VIDEO_TWO}:2:2000`);

    unmount();
    expect(second.handlers.size).toBe(0);
  });

  it("resets playback when the room changes so state cannot leak across rooms", () => {
    const fake = createFakeSocket();
    const firstRoom = roomSnapshot(ROOM_ONE, 5, VIDEO_ONE, 1_000);
    const { rerender } = render(
      <PlaybackHarness roomId={ROOM_ONE} socket={fake.socket} snapshot={firstRoom} />,
    );

    expect(screen.getByTestId("playback").textContent).toBe(`${VIDEO_ONE}:5:1000`);

    rerender(
      <PlaybackHarness roomId={ROOM_TWO} socket={fake.socket} snapshot={firstRoom} />,
    );
    expect(screen.getByTestId("playback").textContent).toBe("none");

    const secondRoom = roomSnapshot(ROOM_TWO, 1, VIDEO_TWO, 2_000);
    rerender(
      <PlaybackHarness roomId={ROOM_TWO} socket={fake.socket} snapshot={secondRoom} />,
    );
    expect(screen.getByTestId("playback").textContent).toBe(`${VIDEO_TWO}:1:2000`);
  });
});
