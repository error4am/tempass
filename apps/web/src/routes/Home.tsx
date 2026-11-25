import { useState, type FormEvent } from "react";

import {
  MAX_DISPLAY_NAME_LENGTH,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  type CreateRoomRequest,
} from "@tempass/shared";

import {
  ArrowRightIcon,
  ChevronRightIcon,
  LockIcon,
  LogInIcon,
  PlusSquareIcon,
  WaveformIcon,
} from "../components/Icons";
import { Shell } from "../components/Shell";
import { ApiError, createRoom } from "../lib/api";
import { extractRoomId } from "../lib/invite";
import { roomErrorMessage } from "../lib/roomErrors";
import { navigate } from "../lib/router";
import { loadDisplayName, saveDisplayName, saveSession } from "../lib/session";

const inputStyles =
  "h-11 w-full rounded-lg border border-white/[0.08] bg-[#0e0e10] px-3.5 text-sm text-[#e5e1e4] placeholder:text-[#6c666d] transition focus:border-[#ff516a]/70 focus:outline-none focus:ring-2 focus:ring-[#ff516a]/20";

const primaryButtonStyles =
  "inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#ff516a] px-5 text-sm font-semibold text-white shadow-[0_0_24px_-4px_rgba(255,81,106,0.45)] transition hover:bg-[#ea6479] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ffb2b7] disabled:cursor-not-allowed disabled:opacity-60";

const secondaryButtonStyles =
  "inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-white/[0.08] bg-[#2a2a2c] px-5 text-sm font-semibold text-[#e5e1e4] transition hover:bg-[#39393b] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ffb2b7] disabled:cursor-not-allowed disabled:opacity-60";

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
      <section className="mx-auto max-w-2xl text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-[#201f22] px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-wider text-[#d5c8cc]">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[#4edea3]" />
          Private room · Two people · Live chat
        </span>

        <h1 className="mt-6 font-display text-4xl font-bold tracking-tight text-[#e5e1e4] sm:text-5xl">
          Watch together, <span className="text-[#ff516a]">in sync.</span>
        </h1>

        <p className="mx-auto mt-5 max-w-xl text-base leading-7 text-[#b8afb2]">
          Tempass is a private watch-party app for two people. Paste a YouTube link and the
          embedded player stays in sync for both of you. For sites that block embedding, the
          presenter shares their tab and it plays inside the room instead.
        </p>
      </section>

      <div className="mx-auto mt-10 grid w-full max-w-4xl gap-6 md:grid-cols-2">
        <section className="flex flex-col rounded-xl border border-white/[0.08] bg-[#1c1b1d] p-7 shadow-2xl shadow-black/40">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#ff516a]/25 bg-[#ff516a]/15 text-[#ff516a]">
                <PlusSquareIcon className="h-5 w-5" />
              </span>
              <h2 className="font-display text-xl font-semibold text-[#e5e1e4]">
                Create a room
              </h2>
            </div>
            <span className="font-mono text-[11px] uppercase tracking-wider text-[#8d8487]">
              Host
            </span>
          </div>

          <p className="mt-2 text-sm text-[#b8afb2]">
            Start a private room and share the invite link.
          </p>

          <form className="mt-5 flex flex-1 flex-col gap-4" onSubmit={handleCreate}>
            <div>
              <label htmlFor="create-name" className="block text-xs font-medium text-[#b8afb2]">
                Your display name
              </label>
              <input
                id="create-name"
                className={`${inputStyles} mt-1.5`}
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                maxLength={MAX_DISPLAY_NAME_LENGTH}
                placeholder="e.g. Alex"
                autoComplete="nickname"
                required
              />
            </div>

            <div>
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="create-password"
                  className="block text-xs font-medium text-[#b8afb2]"
                >
                  Room password
                </label>
                <span className="font-mono text-[11px] text-[#8d8487]">(Optional)</span>
              </div>
              <input
                id="create-password"
                className={`${inputStyles} mt-1.5`}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                minLength={MIN_PASSWORD_LENGTH}
                maxLength={MAX_PASSWORD_LENGTH}
                placeholder="Leave blank for no password"
                autoComplete="new-password"
              />
              <p className="mt-1.5 text-xs text-[#8d8487]">
                {MIN_PASSWORD_LENGTH}–{MAX_PASSWORD_LENGTH} characters if used.
              </p>
            </div>

            {createError ? (
              <p role="alert" className="text-sm text-rose-300">
                {createError}
              </p>
            ) : null}

            <button
              type="submit"
              className={`${primaryButtonStyles} mt-auto w-full`}
              disabled={creating}
            >
              <span>{creating ? "Creating room…" : "Create a room"}</span>
              <ArrowRightIcon className="h-4 w-4" />
            </button>
          </form>
        </section>

        <section className="flex flex-col justify-between rounded-xl border border-white/[0.08] bg-[#18171a] p-7 shadow-2xl shadow-black/40">
          <div>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/[0.08] bg-[#2a2a2c] text-[#e5e1e4]">
                  <LogInIcon className="h-5 w-5" />
                </span>
                <h2 className="font-display text-xl font-semibold text-[#e5e1e4]">
                  Join a room
                </h2>
              </div>
              <span className="font-mono text-[11px] uppercase tracking-wider text-[#8d8487]">
                Guest
              </span>
            </div>

            <p className="mt-2 text-sm text-[#b8afb2]">
              Use the invitation link or room code you received.
            </p>

            <form className="mt-5 space-y-4" onSubmit={handleJoin}>
              <div>
                <label htmlFor="join-invite" className="block text-xs font-medium text-[#b8afb2]">
                  Invitation link or room code
                </label>
                <input
                  id="join-invite"
                  className={`${inputStyles} mt-1.5 font-mono text-xs`}
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
                <span>Continue to room</span>
                <ChevronRightIcon className="h-4 w-4" />
              </button>
            </form>
          </div>

          <p className="mt-5 text-xs leading-5 text-[#8d8487]">
            Open the invitation in another browser or private window to join as the second
            participant.
          </p>
        </section>
      </div>

      <section
        aria-label="Room capabilities"
        className="mx-auto mt-6 flex w-full max-w-4xl flex-col items-start justify-between gap-4 rounded-xl border border-white/[0.07] bg-[#1c1b1d]/80 px-6 py-4 sm:flex-row sm:items-center"
      >
        <div className="flex items-center gap-3.5">
          <WaveformIcon className="h-5 w-8 shrink-0 text-[#ff516a]" />
          <div>
            <p className="font-mono text-xs font-semibold uppercase tracking-wider text-[#e5e1e4]">
              Clock-synced playback
            </p>
            <p className="text-xs text-[#8d8487]">
              Real-time drift correction &amp; equal room controls
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-5 font-mono text-[11px] uppercase tracking-wider text-[#b8afb2]">
          <span className="inline-flex items-center gap-2">
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-[#4edea3]" />
            Live tab share
          </span>
          <span className="inline-flex items-center gap-1.5">
            <LockIcon className="h-3.5 w-3.5 text-[#ff516a]" />
            Private 1:1
          </span>
        </div>
      </section>
    </Shell>
  );
}
