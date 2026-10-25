import { BookOpen, ChevronDown, FolderOpen, Play, Square, Sparkles, CircleCheck, CircleAlert, Cpu } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, errorText, theoremName, type Health, type ProveEvent } from "../api";
import { CodeEditor } from "../components/CodeEditor";
import { SolvedCard, Timeline } from "../components/RunView";
import { Button, Spinner } from "../components/ui";
import { EXAMPLES } from "../examples";

type Attempt = Extract<ProveEvent, { type: "attempt" }>;
type Solved = Extract<ProveEvent, { type: "solved" }>;

type Props = {
  problem: string;
  setProblem: (p: string) => void;
  health: Health | null;
  maxAttempts: number;
  onGoSetup: () => void;
  onRunFinished: () => void;
};

export function ProvePage({ problem, setProblem, health, maxAttempts, onGoSetup, onRunFinished }: Props) {
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [solved, setSolved] = useState<Solved | null>(null);
  const [failure, setFailure] = useState("");
  const [examplesOpen, setExamplesOpen] = useState(false);
  const [started, setStarted] = useState(0);
  const [, tick] = useState(0);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(
    () =>
      api.onProveEvent((e) => {
        if (e.type === "status") setStatus(e.message);
        if (e.type === "attempt") setAttempts((a) => [...a, e]);
        if (e.type === "solved") setSolved(e);
        if (e.type === "failed") setFailure(e.message);
      }),
    [],
  );

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [running]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (menu.current && !menu.current.contains(e.target as Node)) setExamplesOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const ready = !!health && !!health.lake && health.hasMathlib && health.keySource !== "none" && !!health.model;

  const run = async () => {
    setAttempts([]);
    setSolved(null);
    setFailure("");
    setStatus("Starting…");
    setStarted(Date.now());
    setRunning(true);
    try {
      await api.startProve(problem);
    } catch (e) {
      setFailure(errorText(e));
    } finally {
      setRunning(false);
      onRunFinished();
    }
  };

  const elapsed = running ? Math.round((Date.now() - started) / 1000) : 0;
  const shortModel = health?.model.split("/").pop() ?? "";

  return (
    <div className="prove">
      <div className="toolbar">
        <div className="toolbar-title">
          <span className="crumb">Problem</span>
          <span className="theorem">{theoremName(problem)}</span>
        </div>
        <div className="toolbar-actions">
          <div className="menu" ref={menu}>
            <Button icon={BookOpen} onClick={() => setExamplesOpen(!examplesOpen)}>
              Examples <ChevronDown size={14} />
            </Button>
            {examplesOpen && (
              <div className="menu-list">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex.title}
                    onClick={() => {
                      setProblem(ex.source);
                      setExamplesOpen(false);
                    }}
                  >
                    <span>{ex.title}</span>
                    <span className={`level level-${ex.level.toLowerCase()}`}>{ex.level}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <Button
            icon={FolderOpen}
            onClick={async () => {
              const text = await api.openLean();
              if (text !== null) setProblem(text);
            }}
          >
            Open
          </Button>
          {running ? (
            <Button variant="danger" icon={Square} onClick={() => void api.stopProve()}>
              Stop
            </Button>
          ) : (
            <Button variant="primary" icon={Play} disabled={!ready} onClick={() => void run()} title={ready ? "" : "Finish setup first"}>
              Prove
            </Button>
          )}
        </div>
      </div>

      <div className="split">
        <section className="pane editor-pane">
          <div className="pane-head">
            <span>Frozen statement</span>
            <span className="muted small">Type \to, \forall, \R … for symbols</span>
          </div>
          <div className="editor-wrap">
            <CodeEditor value={problem} onChange={setProblem} />
          </div>
          <div className="pane-foot">
            The theorem must be proved by <code>sorry</code>. A proof only counts against this exact statement.
          </div>
        </section>

        <section className="pane run-pane">
          <div className="pane-head">
            <span>Run</span>
            {shortModel && (
              <span className="model-chip" title={health?.model}>
                <Cpu size={13} /> {shortModel}
              </span>
            )}
          </div>
          <div className="run-scroll">
            {!ready && <SetupNudge health={health} onGoSetup={onGoSetup} />}

            {ready && !running && attempts.length === 0 && !solved && !failure && <HowItWorks />}

            {(running || attempts.length > 0) && (
              <div className="progress">
                <div className="progress-head">
                  {running ? <Spinner /> : solved ? <CircleCheck size={16} className="ok" /> : <CircleAlert size={16} className="bad" />}
                  <span className="progress-status">{running ? status : solved ? "Solved" : "Finished without a proof"}</span>
                  {running && <span className="muted small">{elapsed}s</span>}
                </div>
                <div className="pips">
                  {Array.from({ length: maxAttempts }, (_, i) => {
                    const a = attempts[i];
                    const cls = a ? `pip pip-${a.outcome.replace(" ", "-")}` : running && i === attempts.length ? "pip pip-active" : "pip";
                    return <span key={i} className={cls} title={a ? `Attempt ${a.n}: ${a.outcome}` : undefined} />;
                  })}
                </div>
              </div>
            )}

            {failure && !running && <div className="notice notice-bad">{failure}</div>}
            {solved && <SolvedCard solved={solved} problem={problem} />}
            {attempts.length > 0 && <Timeline attempts={attempts} />}
          </div>
        </section>
      </div>
    </div>
  );
}

function SetupNudge({ health, onGoSetup }: { health: Health | null; onGoSetup: () => void }) {
  const items = [
    { ok: !!health?.lake && !!health?.hasMathlib, label: "Lean and Mathlib installed" },
    { ok: health?.keySource !== "none", label: "Fireworks API key added" },
    { ok: !!health?.model, label: "Model chosen" },
  ];
  return (
    <div className="nudge">
      <Sparkles size={20} className="accent" />
      <h3>Finish setup to start proving</h3>
      <ul>
        {items.map((i) => (
          <li key={i.label} className={i.ok ? "ok" : ""}>
            {i.ok ? <CircleCheck size={15} /> : <span className="ring" />} {i.label}
          </li>
        ))}
      </ul>
      <Button variant="primary" onClick={onGoSetup}>
        Open setup
      </Button>
    </div>
  );
}

function HowItWorks() {
  const steps = [
    ["The model proposes", "Your Fireworks model writes a complete Lean proof of the frozen statement."],
    ["Lean checks", "Lean's errors and open goals go back to the model, which revises the proof."],
    ["The verifier decides", "A proof counts only if the statement is untouched, no axiom or sorry is used, and Lean accepts it."],
  ];
  return (
    <div className="how">
      <h3>Models propose. Lean decides.</h3>
      <ol>
        {steps.map(([t, d], i) => (
          <li key={t}>
            <span className="how-n">{i + 1}</span>
            <div>
              <div className="how-t">{t}</div>
              <div className="muted">{d}</div>
            </div>
          </li>
        ))}
      </ol>
      <p className="muted small">Pick a problem from Examples or write your own, then press Prove.</p>
    </div>
  );
}
