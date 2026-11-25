import { useEffect, useState, type FormEvent } from "react";

import {
  MAX_DISPLAY_NAME_LENGTH,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  type JoinRoomRequest,
  type PublicRoom,
} from "@tempass/shared";

import { ArrowRightIcon, LockIcon } from "../components/Icons";
import { Shell } from "../components/Shell";
import { ApiError, getRoom, joinRoom } from "../lib/api";
import { roomErrorMessage } from "../lib/roomErrors";
import { navigate } from "../lib/router";
import { loadDisplayName, saveDisplayName, saveSession } from "../lib/session";

const inputStyles =
  "mt-1.5 h-11 w-full rounded-lg border border-white/[0.08] bg-[#0e0e10] px-3.5 text-sm text-[#e5e1e4] placeholder:text-[#6c666d] transition focus:border-[#ff516a]/70 focus:outline-none focus:ring-2 focus:ring-[#ff516a]/20 disabled:cursor-not-allowed disabled:opacity-60";

interface JoinProps {
  roomId: string;
}

export function Join({ roomId }: JoinProps) {
  const [room, setRoom] = useState<PublicRoom | null>(null);
  const [loadingRoom, setLoadingRoom] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState(loadDisplayName);
  const [password, setPassword] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoadingRoom(true);
    setLoadError(null);

    getRoom(roomId)
      .then((result) => {
        if (active) {
          setRoom(result);
        }
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }

        setLoadError(
          error instanceof ApiError
            ? roomErrorMessage(error.code, error.message)
            : "Could not load this room.",
        );
      })
      .finally(() => {
        if (active) {
          setLoadingRoom(false);
        }
      });

    return () => {
      active = false;
    };
  }, [roomId]);

  async function handleJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (joining || !room) {
      return;
    }

    setJoining(true);
    setJoinError(null);

    const input: JoinRoomRequest = {
      displayName,
      ...(room.requiresPassword ? { password } : {}),
    };

    try {
      const result = await joinRoom(roomId, input);

      saveDisplayName(result.participant.displayName);
      saveSession(result.room.id, {
        token: result.sessionToken,
        participantId: result.participant.id,
        displayName: result.participant.displayName,
      });
      navigate(`/room/${result.room.id}`);
    } catch (error) {
      setJoinError(
        error instanceof ApiError
          ? roomErrorMessage(error.code, error.message)
          : "Something went wrong while joining the room.",
      );
    } finally {
      setJoining(false);
    }
  }

  if (loadingRoom) {
    return (
      <Shell>
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center">
          <div className="rounded-xl border border-white/[0.08] bg-[#1c1b1d] p-7 text-center shadow-2xl shadow-black/40">
            <p className="font-mono text-xs uppercase tracking-wider text-[#b8afb2]">
              Loading room…
            </p>
          </div>
        </div>
      </Shell>
    );
  }

  if (!room || loadError) {
    return (
      <Shell>
        <div className="mx-auto w-full max-w-md rounded-xl border border-white/[0.08] bg-[#1c1b1d] p-7 shadow-2xl shadow-black/40">
          <p className="font-mono text-[11px] uppercase tracking-wider text-[#ffb2b7]">
            Invite unavailable
          </p>
          <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight text-[#e5e1e4]">
            Room unavailable
          </h1>
          <p role="alert" className="mt-3 text-sm text-rose-300">
            {loadError ?? roomErrorMessage("ROOM_NOT_FOUND")}
          </p>
          <button
            type="button"
            onClick={() => navigate("/")}
            className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-lg bg-[#ff516a] px-5 text-sm font-semibold text-white transition hover:bg-[#ea6479]"
          >
            Back to home
          </button>
        </div>
      </Shell>
    );
  }

  const isFull = room.participantCount >= room.capacity;

  return (
    <Shell>
      <div className="mx-auto w-full max-w-md rounded-xl border border-white/[0.08] bg-[#1c1b1d] p-7 shadow-2xl shadow-black/40">
        <div className="flex items-center justify-between gap-2">
          <p className="font-mono text-[11px] uppercase tracking-wider text-[#ffb2b7]">
            Join a room
          </p>
          <span className="rounded-md border border-white/[0.08] bg-[#0e0e10] px-2 py-0.5 font-mono text-[11px] text-[#b8afb2]">
            {room.participantCount}/{room.capacity} participants
          </span>
        </div>

        <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight text-[#e5e1e4]">
          You are invited
        </h1>

        <p className="mt-2 flex items-center gap-2 text-xs text-[#8d8487]">
          <span>Room</span>
          <code className="truncate rounded border border-white/[0.06] bg-[#0e0e10] px-2 py-0.5 font-mono text-[#e5e1e4]">
            {room.id}
          </code>
          {room.requiresPassword ? (
            <span className="inline-flex items-center gap-1 font-mono text-[11px] text-[#ffb2b7]">
              <LockIcon className="h-3 w-3" />
              Protected
            </span>
          ) : null}
        </p>

        {isFull ? (
          <p
            role="alert"
            className="mt-5 rounded-lg border border-amber-400/25 bg-amber-400/10 p-3 text-sm text-amber-200"
          >
            This room is full right now. Try again if someone leaves.
          </p>
        ) : null}

        <form className="mt-5 space-y-4" onSubmit={handleJoin}>
          <div>
            <label htmlFor="join-name" className="block text-xs font-medium text-[#b8afb2]">
              Your display name
            </label>
            <input
              id="join-name"
              className={inputStyles}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              maxLength={MAX_DISPLAY_NAME_LENGTH}
              placeholder="e.g. Sam"
              autoComplete="nickname"
              required
              disabled={isFull || joining}
            />
          </div>

          {room.requiresPassword ? (
            <div>
              <label htmlFor="join-password" className="block text-xs font-medium text-[#b8afb2]">
                Room password
              </label>
              <input
                id="join-password"
                className={inputStyles}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                minLength={MIN_PASSWORD_LENGTH}
                maxLength={MAX_PASSWORD_LENGTH}
                autoComplete="current-password"
                required
                disabled={isFull || joining}
              />
            </div>
          ) : null}

          {joinError ? (
            <p role="alert" className="text-sm text-rose-300">
              {joinError}
            </p>
          ) : null}

          <button
            type="submit"
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#ff516a] px-5 text-sm font-semibold text-white shadow-[0_0_24px_-4px_rgba(255,81,106,0.45)] transition hover:bg-[#ea6479] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isFull || joining}
          >
            <span>{joining ? "Joining…" : "Join room"}</span>
            <ArrowRightIcon className="h-4 w-4" />
          </button>
        </form>

        <button
          type="button"
          onClick={() => navigate("/")}
          className="mt-5 text-xs font-medium text-[#8d8487] transition hover:text-[#e5e1e4]"
        >
          Back to home
        </button>
      </div>
    </Shell>
  );
}
