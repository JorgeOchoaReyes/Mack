// The chat's message box: grows with its text, carries attachments, the
// reasoning setting and the chat's spend, and opens a command menu when the
// message starts with "/". Commands either go to the assistant as typed
// (`/skill …`, which Mack runs before the model's first step) or act in the
// window (`/new`, `/memory`, …); the menu says which.

import { ArrowUp, Brain, ChevronDown, Lightbulb, Paperclip, Slash, Square, X, Zap } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { ReasoningEffort } from "../../api";

export type SlashCommand = {
  /** What is typed, e.g. `/skill lean-golf`. */
  name: string;
  hint: string;
  group: "Skills" | "Chat" | "Panels" | "Start";
  /** Fill the box with this (the person then completes or sends it). */
  insert?: string;
  /** Act in the window instead of sending. */
  run?: () => void;
  /** Sent as typed: Mack handles it. */
  send?: boolean;
};

const EFFORTS: ReasoningEffort[] = ["off", "on", "low", "medium", "high", "xhigh"];

type Props = {
  value: string;
  onChange: (v: string) => void;
  onSend: (sendNow: boolean) => void;
  onStop: () => void;
  onAttach: () => void;
  files: string[];
  onRemoveFile: (f: string) => void;
  commands: SlashCommand[];
  busy: boolean;
  disabled: boolean;
  placeholder: string;
  suggestion: string | null;
  effort: ReasoningEffort;
  onEffort: (e: ReasoningEffort) => void;
  spend?: string;
};

export function Composer(p: Props) {
  const box = useRef<HTMLTextAreaElement>(null);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState("");
  const [effortOpen, setEffortOpen] = useState(false);

  // Grow with the text, up to a third of the window.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, Math.round(window.innerHeight / 3))}px`;
  }, [p.value]);

  const slash = /^\/\S*( \S*)?$/.test(p.value) && p.value !== dismissed;
  const matches = useMemo(() => {
    if (!slash) return [];
    const q = p.value.toLowerCase();
    return p.commands.filter((c) => c.name.toLowerCase().startsWith(q) || c.name.toLowerCase().includes(q.slice(1))).slice(0, 12);
  }, [slash, p.value, p.commands]);
  useEffect(() => setActive(0), [p.value]);

  const pick = (c: SlashCommand) => {
    if (c.run) {
      c.run();
      p.onChange("");
    } else if (c.send) {
      p.onChange(c.name);
      setDismissed(c.name);
    } else {
      p.onChange(c.insert ?? `${c.name} `);
      setDismissed(c.insert ?? `${c.name} `);
    }
    box.current?.focus();
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (matches.length) {
      if (e.key === "ArrowDown") return e.preventDefault(), setActive((a) => (a + 1) % matches.length);
      if (e.key === "ArrowUp") return e.preventDefault(), setActive((a) => (a - 1 + matches.length) % matches.length);
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey && matches[active] && matches[active].name !== p.value.trim())) {
        e.preventDefault();
        return pick(matches[active]);
      }
      if (e.key === "Escape") return e.preventDefault(), setDismissed(p.value);
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (p.value.trim() || p.files.length) p.onSend(p.busy);
    }
  };

  const canSend = !p.disabled && (!!p.value.trim() || p.files.length > 0);
  let lastGroup = "";

  return (
    <div className="composer-wrap">
      {!p.value && p.suggestion && !p.busy && (
        <button type="button" className="suggestion fade-in" onClick={() => p.onChange(p.suggestion!)} title="A suggestion: click to use it">
          <Lightbulb size={13} /> {p.suggestion}
        </button>
      )}
      <div className={`composer ${p.disabled ? "disabled" : ""} ${p.busy ? "busy" : ""}`}>
        {matches.length > 0 && (
          <div className="slash-menu pop-in" role="listbox">
            {matches.map((c, i) => {
              const head = c.group !== lastGroup ? (lastGroup = c.group) : null;
              return (
                <div key={c.name}>
                  {head && <div className="slash-group">{head}</div>}
                  <button type="button" role="option" aria-selected={i === active} className={`slash-item ${i === active ? "active" : ""}`} onMouseEnter={() => setActive(i)} onClick={() => pick(c)}>
                    <span className="slash-name">{c.name}</span>
                    <span className="slash-hint">{c.hint}</span>
                  </button>
                </div>
              );
            })}
            <div className="slash-foot">↑↓ to choose · Tab or Enter to pick · Esc to close</div>
          </div>
        )}
        {p.files.length > 0 && (
          <div className="composer-files">
            {p.files.map((f) => (
              <span key={f} className="file-chip">
                {f.split("/").pop()}
                <button type="button" className="icon-btn" onClick={() => p.onRemoveFile(f)} title="Remove">
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={box}
          rows={1}
          className="composer-input"
          placeholder={p.placeholder}
          value={p.value}
          disabled={p.disabled}
          onChange={(e) => p.onChange(e.target.value)}
          onKeyDown={onKey}
        />
        <div className="composer-bar">
          <button type="button" className="composer-tool" title="Attach files" disabled={p.disabled} onClick={p.onAttach}>
            <Paperclip size={15} />
          </button>
          <button type="button" className="composer-tool" title="Commands" disabled={p.disabled} onClick={() => (p.onChange("/"), setDismissed(""), box.current?.focus())}>
            <Slash size={14} />
          </button>
          <div className="effort">
            <button type="button" className="composer-tool wide" title="How deeply the model thinks in this chat" onClick={() => setEffortOpen(!effortOpen)}>
              <Brain size={14} /> {p.effort} <ChevronDown size={12} />
            </button>
            {effortOpen && (
              <div className="effort-menu pop-in" onMouseLeave={() => setEffortOpen(false)}>
                {EFFORTS.map((e) => (
                  <button key={e} type="button" className={e === p.effort ? "active" : ""} onClick={() => (p.onEffort(e), setEffortOpen(false))}>
                    {e}
                  </button>
                ))}
              </div>
            )}
          </div>
          {p.spend && <span className="spend-chip" title="What this chat's model calls have cost, sub-agents and suggestions included">{p.spend}</span>}
          <span className="composer-hint">{p.busy ? "Enter sends now · it reaches the assistant between steps" : "Enter to send · Shift+Enter for a new line · / for commands"}</span>
          <div className="composer-actions">
            {p.busy ? (
              <>
                {canSend && (
                  <button type="button" className="send-btn secondary" title="Queue: waits for the answer" onClick={() => p.onSend(false)}>
                    Queue
                  </button>
                )}
                {canSend && (
                  <button type="button" className="send-btn" title="Send now: reaches the assistant between steps" onClick={() => p.onSend(true)}>
                    <Zap size={15} />
                  </button>
                )}
                <button type="button" className="send-btn stop" title="Stop" onClick={p.onStop}>
                  <Square size={13} />
                </button>
              </>
            ) : (
              <button type="button" className="send-btn" title="Send" disabled={!canSend} onClick={() => p.onSend(false)}>
                <ArrowUp size={17} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
