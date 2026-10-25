import { ChevronRight, Coins, FileDown, ShieldCheck, Timer } from "lucide-react";
import { useState } from "react";
import { api, theoremName, type RunEvent } from "../api";
import { CodeEditor } from "./CodeEditor";
import { Badge, CopyButton, formatMs, OutcomeBadge, outcomeTone, Button } from "./ui";

type Attempt = Extract<RunEvent, { type: "attempt" }>;
type Solved = Extract<RunEvent, { type: "solved" }>;

export function SolvedCard({ solved, problem, where }: { solved: Solved; problem: string; where?: string }) {
  return (
    <div className="solved-card">
      <div className="solved-head">
        <div className="solved-icon">
          <ShieldCheck size={22} />
        </div>
        <div>
          <div className="solved-title">Verified by Lean</div>
          <div className="solved-sub">
            {where ?? `Attempt ${solved.n}`} · the statement is unchanged, nothing is assumed, and Lean's kernel accepts the proof.
          </div>
        </div>
      </div>
      <div className="axioms">
        <span className="muted">Axioms used</span>
        {solved.axioms.length ? solved.axioms.map((a) => <Badge key={a}>{a}</Badge>) : <Badge>none</Badge>}
      </div>
      <div className="code-frame">
        <CodeEditor value={solved.proof} readOnly />
      </div>
      <div className="row gap-sm">
        <CopyButton text={solved.proof} label="Copy proof" />
        <Button size="sm" icon={FileDown} onClick={() => void api.saveLean(theoremName(problem), solved.proof)}>
          Save .lean
        </Button>
      </div>
    </div>
  );
}

export function AttemptCard({ attempt, defaultOpen }: { attempt: Attempt; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [tab, setTab] = useState<"proof" | "lean">(attempt.detail ? "lean" : "proof");
  return (
    <div className={`attempt tone-${outcomeTone(attempt.outcome)} ${open ? "open" : ""}`}>
      <button className="attempt-head" onClick={() => setOpen(!open)}>
        <ChevronRight size={15} className="chev" />
        <span className="attempt-n">Attempt {attempt.n}</span>
        <OutcomeBadge outcome={attempt.outcome} />
        <span className="attempt-meta">
          <Timer size={13} /> {formatMs(attempt.ms)}
          {attempt.tokens > 0 && (
            <>
              <Coins size={13} /> {attempt.tokens.toLocaleString()} tokens
            </>
          )}
        </span>
      </button>
      {open && (
        <div className="attempt-body">
          <div className="tabs">
            <button className={tab === "proof" ? "active" : ""} onClick={() => setTab("proof")}>
              Proposed proof
            </button>
            {attempt.detail && (
              <button className={tab === "lean" ? "active" : ""} onClick={() => setTab("lean")}>
                What the checker said
              </button>
            )}
          </div>
          {tab === "proof" ? (
            <div className="code-frame">
              <CodeEditor value={attempt.candidate} readOnly />
            </div>
          ) : (
            <pre className="lean-output">{attempt.detail}</pre>
          )}
        </div>
      )}
    </div>
  );
}

export function Timeline({ attempts }: { attempts: Attempt[] }) {
  return (
    <div className="timeline">
      {[...attempts].reverse().map((a, i) => (
        <AttemptCard key={a.n} attempt={a} defaultOpen={i === 0 && a.outcome !== "verified"} />
      ))}
    </div>
  );
}
