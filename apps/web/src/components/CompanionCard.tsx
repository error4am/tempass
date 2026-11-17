import { useState } from "react";

import { API_BASE_URL } from "../lib/config";

interface CompanionCardProps {
  roomId: string;
  token: string;
}

function buildBookmarklet(roomId: string, token: string, server: string): string {
  const scriptUrl = `${window.location.origin}/companion.js?room=${encodeURIComponent(
    roomId,
  )}&token=${encodeURIComponent(token)}&server=${encodeURIComponent(server)}`;

  return `javascript:(()=>{const s=document.createElement('script');s.src=${JSON.stringify(
    scriptUrl,
  )};document.body.appendChild(s)})()`;
}

/**
 * Entry point for "companion mode": the source site plays in the presenter's own
 * tab, and this script turns that tab into the room's remote-controlled screen.
 */
export function CompanionCard({ roomId, token }: CompanionCardProps) {
  const [copied, setCopied] = useState(false);

  const server = API_BASE_URL || window.location.origin;
  const bookmarklet = buildBookmarklet(roomId, token, server);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(bookmarklet);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <details className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <summary className="cursor-pointer text-sm font-semibold text-slate-200">
        Watch a site that blocks embedding
      </summary>

      <p className="mt-3 text-sm text-slate-400">
        Sites like aryplus.tv refuse to be framed, so the picture cannot live
        inside this page. Instead, open the video in your own tab, start it, then
        run the companion there. Your tab becomes the room&apos;s screen: play,
        pause and seek from here and it applies for both of you.
      </p>

      <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-slate-400">
        <li>Open the episode on the source site and press play.</li>
        <li>Drag the button below to your bookmarks bar.</li>
        <li>
          With the video tab active, click the bookmark once. A badge appears when
          it is connected.
        </li>
        <li>This room switches to the source stage automatically.</li>
      </ol>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <a
          href={bookmarklet}
          onClick={(event) => event.preventDefault()}
          className="inline-flex h-9 items-center rounded-lg bg-rose-500 px-4 text-xs font-semibold text-white transition hover:bg-rose-400"
        >
          Tempass companion
        </a>
        <button
          type="button"
          onClick={handleCopy}
          className="h-9 rounded-lg border border-white/10 bg-white/5 px-4 text-xs font-semibold text-slate-300 transition hover:bg-white/10"
        >
          {copied ? "Copied" : "Copy bookmarklet"}
        </button>
      </div>

      <details className="mt-3">
        <summary className="cursor-pointer text-xs text-slate-500">
          Prefer the address bar?
        </summary>
        <pre className="mt-2 overflow-x-auto rounded-lg border border-white/5 bg-slate-950/60 p-3 text-[11px] leading-relaxed text-slate-400">
          {bookmarklet}
        </pre>
      </details>
    </details>
  );
}
