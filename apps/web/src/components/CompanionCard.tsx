import { useEffect, useRef, useState } from "react";

import { API_BASE_URL } from "../lib/config";

interface CompanionCardProps {
  roomId: string;
  token: string;
}

function buildRoomLink(roomId: string, token: string, server: string): string {
  return `${window.location.origin}/companion.js?room=${encodeURIComponent(
    roomId,
  )}&token=${encodeURIComponent(token)}&server=${encodeURIComponent(server)}`;
}

function buildRoomBookmarklet(roomLink: string): string {
  return `javascript:(()=>{const s=document.createElement('script');s.src=${JSON.stringify(
    roomLink,
  )}+"&cb="+Date.now();document.body.appendChild(s)})()`;
}

/**
 * Installed once, works forever: no room or token is baked in. It asks for the
 * room link, remembers the last one per site, then loads the companion.
 */
const GENERIC_BOOKMARKLET = [
  "javascript:(()=>{",
  "const K='tempass:companion';",
  "let last='';try{last=localStorage.getItem(K)||''}catch(e){}",
  "const input=prompt('Paste the Tempass companion link for this room',last);",
  "if(!input)return;",
  "if(!/^https?:\\/\\//.test(input)){alert('That does not look like a link.');return}",
  "try{localStorage.setItem(K,input)}catch(e){}",
  "const s=document.createElement('script');",
  "s.src=input+((input.indexOf('?')>-1)?'&':'?')+'cb='+Date.now();",
  "document.body.appendChild(s)",
  "})()",
].join("");

/** React refuses to render `javascript:` URLs, so anchors are built by hand. */
function useBookmarkletAnchor(bookmarklet: string, label: string) {
  const containerRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    container.replaceChildren();

    const anchor = document.createElement("a");
    anchor.href = bookmarklet;
    anchor.textContent = label;
    anchor.draggable = true;
    anchor.className =
      "inline-flex h-9 cursor-grab items-center rounded-lg bg-rose-500 px-4 text-xs font-semibold text-white transition hover:bg-rose-400";
    anchor.addEventListener("click", (event) => {
      event.preventDefault();
      void navigator.clipboard?.writeText(bookmarklet).catch(() => {});
    });

    container.appendChild(anchor);

    return () => {
      container.replaceChildren();
    };
  }, [bookmarklet, label]);

  return containerRef;
}

export function CompanionCard({ roomId, token }: CompanionCardProps) {
  const [copied, setCopied] = useState<"link" | "bookmarklet" | null>(null);

  const server = API_BASE_URL || window.location.origin;
  const roomLink = buildRoomLink(roomId, token, server);
  const roomBookmarklet = buildRoomBookmarklet(roomLink);

  const genericRef = useBookmarkletAnchor(GENERIC_BOOKMARKLET, "Tempass companion");
  const roomRef = useBookmarkletAnchor(roomBookmarklet, "This room only");

  async function copy(value: string, which: "link" | "bookmarklet") {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
      window.setTimeout(() => setCopied(null), 2_000);
    } catch {
      setCopied(null);
    }
  }

  return (
    <details className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <summary className="cursor-pointer text-sm font-semibold text-slate-200">
        Watch a site that blocks embedding
      </summary>

      <p className="mt-3 text-sm text-slate-400">
        Sites like aryplus.tv refuse to be framed, so the picture cannot be
        embedded. Instead, the video plays in the presenter&apos;s own tab and
        that tab is captured into this room: play, pause and seek from here, and
        everyone sees the same screen.
      </p>

      <ol className="mt-4 list-decimal space-y-1 pl-5 text-sm text-slate-400">
        <li>
          <strong className="text-slate-300">Once:</strong> drag the pink button
          to your bookmarks bar. It never needs replacing — it asks for the room
          link each time.
        </li>
        <li>
          Open the episode on the source site and press play.
        </li>
        <li>
          Copy the room link below, then click the bookmark and paste it.
        </li>
        <li>
          The badge appears; press <span className="text-slate-300">Share this
          tab</span> in it and pick the video tab.
        </li>
      </ol>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span ref={genericRef} />
        <button
          type="button"
          onClick={() => copy(roomLink, "link")}
          className="h-9 rounded-lg border border-white/10 bg-white/5 px-4 text-xs font-semibold text-slate-300 transition hover:bg-white/10"
        >
          {copied === "link" ? "Copied" : "Copy room link"}
        </button>
      </div>

      <details className="mt-4">
        <summary className="cursor-pointer text-xs text-slate-500">
          Prefer a one-click bookmark that doesn&apos;t prompt?
        </summary>
        <p className="mt-2 text-xs text-slate-500">
          This variant carries this room&apos;s link inside it. Re-drag it for
          every new room.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span ref={roomRef} />
          <button
            type="button"
            onClick={() => copy(roomBookmarklet, "bookmarklet")}
            className="h-9 rounded-lg border border-white/10 bg-white/5 px-4 text-xs font-semibold text-slate-300 transition hover:bg-white/10"
          >
            {copied === "bookmarklet" ? "Copied" : "Copy code"}
          </button>
        </div>
        <pre className="mt-2 overflow-x-auto rounded-lg border border-white/5 bg-slate-950/60 p-3 text-[11px] leading-relaxed text-slate-400">
          {roomBookmarklet}
        </pre>
      </details>
    </details>
  );
}
