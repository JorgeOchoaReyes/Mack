import { CheckCheck, Gavel, ShieldCheck } from "lucide-react";
import type { RunEvent } from "../api";
import type { Direction, DirectionState, Post } from "../../core/ultramath/swarm";
import { Badge, CopyButton } from "./ui";

type Accepted = Extract<RunEvent, { type: "accepted" }>;

const STATE_TONE: Record<DirectionState, "ok" | "bad" | "warn" | "neutral"> = {
  working: "warn",
  succeeded: "ok",
  abandoned: "neutral",
  died: "bad",
};

/** The swarm as its events tell it: members, directions, the board and the reports. */
export function UltramathView({ events }: { events: RunEvent[] }) {
  const directions = new Map<number, Direction>();
  const posts: Post[] = [];
  const last = new Map<number, Extract<RunEvent, { type: "turn" }>>();
  const reports: Extract<RunEvent, { type: "report" }>[] = [];
  const refusals: Extract<RunEvent, { type: "refused" }>[] = [];
  let members = 0;
  let kind = "";
  for (const e of events) {
    if (e.type === "start") {
      members = e.members;
      kind = e.kind;
    }
    if (e.type === "direction") directions.set(e.direction.id, e.direction);
    if (e.type === "post") posts.push(e.post);
    if (e.type === "turn") last.set(e.member, e);
    if (e.type === "report") reports.push(e);
    if (e.type === "refused") refusals.push(e);
  }
  const held = (m: number) => [...directions.values()].reverse().find((d) => d.member === m);

  return (
    <div className="ultra">
      <div className="muted small">
        {members} member{members === 1 ? "" : "s"} · {kind === "lean" ? "the strict Lean verifier judges submissions" : "the coordinating agent judges submissions"}
      </div>
      <div className="ultra-members">
        {Array.from({ length: members }, (_, i) => i + 1).map((m) => {
          const d = held(m);
          const t = last.get(m);
          return (
            <div key={m} className="ultra-member">
              <div className="row gap-sm">
                <b>Member {m}</b>
                {d && <Badge tone={STATE_TONE[d.state]}>{d.state}</Badge>}
                {t && <span className="muted small">round {t.round}</span>}
              </div>
              <div className="small">{d ? `[${d.id}] ${d.text}` : <span className="muted">no direction yet</span>}</div>
              {t && <div className="muted small">{t.summary}</div>}
            </div>
          );
        })}
      </div>

      {reports.length > 0 && (
        <section>
          <h4 className="ultra-h">
            <Gavel size={14} /> Reports
          </h4>
          {reports.map((r, i) => (
            <div key={i} className={`ultra-report tone-${r.accepted ? "ok" : "bad"}`}>
              <div className="row gap-sm">
                <b>Member {r.member}</b>
                <Badge tone={r.accepted ? "ok" : "bad"}>{r.accepted ? "accepted" : "rejected"}</Badge>
              </div>
              <div className="small">{r.report}</div>
              <div className="muted small">Judge: {r.reason}</div>
            </div>
          ))}
        </section>
      )}

      <section>
        <h4 className="ultra-h">Board</h4>
        {posts.length === 0 && refusals.length === 0 && <div className="muted small">Nothing posted yet.</div>}
        <div className="ultra-board">
          {posts.map((p) => (
            <div key={p.id} className="ultra-post">
              <span className="tree-id">#{p.id}</span>
              <Badge tone={p.kind === "dead end" || p.kind === "counterexample" ? "bad" : p.checked ? "ok" : "neutral"}>
                {p.kind}
                {p.checked ? " ✓" : ""}
              </Badge>
              <span className="muted small">member {p.member}</span>
              <pre className="ultra-text">{p.text}</pre>
            </div>
          ))}
          {refusals.map((r, i) => (
            <div key={`r${i}`} className="ultra-post">
              <Badge tone="warn">refused</Badge>
              <span className="muted small">
                member {r.member}, duplicate of [{r.duplicateOf}]
              </span>
              <pre className="ultra-text">
                {r.text}
                {r.reason ? `\n— ${r.reason}` : ""}
              </pre>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export function AcceptedCard({ accepted }: { accepted: Accepted }) {
  return (
    <div className="solved-card">
      <div className="solved-head">
        <div className="solved-icon">
          <CheckCheck size={22} />
        </div>
        <div>
          <div className="solved-title">Accepted by the judge</div>
          <div className="solved-sub">
            Member {accepted.member}'s solution, refereed by the coordinating agent. No Lean statement was given, so no proof checker has verified it.
          </div>
        </div>
      </div>
      <div className="small">
        <ShieldCheck size={13} /> {accepted.reason}
      </div>
      <pre className="ultra-solution">{accepted.solution}</pre>
      <div className="row gap-sm">
        <CopyButton text={accepted.solution} label="Copy solution" />
      </div>
    </div>
  );
}
