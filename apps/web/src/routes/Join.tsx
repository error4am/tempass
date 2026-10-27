import { useEffect, useState, type FormEvent } from "react";

import {
  MAX_DISPLAY_NAME_LENGTH,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  type JoinRoomRequest,
  type PublicRoom,
} from "@tempass/shared";

import { Shell } from "../components/Shell";
import { ApiError, getRoom, joinRoom } from "../lib/api";
import { roomErrorMessage } from "../lib/roomErrors";
import { navigate } from "../lib/router";
import { loadDisplayName, saveDisplayName, saveSession } from "../lib/session";

const inputStyles =
  "mt-1 h-11 w-full rounded-xl border border-white/10 bg-slate-900/70 px-4 text-sm text-slate-100 placeholder:text-slate-500 focus:border-rose-400/60 focus:outline-none focus:ring-2 focus:ring-rose-400/20";

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
        <div className="flex max-w-xl flex-1 flex-col justify-center">
          <p className="text-sm text-slate-400">Loading room…</p>
        </div>
      </Shell>
    );
  }

  if (!room || loadError) {
    return (
      <Shell>
        <div className="max-w-xl">
          <h1 className="text-2xl font-semibold tracking-tight">Room unavailable</h1>
          <p role="alert" className="mt-3 text-sm text-rose-300">
            {loadError ?? roomErrorMessage("ROOM_NOT_FOUND")}
          </p>
          <button
            type="button"
            onClick={() => navigate("/")}
            className="mt-6 h-11 rounded-xl bg-rose-500 px-5 text-sm font-semibold text-white hover:bg-rose-400"
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
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.03] p-6 shadow-2xl shadow-black/20">
        <p className="text-xs font-medium uppercase tracking-wide text-rose-300">Join a room</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">You are invited</h1>
        <p className="mt-2 text-sm text-slate-400">
          Room <span className="font-mono text-slate-200">{room.id}</span> ·{" "}
          {room.participantCount}/{room.capacity} participants
        </p>

        {isFull ? (
          <p role="alert" className="mt-5 rounded-xl border border-amber-400/20 bg-amber-400/10 p-3 text-sm text-amber-200">
            This room is full right now. Try again if someone leaves.
          </p>
        ) : null}

        <form className="mt-5 space-y-3" onSubmit={handleJoin}>
          <div>
            <label htmlFor="join-name" className="text-xs font-medium text-slate-300">
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
              <label htmlFor="join-password" className="text-xs font-medium text-slate-300">
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
            className="h-11 w-full rounded-xl bg-rose-500 px-5 text-sm font-semibold text-white transition hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isFull || joining}
          >
            {joining ? "Joining…" : "Join room"}
          </button>
        </form>

        <button
          type="button"
          onClick={() => navigate("/")}
          className="mt-4 text-sm text-slate-400 transition hover:text-slate-200"
        >
          Back to home
        </button>
      </div>
    </Shell>
  );
}
