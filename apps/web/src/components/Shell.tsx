import type { ReactNode } from "react";

import { navigate } from "../lib/router";
import { ClapperIcon } from "./Icons";

interface ShellProps {
  children: ReactNode;
  wide?: boolean;
  headerContent?: ReactNode;
}

export function Shell({ children, wide = false, headerContent }: ShellProps) {
  const containerClass = wide
    ? "max-w-[1600px] px-4 sm:px-6"
    : "max-w-5xl px-5 sm:px-8";

  return (
    <div
      className={`relative flex min-h-screen flex-col overflow-x-clip text-[#e5e1e4] ${
        wide ? "bg-[#0e0e10]" : "bg-[#131315]"
      }`}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-36 left-1/2 h-80 w-[34rem] -translate-x-1/2 rounded-full bg-[#ff516a]/10 blur-3xl"
      />

      <header className="sticky top-0 z-40 border-b border-white/[0.07] bg-[#0e0e10]/85 backdrop-blur-xl">
        <div
          className={`mx-auto flex min-h-15 w-full flex-wrap items-center justify-between gap-3 py-2.5 ${containerClass}`}
        >
          <button
            type="button"
            onClick={() => navigate("/")}
            className="flex shrink-0 items-center gap-2.5 rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff516a]"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#ff516a] text-[#0e0e10] shadow-[0_0_16px_-2px_rgba(255,81,106,0.45)]">
              <ClapperIcon className="h-4 w-4" />
            </span>
            <span className="font-display text-base font-semibold tracking-tight text-[#e5e1e4]">
              Tempass
            </span>
          </button>

          {headerContent ?? (
            <span className="hidden rounded-full border border-white/[0.08] bg-[#201f22] px-3 py-1 font-mono text-[11px] uppercase tracking-wider text-[#b8afb2] sm:inline-flex">
              Two people · One screen
            </span>
          )}
        </div>
      </header>

      <main
        className={`relative mx-auto flex w-full flex-1 flex-col ${containerClass} ${
          wide ? "py-4" : "py-10 sm:py-14"
        }`}
      >
        {children}
      </main>

      <footer className="relative border-t border-white/[0.06] bg-[#131315]/60">
        <div
          className={`mx-auto w-full py-5 text-xs leading-5 text-[#8d8487] ${containerClass}`}
        >
          YouTube videos must allow embedding. For sites that cannot be embedded, the presenter
          shares their own tab. This app does not bypass advertisements, DRM, sign-in
          requirements, or regional restrictions.
        </div>
      </footer>
    </div>
  );
}
