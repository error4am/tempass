import type { ReactNode } from "react";

import { navigate } from "../lib/router";

interface ShellProps {
  children: ReactNode;
}

export function Shell({ children }: ShellProps) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950 text-slate-100">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-rose-500/15 blur-3xl"
      />

      <div className="relative mx-auto flex min-h-screen w-full max-w-5xl flex-col px-5 py-8 sm:px-8">
        <header className="flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => navigate("/")}
            className="flex items-center gap-3 rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-500 text-lg font-bold text-white">
              T
            </span>
            <span>
              <span className="block text-base font-semibold tracking-tight">Tempass</span>
              <span className="block text-xs text-slate-400">Private watch parties</span>
            </span>
          </button>

          <span className="hidden rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-400 sm:inline">
            YouTube only · Two people
          </span>
        </header>

        <main className="flex flex-1 flex-col py-10">{children}</main>

        <footer className="border-t border-white/5 pt-5 text-xs leading-5 text-slate-500">
          Designed for YouTube. Only videos that allow embedding can be watched. Tempass does not
          bypass advertisements, DRM, sign-in requirements, or regional restrictions.
        </footer>
      </div>
    </div>
  );
}
