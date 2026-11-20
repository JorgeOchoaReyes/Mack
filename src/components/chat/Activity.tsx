// The assistant's tool work between two answers, folded into one line that
// opens to every call: what it was, its arguments, whether the person
// approved it, and what came back.

import { AlarmClock, Bot, Check, ChevronRight, CircleAlert, FileCode, FileText, FlaskConical, GitBranch, GitPullRequest, Globe, Hammer, ListChecks, Lock, Rows3, Search, ShieldCheck, Shapes, Sigma, Terminal, Users, X, Zap } from "lucide-react";
import { useState, type ComponentType } from "react";
import type { ToolOutcome } from "../../api";

/** Mack's features, by the tools that use them: what the person sees named in the chat. */
const FEATURES: [RegExp, { label: string; icon: ComponentType<{ size?: number }> }][] = [
  [/^start_proof$/, { label: "Proof run", icon: FlaskConical }],
  [/^discovery_/, { label: "Proof search", icon: Rows3 }],
  [/^ultramath_/, { label: "Ultramath", icon: Users }],
  [/^construction_/, { label: "Construction search", icon: Shapes }],
  [/^check_statement$/, { label: "Statement check", icon: Zap }],
  [/^verify_lean$/, { label: "Verifier", icon: ShieldCheck }],
  [/^check_lean$/, { label: "Lean check", icon: Sigma }],
  [/^(web_search|fetch_url|http_request)$/, { label: "Web", icon: Globe }],
  [/^shell_/, { label: "Commands", icon: Terminal }],
  [/^run_agent$/, { label: "Sub-agent", icon: Bot }],
  [/^plan_update$/, { label: "Plan", icon: ListChecks }],
  [/^open_pr$/, { label: "Pull request", icon: GitPullRequest }],
  [/^conversation_/, { label: "Reminders", icon: AlarmClock }],
];
const featureOf = (name: string) => FEATURES.find(([re]) => re.test(name))?.[1];

const ICONS: [RegExp, ComponentType<{ size?: number }>][] = [
  [/construction/, Shapes],
  [/check_statement/, Zap],
  [/discovery/, Rows3],
  [/plan/, ListChecks],
  [/pr$/, GitBranch],
  [/lean|proof/, Sigma],
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
  start_proof: "Ran a proof",
  check_statement: "Tried to break the statement",
  construction_search: "Started a construction search",
  construction_status: "Checked the construction search",
  construction_stop: "Stopped the construction search",
  ultramath_start: "Started an Ultramath swarm",
  ultramath_status: "Checked the swarm",
  ultramath_verdict: "Judged a swarm submission",
  ultramath_records: "Read the swarm's records",
  ultramath_stop: "Stopped the swarm",
  ultramath_resume: "Resumed the swarm",
  discovery_start: "Started a proof search",
  discovery_status: "Checked the proof search",
  discovery_list: "Listed proof searches",
  discovery_tree: "Read a search tree",
  discovery_stop: "Stopped the proof search",
  discovery_resume: "Resumed the proof search",
  plan_update: "Updated the plan",
  open_pr: "Opened a pull request",
  http_request: "Made a web request",
  shell_jobs: "Checked background commands",
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

/** The project .lean files these calls wrote, each once, in the order written. */
function leanWritten(results: ToolOutcome[]): string[] {
  const paths = results.filter((r) => r.ok && r.name === "write_file" && typeof r.args.path === "string" && r.args.path.endsWith(".lean")).map((r) => (r.args.path as string).replace(/\\/g, "/").replace(/^\.\//, ""));
  return [...new Set(paths)];
}

export function Activity({ results, running, onOpenInProve }: { results: ToolOutcome[]; running?: boolean; onOpenInProve?: (path: string) => void }) {
  const [open, setOpen] = useState(false);
  const written = onOpenInProve ? leanWritten(results) : [];
  const failed = results.filter((r) => !r.ok).length;
  // The features these calls used, each once, in order: the person sees what Mack did, not tool names.
  const features = [...new Map(results.map((r) => featureOf(r.name)).filter((f) => !!f).map((f) => [f!.label, f!])).values()];
  const others = results.filter((r) => !featureOf(r.name)).length;
  return (
    <div className={`activity fade-in ${open ? "open" : ""}`}>
      <button type="button" className="activity-head" onClick={() => setOpen(!open)}>
        <ChevronRight size={14} className="chev" />
        <span>
          {running ? "Working" : "Worked"} · {results.length} step{results.length === 1 ? "" : "s"}
        </span>
        <span className="activity-features">
          {features.map((f) => (
            <span key={f.label} className="feature-chip">
              <f.icon size={11} /> {f.label}
            </span>
          ))}
          {others > 0 && <span className="muted small">{features.length ? `+ ${others} file and read step${others === 1 ? "" : "s"}` : "files and reading"}</span>}
        </span>
        {failed > 0 && (
          <span className="act-tag bad">
            <CircleAlert size={10} /> {failed} failed
          </span>
        )}
      </button>
      {written.length > 0 && (
        <div className="activity-files">
          {written.map((p) => (
            <button key={p} type="button" className="file-chip prove-chip" title={`Open ${p} on the Prove screen`} onClick={() => onOpenInProve?.(p)}>
              <FileCode size={12} /> {p.split("/").pop()}
              <span className="prove-chip-go">
                <FlaskConical size={11} /> Open in Prove
              </span>
            </button>
          ))}
        </div>
      )}
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
