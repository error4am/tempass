import { Shell } from "../components/Shell";
import { navigate } from "../lib/router";

export function NotFound() {
  return (
    <Shell>
      <div className="max-w-xl">
        <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
        <p className="mt-2 text-sm text-slate-400">
          That link does not point to a Tempass page.
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
