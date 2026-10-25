import { ChevronRight, Coins, Timer } from "lucide-react";
import { useState } from "react";
import type { NodeStatus, SearchNode } from "../../core/search/tree";
import type { RunEvent } from "../api";
import { CodeEditor } from "./CodeEditor";
import { Badge, formatMs } from "./ui";

export type NodeEvent = Extract<RunEvent, { type: "node" }>;

const STATUS: Record<NodeStatus, { label: string; tone: "ok" | "bad" | "warn" | "info" | "neutral" }> = {
  verified: { label: "Verified", tone: "ok" },
  complete: { label: "Complete", tone: "warn" },
  rejected: { label: "Rejected", tone: "bad" },
  sorries: { label: "Partial", tone: "warn" },
  errors: { label: "Lean errors", tone: "bad" },
  invalid: { label: "Refused", tone: "bad" },
  "no verdict": { label: "Timed out", tone: "warn" },
};

/** Nodes in depth-first order, each with its depth, children after their parent. */
function ordered(nodes: SearchNode[]): SearchNode[] {
  const kids = new Map<number, SearchNode[]>();
  for (const n of nodes) if (n.parent !== null) kids.set(n.parent, [...(kids.get(n.parent) ?? []), n]);
  const out: SearchNode[] = [];
  const walk = (id: number) => {
    for (const k of kids.get(id) ?? []) {
      out.push(k);
      walk(k.id);
    }
  };
  walk(0);
  return out;
}

export function TreeSummary({ nodes, rounds, k1 }: { nodes: NodeEvent[]; rounds: number; k1?: number }) {
  const count = (s: NodeStatus) => nodes.filter((n) => n.node.status === s).length;
  const best = Math.max(0, ...nodes.map((n) => n.node.score));
  return (
    <div className="tree-summary">
      <span>
        Round <b>{rounds}</b>
        {k1 ? ` of ${k1}` : ""}
      </span>
      <span>
        <b>{nodes.length}</b> node{nodes.length === 1 ? "" : "s"}
      </span>
      <span>
        best score <b>{best.toFixed(2)}</b>
      </span>
      <span className="muted small">
        {count("sorries")} partial · {count("errors")} with errors · {count("invalid")} refused
      </span>
    </div>
  );
}

export function TreeView({ nodes }: { nodes: NodeEvent[] }) {
  const byId = new Map(nodes.map((n) => [n.node.id, n]));
  const rows = ordered(nodes.map((n) => n.node));
  return (
    <div className="tree">
      <div className="tree-row tree-root">
        <span className="tree-id">0</span>
        <span className="muted">frozen statement</span>
      </div>
      {rows.map((node) => (
        <TreeNode key={node.id} ev={byId.get(node.id)!} />
      ))}
    </div>
  );
}

function TreeNode({ ev }: { ev: NodeEvent }) {
  const { node } = ev;
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"file" | "lean">("file");
  const st = STATUS[node.status];
  return (
    <div className={`tree-node tone-${st.tone} ${open ? "open" : ""}`} style={{ marginLeft: (node.depth - 1) * 18 }}>
      <button className="tree-row" onClick={() => setOpen(!open)}>
        <ChevronRight size={14} className="chev" />
        <span className="tree-id">{node.id}</span>
        <Badge tone={st.tone}>{st.label}</Badge>
        <span className="tree-score">{node.score.toFixed(2)}</span>
        <span className="tree-approach">{node.approach || <span className="muted">from node {node.parent}</span>}</span>
        <span className="attempt-meta">
          {node.status === "sorries" && <span>{node.sorries} sorry</span>}
          {node.status === "errors" && <span>{node.errors} err</span>}
          <Timer size={13} /> {formatMs(ev.ms)}
          {ev.tokens > 0 && (
            <>
              <Coins size={13} /> {ev.tokens.toLocaleString()}
            </>
          )}
        </span>
      </button>
      {open && (
        <div className="attempt-body">
          <div className="tabs">
            <button className={tab === "file" ? "active" : ""} onClick={() => setTab("file")}>
              File
            </button>
            {node.detail && (
              <button className={tab === "lean" ? "active" : ""} onClick={() => setTab("lean")}>
                What the checker said
              </button>
            )}
          </div>
          {tab === "file" ? (
            <div className="code-frame">
              <CodeEditor value={node.file} readOnly />
            </div>
          ) : (
            <pre className="lean-output">{node.detail}</pre>
          )}
          <div className="muted small">
            Round {node.round} · continued from node {node.parent} · {ev.calls} model call{ev.calls === 1 ? "" : "s"}
          </div>
        </div>
      )}
    </div>
  );
}
