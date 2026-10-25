import { ArrowLeft, Pause, Play, Plus, RefreshCw, Rows3 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, errorText, type RunStatus, type SearchNode } from "../api";
import { TreeView, type NodeEvent } from "../components/TreeView";
import { Badge, Button, timeAgo } from "../components/ui";

const TONE: Record<string, "ok" | "bad" | "warn" | "neutral"> = { solved: "ok", running: "warn", queued: "neutral", exhausted: "bad", stopped: "neutral", failed: "bad" };

/** Proof-search runs over problem sets: started here or from a chat, shown from their journals. */
export function RunsPage() {
  const [runs, setRuns] = useState<RunStatus[]>([]);
  const [open, setOpen] = useState<RunStatus | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [nodes, setNodes] = useState<SearchNode[]>([]);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    setRuns(await api.listDiscovery());
    if (open) setOpen(await api.discoveryStatus(open.name));
  }, [open]);

  useEffect(() => {
    void reload();
    const t = setInterval(() => void reload(), 4000);
    return () => clearInterval(t);
  }, [reload]);

  useEffect(() => {
    if (open && problem) void api.discoveryTree(open.name, problem).then(setNodes);
  }, [open, problem]);

  const act = async (f: () => Promise<unknown>) => {
    setError("");
    try {
      await f();
      await reload();
    } catch (e) {
      setError(errorText(e));
    }
  };

  if (open) {
    const events: NodeEvent[] = nodes.filter((n) => n.parent !== null).map((n) => ({ type: "node", node: n, ms: 0, tokens: 0, calls: 0 }));
    return (
      <div className="page">
        <div className="page-head">
          <button className="link" onClick={() => (setOpen(null), setProblem(null))}>
            <ArrowLeft size={14} /> All runs
          </button>
          <h1 className="mono-title">{open.name}</h1>
          <p className="muted">
            <Badge tone={open.state === "ended" ? "ok" : open.state === "running" ? "warn" : "neutral"}>{open.state}</Badge> started {timeAgo(open.startedAt)}
          </p>
          <div className="row gap-sm">
            {open.state === "running" ? (
              <Button variant="danger" icon={Pause} onClick={() => void act(() => api.stopDiscovery(open.name))}>
                Stop
              </Button>
            ) : (
              open.problems.some((p) => p.state !== "solved" && p.state !== "exhausted") && (
                <Button variant="primary" icon={Play} onClick={() => void act(() => api.resumeDiscovery(open.name))} title="Continue from what the run recorded; spends model calls">
                  Resume
                </Button>
              )
            )}
          </div>
        </div>
        {error && <div className="notice notice-bad">{error}</div>}
        {open.failureReasons.length > 0 && (
          <section className="settings-group">
            <h2>What keeps going wrong</h2>
            <ul className="small">
              {open.failureReasons.map((f) => (
                <li key={f.reason}>
                  {f.count}× <code>{f.reason}</code>
                </li>
              ))}
            </ul>
          </section>
        )}
        <div className="run-list">
          {open.problems.map((p) => (
            <button key={p.id} className={`run-row ${problem === p.id ? "active" : ""}`} onClick={() => setProblem(p.id)}>
              <Badge tone={TONE[p.state]}>{p.state}</Badge>
              <span className="run-thm mono">{p.id}</span>
              <span className="muted small">{p.message?.split("\n")[0] ?? ""}</span>
              <span className="run-meta muted small">
                {p.nodes} node{p.nodes === 1 ? "" : "s"} · best {p.best.toFixed(2)}
              </span>
            </button>
          ))}
        </div>
        {problem && events.length > 0 && <TreeView nodes={events} />}
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Proof-search runs</h1>
        <p className="muted">
          A run explores a set of problems, each as its own search tree, and records every node, so it can be watched, stopped and resumed. Start one here or
          ask the assistant in Chat; Search-tree settings apply.
        </p>
        <div className="row gap-sm">
          <Button variant="primary" icon={Plus} onClick={() => void act(() => api.startDiscoveryFromFiles())}>
            New run from .lean files
          </Button>
          <Button icon={RefreshCw} onClick={() => void reload()}>
            Refresh
          </Button>
        </div>
      </div>
      {error && <div className="notice notice-bad">{error}</div>}
      {runs.length === 0 ? (
        <div className="empty">
          <Rows3 size={28} />
          <p>No runs yet.</p>
        </div>
      ) : (
        <div className="run-list">
          {runs.map((r) => (
            <button key={r.name} className="run-row" onClick={() => setOpen(r)}>
              <Badge tone={r.state === "ended" ? "ok" : r.state === "running" ? "warn" : "neutral"}>{r.state}</Badge>
              <span className="run-thm mono">{r.name}</span>
              <span className="muted small">
                {r.problems.filter((p) => p.state === "solved").length} of {r.problems.length} solved
              </span>
              <span className="run-meta muted small">{timeAgo(r.startedAt)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
