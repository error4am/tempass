import { Shell } from "../components/Shell";
import { navigate } from "../lib/router";

export function NotFound() {
  return (
    <Shell>
      <div className="mx-auto w-full max-w-md rounded-xl border border-white/[0.08] bg-[#1c1b1d] p-7 shadow-2xl shadow-black/40">
        <p className="font-mono text-[11px] uppercase tracking-wider text-[#8d8487]">
          404
        </p>
        <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight text-[#e5e1e4]">
          Page not found
        </h1>
        <p className="mt-2 text-sm text-[#b8afb2]">
          That link does not point to a Tempass page.
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
