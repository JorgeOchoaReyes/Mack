import { AlarmClock, BookOpen, Bot, Calculator, ChevronRight, FileCheck2, GitPullRequest, Globe, MessagesSquare, Network, Rows3, Terminal, Users, CircleCheck, CircleDashed, CircleDot, CircleSlash, Lightbulb, OctagonAlert, PenLine, ShieldCheck, Sparkles, X, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type ChatWire, type Plan, type PlanStep, type StepKind, type StepStatus, type StepVia } from "../api";
import { timeAgo } from "./ui";

/** Each kind of step, said the way a newcomer would say it. */
const KIND: Record<StepKind, { label: string; icon: LucideIcon; hint: string }> = {
  lean: { label: "Prove in Lean", icon: ShieldCheck, hint: "Lean is a proof checker: a computer checks every line, so a verified step is certain, not taken on trust." },
  read: { label: "Read", icon: BookOpen, hint: "Find out what mathematicians already know: papers, books, known results." },
  compute: { label: "Compute", icon: Calculator, hint: "Try examples or search with a program. Evidence, not proof." },
  think: { label: "Think", icon: Lightbulb, hint: "Work out an idea: a reduction, a special case, a way in." },
  write: { label: "Write up", icon: PenLine, hint: "Put what we found into words, with what is and is not proved." },
};

/** The Mack feature a step uses, and what it is, for someone who has not met it yet. */
const VIA: Record<StepVia, { label: string; icon: LucideIcon; hint: string }> = {
  chat: { label: "In the chat", icon: MessagesSquare, hint: "Worked out in the conversation with you." },
  web: { label: "Web & papers", icon: Globe, hint: "Searches the web and reads papers and PDFs, and saves notes in the problem folder." },
  python: { label: "Python", icon: Terminal, hint: "Runs a program on your computer to test examples or search numerically. Evidence, not proof." },
  lean_check: { label: "Lean statement", icon: FileCheck2, hint: "Writes the exact claim in Lean and checks it compiles, so everyone agrees what is being proved." },
  proof_run: { label: "Proof run", icon: Network, hint: "The model tries to prove one Lean statement; Lean's verifier decides. Shown under Proof attempts." },
  proof_search: { label: "Proof search", icon: Rows3, hint: "A long search for proofs of several Lean statements at once. Shown under Proof searches." },
  ultramath: { label: "Ultramath swarm", icon: Users, hint: "Several AI agents attack one hard question from different directions, sharing what they find." },
  agents: { label: "Helper agent", icon: Bot, hint: "A helper does a side task in parallel, like reading one paper." },
  reminder: { label: "Check back later", icon: AlarmClock, hint: "Long work runs on its own; the assistant comes back to it when it is due." },
  pull_request: { label: "Pull request", icon: GitPullRequest, hint: "Publishes finished work to GitHub for review." },
};

const STATUS: Record<StepStatus, { label: string; icon: LucideIcon }> = {
  todo: { label: "To do", icon: CircleDashed },
  doing: { label: "In progress", icon: CircleDot },
  done: { label: "Done", icon: CircleCheck },
  stuck: { label: "Stuck", icon: OctagonAlert },
  dropped: { label: "Dropped", icon: CircleSlash },
};

/** The first sentence of a passage: what the outlook says when it is folded. */
function firstSentence(text: string): string {
  const m = /^.*?[.!?](\s|$)/s.exec(text);
  return (m ? m[0] : text).trim();
}

/**
 * The problem's plan beside the chat, short by default: the goal, a one-line outlook and one line per step.
 * Everything else (the full outlook, why a step matters, what came of it) opens on a click.
 */
export function PlanView({ projectId, onAsk, onClose }: { projectId: string; onAsk: (text: string) => void; onClose: () => void }) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [goalOpen, setGoalOpen] = useState(false);
  const [openSteps, setOpenSteps] = useState<Set<string>>(new Set());
  const [showFinished, setShowFinished] = useState(false);

  useEffect(() => {
    let live = true;
    void api.getPlan(projectId).then((p) => live && setPlan(p)).catch(() => live && setPlan(null));
    const off = api.onChatEvent((w: ChatWire) => {
      if ("plan" in w && w.projectId === projectId) setPlan(w.plan);
    });
    return () => {
      live = false;
      off();
    };
  }, [projectId]);

  const toggle = (id: string) =>
    setOpenSteps((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const steps = plan?.steps ?? [];
  const counted = steps.filter((s) => s.status !== "dropped");
  const done = counted.filter((s) => s.status === "done").length;
  const verified = steps.filter((s) => s.verified).length;
  const finished = steps.filter((s) => s.status === "done" || s.status === "dropped");
  const ahead = steps.filter((s) => s.status !== "done" && s.status !== "dropped");
  const empty = !plan || (!plan.goal && !steps.length);

  return (
    <aside className="plan">
      <div className="plan-head">
        <span className="plan-head-title">Plan</span>
        {counted.length > 0 && (
          <>
            <span className="plan-head-count" title={verified ? `${verified} step${verified === 1 ? "" : "s"} checked by Lean` : undefined}>
              {done}/{counted.length} done{verified ? ` · ${verified}` : ""}
              {verified > 0 && <ShieldCheck size={11} className="ok" style={{ marginLeft: 2, verticalAlign: -1 }} />}
            </span>
            <div className="plan-bar">
              <span style={{ width: `${(done / counted.length) * 100}%` }} />
            </div>
          </>
        )}
        <button className="icon-btn" title="Hide the plan" onClick={onClose} style={counted.length ? undefined : { marginLeft: "auto" }}>
          <X size={14} />
        </button>
      </div>

      {empty ? (
        <div className="plan-empty">
          <Sparkles size={18} className="accent" />
          <p>No plan yet. Tell the assistant about the problem: it writes down the goal, says honestly how hard it is, and breaks the work into steps you can follow here.</p>
          <button className="link small" onClick={() => onAsk("Make a plan for this problem: explain it in plain words, tell me honestly how hard it is and what is already known, and break the work into steps.")}>
            Ask for a plan
          </button>
        </div>
      ) : (
        <div className="plan-body">
          {plan.goal && (
            <button className={`plan-goal ${goalOpen ? "" : "clamped"}`} title={goalOpen ? undefined : "Show all"} onClick={() => setGoalOpen(!goalOpen)}>
              {plan.goal}
            </button>
          )}
          {plan.outlook && (
            <details className="plan-outlook">
              <summary>
                <ChevronRight size={13} className="chev" />
                <span>
                  <b>Where we stand: </b>
                  {firstSentence(plan.outlook)}
                </span>
              </summary>
              {plan.outlook !== firstSentence(plan.outlook) && <p>{plan.outlook.slice(firstSentence(plan.outlook).length).trim()}</p>}
            </details>
          )}

          <ol className="plan-steps">
            {ahead.map((s) => (
              <Step key={s.id} step={s} open={openSteps.has(s.id)} onToggle={() => toggle(s.id)} />
            ))}
          </ol>

          {finished.length > 0 && (
            <>
              <button className="plan-group" onClick={() => setShowFinished(!showFinished)}>
                <ChevronRight size={12} style={{ transform: showFinished ? "rotate(90deg)" : undefined }} />
                Done ({finished.length})
              </button>
              {showFinished && (
                <ol className="plan-steps">
                  {finished.map((s) => (
                    <Step key={s.id} step={s} open={openSteps.has(s.id)} onToggle={() => toggle(s.id)} />
                  ))}
                </ol>
              )}
            </>
          )}

          {plan.updatedAt > 0 && <div className="muted small" style={{ paddingLeft: 8 }}>Updated {timeAgo(plan.updatedAt)}</div>}
        </div>
      )}
    </aside>
  );
}

function Step({ step, open, onToggle }: { step: PlanStep; open: boolean; onToggle: () => void }) {
  const kind = KIND[step.kind];
  const via = step.via && step.via !== "chat" ? VIA[step.via] : undefined;
  const RowIcon = via?.icon ?? kind.icon;
  const status = STATUS[step.status];
  return (
    <li className={`plan-step status-${step.status} ${open ? "open" : ""}`}>
      <button className="plan-step-row" onClick={onToggle} aria-expanded={open} title={open ? undefined : step.title}>
        <status.icon size={15} className="plan-step-status" aria-label={status.label} />
        <span className="plan-step-title">{step.title}</span>
        <span className="plan-step-icons">
          {step.verified ? <ShieldCheck size={13} className="is-verified" aria-label="Verified by Lean" /> : <RowIcon size={13} className={step.kind === "lean" ? "is-lean" : ""} aria-label={via?.label ?? kind.label} />}
        </span>
      </button>
      {open && (
        <div className="plan-step-detail">
          <div className="plan-step-meta">
            <span className={`plan-kind kind-${step.kind}`} title={kind.hint}>
              <kind.icon size={11} /> {kind.label}
            </span>
            {via && (
              <span className="plan-kind plan-via" title={via.hint}>
                <via.icon size={11} /> {via.label}
              </span>
            )}
            {step.verified ? (
              <span className="plan-verified" title="A Lean verifier accepted this proof: it is machine-checked.">
                <ShieldCheck size={11} /> Verified by Lean
              </span>
            ) : (
              <span className="muted">{status.label}</span>
            )}
          </div>
          <div className="muted small">{via?.hint ?? kind.hint}</div>
          {step.why && (
            <div>
              <div className="plan-detail-label">Why</div>
              <div className="plan-step-why">{step.why}</div>
            </div>
          )}
          {step.result && (
            <div>
              <div className="plan-detail-label">What came of it</div>
              <div className="plan-step-result">{step.result}</div>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
