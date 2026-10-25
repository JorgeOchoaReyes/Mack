// The assistant's tool work between two answers, folded into one line that
// opens to every call: what it was, its arguments, whether the person
// approved it, and what came back.

import { AlarmClock, Bot, Check, ChevronRight, CircleAlert, FileText, Globe, Hammer, Lock, Search, Sigma, Terminal, Users, X } from "lucide-react";
import { useState, type ComponentType } from "react";
import type { ToolOutcome } from "../../api";

const ICONS: [RegExp, ComponentType<{ size?: number }>][] = [
  [/lean|proof|discovery/, Sigma],
  [/file|skill/, FileText],
  [/web|fetch|http/, Globe],
  [/search/, Search],
  [/shell/, Terminal],
  [/remind/, AlarmClock],
  [/ultramath/, Users],
  [/agent/, Bot],
];
const iconFor = (name: string) => ICONS.find(([re]) => re.test(name))?.[1] ?? Hammer;

const LABELS: Record<string, string> = {
  list_files: "Listed files",
  read_file: "Read",
  search_files: "Searched files",
  write_file: "Wrote",
  remove_file: "Removed",
  check_lean: "Checked with Lean",
  verify_lean: "Verified with Lean",
  web_search: "Searched the web",
  fetch_url: "Read a page",
  start_proof: "Ran a proof search",
  shell_exec: "Ran a command",
  view_image: "Looked at an image",
  run_agent: "Asked a sub-agent",
  conversation_remind: "Set a reminder",
};

function summary(r: ToolOutcome): string {
  const a = r.args;
  const target = (a.path ?? a.query ?? a.url ?? a.command ?? a.task ?? a.problem ?? a.name ?? "") as unknown;
  const t = typeof target === "string" ? target : "";
  return `${LABELS[r.name] ?? r.name.replace(/_/g, " ")}${t ? ` ${t.length > 70 ? `${t.slice(0, 70)}…` : t}` : ""}`;
}

function Call({ r }: { r: ToolOutcome }) {
  const [open, setOpen] = useState(false);
  const Icon = iconFor(r.name);
  return (
    <div className={`act-call ${open ? "open" : ""}`}>
      <button type="button" className="act-row" onClick={() => setOpen(!open)}>
        <span className={`act-icon ${r.ok ? "ok" : "bad"}`}>
          <Icon size={13} />
        </span>
        <span className="act-text">{summary(r)}</span>
        {r.decision === "approved" && (
          <span className="act-tag ok" title="You approved this call">
            <Lock size={10} /> approved
          </span>
        )}
        {r.decision === "denied" && <span className="act-tag bad">denied</span>}
        {r.ok ? <Check size={13} className="ok" /> : r.decision !== "denied" && <X size={13} className="bad" />}
        <ChevronRight size={13} className="chev" />
      </button>
      {open && (
        <div className="act-body fade-in">
          <div className="act-args">
            <code>{r.name}</code> {JSON.stringify(r.args, null, 0).slice(0, 600)}
          </div>
          <pre className="lean-output">{r.output}</pre>
        </div>
      )}
    </div>
  );
}

export function Activity({ results, running }: { results: ToolOutcome[]; running?: boolean }) {
  const [open, setOpen] = useState(false);
  const failed = results.filter((r) => !r.ok).length;
  const names = [...new Set(results.map((r) => LABELS[r.name] ?? r.name.replace(/_/g, " ")))];
  return (
    <div className={`activity fade-in ${open ? "open" : ""}`}>
      <button type="button" className="activity-head" onClick={() => setOpen(!open)}>
        <ChevronRight size={14} className="chev" />
        <span>
          {running ? "Working" : "Worked"} · {results.length} step{results.length === 1 ? "" : "s"}
        </span>
        <span className="activity-names">{names.slice(0, 4).join(", ").toLowerCase()}{names.length > 4 ? "…" : ""}</span>
        {failed > 0 && (
          <span className="act-tag bad">
            <CircleAlert size={10} /> {failed} failed
          </span>
        )}
      </button>
      {open && (
        <div className="activity-body">
          {results.map((r, i) => (
            <Call key={i} r={r} />
          ))}
        </div>
      )}
    </div>
  );
}
