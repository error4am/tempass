const upcomingFeatures = [
  "Private rooms for two",
  "Optional room passwords",
  "Synchronized YouTube playback",
  "Real-time chat",
];

export default function App() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950 text-slate-100">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-rose-500/15 blur-3xl"
      />

      <div className="relative mx-auto flex min-h-screen w-full max-w-4xl flex-col px-6 py-10 sm:px-10">
        <header className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-500 text-lg font-bold text-white">
            T
          </span>
          <div>
            <p className="text-base font-semibold tracking-tight">Tempass</p>
            <p className="text-xs text-slate-400">Private watch parties</p>
          </div>
        </header>

        <main className="flex flex-1 flex-col justify-center py-16">
          <div className="max-w-2xl">
            <span className="inline-flex items-center rounded-full border border-rose-400/30 bg-rose-400/10 px-3 py-1 text-xs font-medium text-rose-200">
              YouTube only · Two people · One shared screen
            </span>

            <h1 className="mt-6 text-4xl font-semibold tracking-tight sm:text-5xl">
              Watch YouTube together,{" "}
              <span className="text-rose-400">in sync.</span>
            </h1>

            <p className="mt-5 max-w-xl text-base leading-7 text-slate-400">
              Tempass is a private watch-party app. Create a room, share the invitation link,
              and watch the same embeddable YouTube video together while you chat in real time.
            </p>
          </div>

          <section
            aria-labelledby="start-heading"
            className="mt-10 max-w-2xl rounded-2xl border border-white/10 bg-white/[0.03] p-5 shadow-2xl shadow-black/20 sm:p-6"
          >
            <h2 id="start-heading" className="text-sm font-semibold text-slate-200">
              Get started soon
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              Rooms, passwords, chat, and synchronized playback arrive in the next milestones.
            </p>

            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <label className="sr-only" htmlFor="room-placeholder">
                Room action
              </label>
              <input
                id="room-placeholder"
                className="h-11 flex-1 cursor-not-allowed rounded-xl border border-white/10 bg-slate-900/70 px-4 text-sm text-slate-400 placeholder:text-slate-500"
                placeholder="Paste a YouTube link or room code"
                disabled
              />
              <div className="flex gap-3">
                <button
                  className="h-11 flex-1 cursor-not-allowed rounded-xl bg-rose-500/70 px-4 text-sm font-semibold text-white sm:flex-none"
                  type="button"
                  disabled
                >
                  Create a room
                </button>
                <button
                  className="h-11 flex-1 cursor-not-allowed rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-semibold text-slate-400 sm:flex-none"
                  type="button"
                  disabled
                >
                  Join a room
                </button>
              </div>
            </div>
          </section>

          <ul className="mt-8 grid max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
            {upcomingFeatures.map((feature) => (
              <li
                key={feature}
                className="flex items-center gap-2 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2 text-sm text-slate-400"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-rose-400" aria-hidden="true" />
                {feature}
              </li>
            ))}
          </ul>
        </main>

        <footer className="border-t border-white/5 pt-5 text-xs leading-5 text-slate-500">
          Designed for YouTube. Only videos that allow embedding can be watched. Tempass does not
          bypass advertisements, DRM, sign-in requirements, or regional restrictions.
        </footer>
      </div>
    </div>
  );
}
