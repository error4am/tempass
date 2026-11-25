import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";

import { EMOJI_CATEGORIES, filterEmojis } from "../lib/emoji";

const COLUMNS = 8;

interface EmojiPickerProps {
  onSelect: (char: string) => void;
  onClose: () => void;
  excludeRef?: RefObject<HTMLElement | null>;
}

export function EmojiPicker({ onSelect, onClose, excludeRef }: EmojiPickerProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const results = useMemo(() => filterEmojis(query), [query]);
  const indexById = useMemo(
    () => new Map(results.map((emoji, index) => [emoji.id, index] as const)),
    [results],
  );
  const groups = useMemo(
    () =>
      EMOJI_CATEGORIES.map((category) => ({
        id: category.id,
        label: category.label,
        emojis: results.filter((emoji) => emoji.categoryId === category.id),
      })).filter((group) => group.emojis.length > 0),
    [results],
  );

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleMouseDown(event: MouseEvent) {
      const target = event.target;

      if (!(target instanceof Node)) {
        return;
      }

      if (rootRef.current?.contains(target)) {
        return;
      }

      if (excludeRef?.current?.contains(target)) {
        return;
      }

      onClose();
    }

    document.addEventListener("mousedown", handleMouseDown);

    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
    };
  }, [excludeRef, onClose]);

  useEffect(() => {
    if (activeIndex < 0) {
      return;
    }

    const active = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');

    if (active && typeof active.scrollIntoView === "function") {
      active.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex]);

  function selectIndex(index: number) {
    const emoji = results[index];

    if (emoji) {
      onSelect(emoji.char);
    }
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const index = activeIndex >= 0 ? activeIndex : query.trim().length > 0 ? 0 : -1;

      if (index >= 0) {
        selectIndex(index);
      }

      return;
    }

    if (results.length === 0) {
      return;
    }

    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const delta = event.key === "ArrowRight" ? 1 : -1;
      setActiveIndex((current) => {
        const next = current < 0 ? 0 : current + delta;
        return Math.min(results.length - 1, Math.max(0, next));
      });
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? COLUMNS : -COLUMNS;
      setActiveIndex((current) => {
        const next = current < 0 ? 0 : current + delta;
        return Math.min(results.length - 1, Math.max(0, next));
      });
      return;
    }
  }

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="Emoji picker"
      onKeyDown={handleKeyDown}
      className="w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-white/[0.1] bg-[#18181b] p-2.5 shadow-2xl shadow-black/70"
    >
      <input
        ref={searchRef}
        type="search"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveIndex(-1);
        }}
        placeholder="Search emoji"
        aria-label="Search emoji"
        className="block w-full min-w-0 rounded-lg border border-white/[0.08] bg-[#0e0e10] px-2.5 py-1.5 text-xs text-[#e5e1e4] placeholder:text-[#6c666d] focus:border-[#ff516a]/60 focus:outline-none focus:ring-2 focus:ring-[#ff516a]/20"
      />

      <div ref={listRef} className="chat-scroll mt-1.5 max-h-64 overflow-y-auto pr-1">
        {results.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-[#8d8487]">No emoji found.</p>
        ) : (
          groups.map((group) => (
            <div key={group.id} role="group" aria-label={group.label}>
              <p className="px-1 pb-1 pt-2 font-mono text-[10px] font-medium uppercase tracking-wider text-[#8d8487]">
                {group.label}
              </p>
              <div className="grid grid-cols-8 gap-1">
                {group.emojis.map((emoji) => {
                  const index = indexById.get(emoji.id) ?? -1;

                  return (
                    <button
                      key={emoji.id}
                      type="button"
                      data-active={index === activeIndex ? "true" : undefined}
                      onClick={() => selectIndex(index)}
                      onMouseEnter={() => setActiveIndex(index)}
                      aria-label={emoji.name}
                      title={emoji.name}
                      className={`flex h-8 items-center justify-center rounded-md text-lg leading-none transition hover:bg-[#2a2a2c] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff516a]/40 ${
                        index === activeIndex ? "bg-[#2a2a2c]" : ""
                      }`}
                    >
                      <span aria-hidden="true">{emoji.char}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
