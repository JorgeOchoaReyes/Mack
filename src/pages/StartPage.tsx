// The path for someone new to Mack: set up, make a project, see one proof
// verified, then formalize and prove a statement of their own. Each step
// checks itself off from what the app already knows.

import { ArrowRight, Check, FlaskConical, FolderOpen, FolderPlus, GitBranch, History, MessagesSquare, Rows3, Users, Wrench } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { api, type Project, type RunSummary } from "../api";
import type { ProjectFilesState } from "../project";
import { Button } from "../components/ui";

type Go = "setup" | "prove" | "chat" | "runs" | "history" | "guide";

type Props = {
  setupReady: boolean;
  /** What setup still lacks, in words; empty when ready. */
  setupMissing: string[];
  project: Project | null;
  files: ProjectFilesState;
  /** Bumped when a run finishes, so the steps re-read the run history. */
  refreshKey: number;
  /** Each resolves to an error message, or "" when it worked. */
  onCreateProject: (name: string) => Promise<string>;
  onOpenProject: () => Promise<string>;
  onTryWarmup: () => void;
  onAskChat: (text: string) => void;
  onGo: (page: Go) => void;
};

/** A project's name as words: `odd-perfect` reads as "odd perfect". */
const topicOf = (p: Project) => p.name.replace(/[-_]+/g, " ").trim();

export function firstQuestion(p: Project): string {
  return `I'm new to Lean and to Mack. Suggest three small, true statements about ${topicOf(p)} that I could formalize and prove today, easiest first, and say in one line why each is a good first step. When I pick one, write it as a Lean 4 statement in its own .lean file and check that it compiles.`;
}

export function StartPage({ setupReady, setupMissing, project, files, refreshKey, onCreateProject, onOpenProject, onTryWarmup, onAskChat, onGo }: Props) {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    void api
      .listRuns()
      .then(setRuns)
      .catch(() => setRuns([]));
  }, [refreshKey]);

  const warmedUp = runs.some((r) => r.outcome === "solved");
  const hasStatement = files.files.length > 0;
  const provedOwn = !!project && runs.some((r) => r.outcome === "solved" && r.projectId === project.id && !!r.file);
  const done = [setupReady, !!project, warmedUp, hasStatement, provedOwn];
  const current = done.indexOf(false);

  return (
    <div className="page start">
      <div className="page-head">
        <h1>Start here</h1>
        <p className="muted">
          Mack helps you do math research with an AI model, and trusts a result only once Lean, a proof checker, accepts it. These steps take you from a
          fresh install to a statement of your own, proved and checked.
        </p>
      </div>

      <ol className="steps">
        <Step n={1} done={done[0]} current={current === 0} title="Set up Mack" why="Lean checks proofs on this computer; the model writes them, billed to your own provider account.">
          {!setupReady && setupMissing.length > 0 && <p className="muted small">Still needed: {setupMissing.join(", ")}.</p>}
          <Button size="sm" variant={current === 0 ? "primary" : "secondary"} icon={Wrench} onClick={() => onGo("setup")}>
            {setupReady ? "Review setup" : "Open setup"}
          </Button>
        </Step>

        <Step
          n={2}
          done={done[1]}
          current={current === 1}
          title={project ? `Work in a project: ${project.name}` : "Create a project"}
          why="A project is a folder for one research question. Chat, Prove, Runs and History all work in the project chosen in the sidebar."
        >
          {project ? (
            <p className="muted small">
              Switch or add projects any time with the selector at the top of the sidebar. <code className="path">{project.folder}</code>
            </p>
          ) : (
            <>
              <form
                className="row gap-sm"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const err = await onCreateProject(name);
                  setError(err);
                  if (!err) setName("");
                }}
              >
                <input className="input" placeholder="Name it after your question, e.g. odd-perfect" value={name} onChange={(e) => setName(e.target.value)} />
                <Button size="sm" variant={current === 1 ? "primary" : "secondary"} icon={FolderPlus} type="submit" disabled={!name.trim()}>
                  Create project
                </Button>
                <Button size="sm" variant="ghost" icon={FolderOpen} type="button" onClick={async () => setError(await onOpenProject())}>
                  Use a folder
                </Button>
              </form>
              {error && <div className="notice notice-bad small">{error}</div>}
            </>
          )}
        </Step>

        <Step n={3} done={done[2]} current={current === 2} title="Watch a warm-up proof" why="Prove a statement that is easy for the model, to see the loop once: the model writes a proof, Lean checks it, and the errors go back until it is verified.">
          <Button size="sm" variant={current === 2 ? "primary" : "secondary"} icon={FlaskConical} disabled={!setupReady} onClick={onTryWarmup}>
            Try the warm-up on Prove
          </Button>
        </Step>

        <Step
          n={4}
          done={done[3]}
          current={current === 3}
          title="Turn your question into a Lean statement"
          why="Ask the assistant in Chat for small, true statements about your topic and have it write one as a .lean file. It appears on Prove, marked as new."
        >
          <div className="row gap-sm">
            <Button size="sm" variant={current === 3 ? "primary" : "secondary"} icon={MessagesSquare} disabled={!project || !setupReady} onClick={() => project && onAskChat(firstQuestion(project))}>
              Ask Chat for a first statement
            </Button>
            {hasStatement && (
              <Button size="sm" variant="ghost" icon={ArrowRight} onClick={() => onGo("prove")}>
                {files.files.length} .lean file{files.files.length === 1 ? "" : "s"} on Prove
              </Button>
            )}
          </div>
          <p className="muted small">Or write one yourself on Prove and press Save to project.</p>
        </Step>

        <Step
          n={5}
          done={done[4]}
          current={current === 4}
          title="Prove it"
          why="Open the file on Prove and press Prove. If it fails, open the Assistant beside the editor and ask why: often the statement needs a hypothesis, or should be split into smaller lemmas."
        >
          <Button size="sm" variant={current === 4 ? "primary" : "secondary"} icon={FlaskConical} disabled={!hasStatement} onClick={() => onGo("prove")}>
            Open Prove
          </Button>
        </Step>
      </ol>

      <h2 className="start-h">When one attempt is not enough</h2>
      <div className="start-grid">
        <Next icon={GitBranch} title="Search tree" where="Prove → Search tree" onClick={() => onGo("prove")}>
          One hard statement. Several workers extend the most promising partial proofs instead of starting over.
        </Next>
        <Next icon={Rows3} title="Runs" where="Runs" onClick={() => onGo("runs")}>
          Many statements at once, each with its own search, that you can watch, stop and resume.
        </Next>
        <Next icon={Users} title="Ultramath" where="Chat or Prove → Ultramath" onClick={() => onGo("chat")}>
          An open-ended question. Several agents take different directions and share lemmas, counterexamples and dead ends.
        </Next>
        <Next icon={History} title="History" where="History" onClick={() => onGo("history")}>
          Every attempt and what Lean said about it. Failed attempts show where a proof gets stuck.
        </Next>
      </div>

      <h2 className="start-h">Tips</h2>
      <ul className="start-tips">
        <li>
          <b>Start smaller than you think.</b> A lemma the model can prove moves you forward; a big theorem it cannot does not. Build up in steps.
        </li>
        <li>
          <b>Failed attempts are normal.</b> <i>Lean errors</i> and <i>Unfinished</i> go back to the model, which revises. Only <i>Verified</i> means proved.
        </li>
        <li>
          <b>The statement is frozen.</b> A proof must prove it exactly as written. If it is false or missing a hypothesis, fix the statement: no proof will
          come.
        </li>
        <li>
          <b>Watch the spending.</b> Each attempt is a model call billed to you. The total is at the bottom of the sidebar, and Settings sets the limits.
        </li>
      </ul>
      <div className="row gap-sm">
        <Button size="sm" variant="ghost" icon={ArrowRight} onClick={() => onGo("guide")}>
          How checking works, in the Guide
        </Button>
      </div>
    </div>
  );
}

function Step({ n, done, current, title, why, children }: { n: number; done: boolean; current: boolean; title: string; why: string; children: ReactNode }) {
  return (
    <li className={`step ${done ? "done" : ""} ${current ? "current" : ""}`}>
      <span className="step-n">{done ? <Check size={14} strokeWidth={3} /> : n}</span>
      <div className="step-body">
        <h3>{title}</h3>
        <p>{why}</p>
        {children}
      </div>
    </li>
  );
}

function Next({ icon: Icon, title, where, onClick, children }: { icon: typeof Users; title: string; where: string; onClick: () => void; children: ReactNode }) {
  return (
    <button className="start-next" onClick={onClick}>
      <span className="row gap-sm">
        <Icon size={15} />
        <b>{title}</b>
        <span className="muted small">{where}</span>
      </span>
      <span>{children}</span>
    </button>
  );
}
