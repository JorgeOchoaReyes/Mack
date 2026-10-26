import { ArrowLeft, CircleAlert, History, RotateCcw, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type RunEvent, type RunRecord, type RunSummary } from "../api";
import { CodeEditor } from "../components/CodeEditor";
import { SolvedCard, Timeline } from "../components/RunView";
import { TreeSummary, TreeView, type NodeEvent } from "../components/TreeView";
import { AcceptedCard, UltramathView } from "../components/UltramathView";
import { Button, formatMs, ScopeSwitch, timeAgo } from "../components/ui";

type Props = { refreshKey: number; projectId: string; projectName: string; onRerun: (problem: string) => void };

export function HistoryPage({ refreshKey, projectId, projectName, onRerun }: Props) {
  const [allRuns, setRuns] = useState<RunSummary[]>([]);
  const [all, setAll] = useState(!projectId);
  const runs = all || !projectId ? allRuns : allRuns.filter((r) => r.projectId === projectId);
  const [open, setOpen] = useState<RunRecord | null>(null);

  const reload = () => void api.listRuns().then(setRuns);
  useEffect(reload, [refreshKey]);

  if (open) {
    const attempts = open.events.filter((e): e is Extract<RunEvent, { type: "attempt" }> => e.type === "attempt");
    const nodes = open.events.filter((e): e is NodeEvent => e.type === "node");
    const rounds = open.events.filter((e) => e.type === "round").length;
    const solved = open.events.find((e): e is Extract<RunEvent, { type: "solved" }> => e.type === "solved");
    const isSearch = open.mode === "search";
    const accepted = open.events.find((e): e is Extract<RunEvent, { type: "accepted" }> => e.type === "accepted");
    const where = isSearch ? `Node ${solved?.n} of the search tree` : open.mode === "ultramath" ? `Member ${solved?.n}` : undefined;
    return (
      <div className="page">
        <div className="page-head">
          <button className="link" onClick={() => setOpen(null)}>
            <ArrowLeft size={14} /> All runs
          </button>
          <h1 className="mono-title">{/^theorem\s+(\S+)/m.exec(open.problem)?.[1] ?? "untitled"}</h1>
          <p className="muted">
            {new Date(open.startedAt).toLocaleString()} · {open.model.split("/").pop()} · {formatMs(open.finishedAt - open.startedAt)}
          </p>
          <div className="row gap-sm">
            <Button variant="primary" icon={RotateCcw} onClick={() => onRerun(open.problem)}>
              Open in editor
            </Button>
            <Button
              variant="ghost"
              icon={Trash2}
              onClick={async () => {
                await api.deleteRun(open.id);
                setOpen(null);
                reload();
              }}
            >
              Delete
            </Button>
          </div>
        </div>
        <div className="code-frame">
          <CodeEditor value={open.problem} readOnly />
        </div>
        {solved ? (
          <SolvedCard solved={solved} problem={open.problem} where={where} />
        ) : accepted ? (
          <AcceptedCard accepted={accepted} />
        ) : (
          open.message && <div className="notice notice-bad">{open.message}</div>
        )}
        {open.mode === "ultramath" ? (
          <UltramathView events={open.events} />
        ) : isSearch ? (
          <>
            <TreeSummary nodes={nodes} rounds={rounds} />
            <TreeView nodes={nodes} />
          </>
        ) : (
          <Timeline attempts={attempts} />
        )}
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>History</h1>
        <p className="muted">Every run is kept on this computer, with each attempt and what Lean said about it.</p>
        <ScopeSwitch projectName={projectName} all={all || !projectId} onChange={setAll} />
      </div>
      {runs.length === 0 ? (
        <div className="empty">
          <History size={28} />
          <p>{allRuns.length && !all ? `No runs in ${projectName} yet.` : "No runs yet."}</p>
        </div>
      ) : (
        <div className="run-list">
          {runs.map((r) => (
            <button key={r.id} className="run-row" onClick={() => void api.getRun(r.id).then(setOpen)}>
              {r.outcome === "solved" ? <ShieldCheck size={17} className="ok" /> : <CircleAlert size={17} className="bad" />}
              <span className="run-thm mono" title={r.file}>
                {r.theorem}
                {r.file ? <span className="muted small"> · {r.file}</span> : null}
              </span>
              <span className="muted small">{r.outcome === "solved" ? "Verified" : r.message.split("\n")[0]}</span>
              <span className="run-meta muted small">
                {r.mode === "search"
                  ? `search tree, ${r.attempts} node${r.attempts === 1 ? "" : "s"}`
                  : r.mode === "ultramath"
                    ? `Ultramath, ${r.attempts} turn${r.attempts === 1 ? "" : "s"}`
                    : `${r.attempts} attempt${r.attempts === 1 ? "" : "s"}`}{" "}
                · {r.model.split("/").pop()} · {timeAgo(r.startedAt)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
