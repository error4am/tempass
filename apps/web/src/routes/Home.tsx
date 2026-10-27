import { useState, type FormEvent } from "react";

import {
  MAX_DISPLAY_NAME_LENGTH,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  type CreateRoomRequest,
} from "@tempass/shared";

import { Shell } from "../components/Shell";
import { ApiError, createRoom } from "../lib/api";
import { extractRoomId } from "../lib/invite";
import { roomErrorMessage } from "../lib/roomErrors";
import { navigate } from "../lib/router";
import { loadDisplayName, saveDisplayName, saveSession } from "../lib/session";

const inputStyles =
  "mt-1 h-11 w-full rounded-xl border border-white/10 bg-slate-900/70 px-4 text-sm text-slate-100 placeholder:text-slate-500 focus:border-rose-400/60 focus:outline-none focus:ring-2 focus:ring-rose-400/20";

const primaryButtonStyles =
  "h-11 rounded-xl bg-rose-500 px-5 text-sm font-semibold text-white transition hover:bg-rose-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 disabled:cursor-not-allowed disabled:opacity-60";

const secondaryButtonStyles =
  "h-11 rounded-xl border border-white/10 bg-white/5 px-5 text-sm font-semibold text-slate-200 transition hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 disabled:cursor-not-allowed disabled:opacity-60";

export function Home() {
  const [displayName, setDisplayName] = useState(loadDisplayName);
  const [password, setPassword] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [inviteInput, setInviteInput] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (creating) {
      return;
    }

    setCreating(true);
    setCreateError(null);

    const input: CreateRoomRequest = {
      displayName,
      ...(password.length > 0 ? { password } : {}),
    };

    try {
      const result = await createRoom(input);

      saveDisplayName(result.participant.displayName);
      saveSession(result.room.id, {
        token: result.sessionToken,
        participantId: result.participant.id,
        displayName: result.participant.displayName,
      });
      navigate(`/room/${result.room.id}`);
    } catch (error) {
      setCreateError(
        error instanceof ApiError
          ? roomErrorMessage(error.code, error.message)
          : "Something went wrong while creating the room.",
      );
    } finally {
      setCreating(false);
    }
  }

  function handleJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setJoinError(null);

    const roomId = extractRoomId(inviteInput);

    if (!roomId) {
      setJoinError("Paste a valid Tempass invitation link or room code.");
      return;
    }

    navigate(`/join/${roomId}`);
  }

  return (
    <Shell>
      <div className="max-w-2xl">
        <span className="inline-flex items-center rounded-full border border-rose-400/30 bg-rose-400/10 px-3 py-1 text-xs font-medium text-rose-200">
          YouTube only · Two people · One shared screen
        </span>

        <h1 className="mt-6 text-4xl font-semibold tracking-tight sm:text-5xl">
          Watch YouTube together, <span className="text-rose-400">in sync.</span>
        </h1>

        <p className="mt-5 max-w-xl text-base leading-7 text-slate-400">
          Tempass is a private watch-party app for two people. Create a room, share the invitation
          link, and meet the other participant there. Synchronized YouTube playback and chat are
          arriving in the next milestones.
        </p>
      </div>

      <div className="mt-9 grid max-w-3xl gap-4 md:grid-cols-2">
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 shadow-2xl shadow-black/20">
          <h2 className="text-sm font-semibold text-slate-200">Create a room</h2>
          <p className="mt-1 text-sm text-slate-400">
            Start a private room and share the invite link.
          </p>

          <form className="mt-4 space-y-3" onSubmit={handleCreate}>
            <div>
              <label htmlFor="create-name" className="text-xs font-medium text-slate-300">
                Your display name
              </label>
              <input
                id="create-name"
                className={inputStyles}
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                maxLength={MAX_DISPLAY_NAME_LENGTH}
                placeholder="e.g. Alex"
                autoComplete="nickname"
                required
              />
            </div>

            <div>
              <label htmlFor="create-password" className="text-xs font-medium text-slate-300">
                Room password <span className="text-slate-500">(optional)</span>
              </label>
              <input
                id="create-password"
                className={inputStyles}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                minLength={MIN_PASSWORD_LENGTH}
                maxLength={MAX_PASSWORD_LENGTH}
                placeholder="Leave blank for no password"
                autoComplete="new-password"
              />
              <p className="mt-1 text-xs text-slate-500">
                {MIN_PASSWORD_LENGTH}–{MAX_PASSWORD_LENGTH} characters if used.
              </p>
            </div>

            {createError ? (
              <p role="alert" className="text-sm text-rose-300">
                {createError}
              </p>
            ) : null}

            <button type="submit" className={`${primaryButtonStyles} w-full`} disabled={creating}>
              {creating ? "Creating room…" : "Create a room"}
            </button>
          </form>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 shadow-2xl shadow-black/20">
          <h2 className="text-sm font-semibold text-slate-200">Join a room</h2>
          <p className="mt-1 text-sm text-slate-400">
            Use the invitation link or room code you received.
          </p>

          <form className="mt-4 space-y-3" onSubmit={handleJoin}>
            <div>
              <label htmlFor="join-invite" className="text-xs font-medium text-slate-300">
                Invitation link or room code
              </label>
              <input
                id="join-invite"
                className={inputStyles}
                value={inviteInput}
                onChange={(event) => setInviteInput(event.target.value)}
                placeholder="http://localhost:5173/join/…"
                autoComplete="off"
                required
              />
            </div>

            {joinError ? (
              <p role="alert" className="text-sm text-rose-300">
                {joinError}
              </p>
            ) : null}

            <button type="submit" className={`${secondaryButtonStyles} w-full`}>
              Continue to room
            </button>
          </form>

          <p className="mt-4 text-xs leading-5 text-slate-500">
            Invitation links are local to this development machine. Sharing behavior across
            networks and deployments is planned for a later stage.
          </p>
        </section>
      </div>
    </Shell>
  );
}
