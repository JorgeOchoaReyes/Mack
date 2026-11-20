// Ctrl+K (⌘K on a Mac): type a few letters to go anywhere in Mack.

import type { LucideIcon } from "lucide-react";
import { CornerDownLeft, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export type Command = { id: string; label: string; hint: string; icon: LucideIcon; run: () => void };

/** Commands whose label or hint holds every typed word, labels that start with the query first. */
export function matchCommands(commands: Command[], query: string): Command[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return commands;
  const hits = commands.filter((c) => words.every((w) => `${c.label} ${c.hint}`.toLowerCase().includes(w)));
  const starts = (c: Command) => (c.label.toLowerCase().startsWith(words[0]) ? 0 : 1);
  return hits.sort((a, b) => starts(a) - starts(b));
}

export const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);

export function CommandPalette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const shown = matchCommands(commands, query);

  useEffect(() => input.current?.focus(), []);
  useEffect(() => setAt(0), [query]);

  const choose = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    c.run();
  };

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div className="palette" role="dialog" aria-label="Go to" onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette-input">
          <Search size={16} />
          <input
            ref={input}
            value={query}
            placeholder="Where to? Type a screen or an action…"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              else if (e.key === "ArrowDown") (e.preventDefault(), setAt((i) => Math.min(shown.length - 1, i + 1)));
              else if (e.key === "ArrowUp") (e.preventDefault(), setAt((i) => Math.max(0, i - 1)));
              else if (e.key === "Enter") (e.preventDefault(), choose(shown[at]));
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <ul className="palette-list" role="listbox">
          {shown.length === 0 && <li className="palette-none">Nothing matches “{query}”.</li>}
          {shown.map((c, i) => (
            <li key={c.id} role="option" aria-selected={i === at}>
              <button className={i === at ? "active" : ""} onMouseEnter={() => setAt(i)} onClick={() => choose(c)}>
                <c.icon size={16} />
                <span className="palette-label">{c.label}</span>
                <span className="palette-hint">{c.hint}</span>
                {i === at && <CornerDownLeft size={13} className="palette-enter" />}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
