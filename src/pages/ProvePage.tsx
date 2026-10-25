import { BookOpen, ChevronDown, FolderOpen, GitBranch, Play, Square, Sparkles, CircleCheck, CircleAlert, Cpu, Repeat, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, errorText, theoremName, type Health, type RunEvent, type Settings } from "../api";
import { providerInfo } from "../../core/model/providers";
import { formatUsd } from "../../core/model/metered";
import { CodeEditor } from "../components/CodeEditor";
import { SolvedCard, Timeline } from "../components/RunView";
import { TreeSummary, TreeView, type NodeEvent } from "../components/TreeView";
import { AcceptedCard, UltramathView } from "../components/UltramathView";
import { problemKind } from "../../core/lean/rules";
import { Button, Spinner } from "../components/ui";
import { EXAMPLES } from "../examples";

type Attempt = Extract<RunEvent, { type: "attempt" }>;
type Solved = Extract<RunEvent, { type: "solved" }>;

type Props = {
  problem: string;
  setProblem: (p: string) => void;
  health: Health | null;
  settings: Settings;
  saveSettings: (s: Partial<Settings>) => Promise<void>;
  onGoSetup: () => void;
  onHealthChange: () => void;
  onRunFinished: () => void;
};

export function ProvePage({ problem, setProblem, health, settings, saveSettings, onGoSetup, onHealthChange, onRunFinished }: Props) {
  const maxAttempts = settings.maxAttempts;
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [nodes, setNodes] = useState<NodeEvent[]>([]);
  const [swarm, setSwarm] = useState<RunEvent[]>([]);
  const [spend, setSpend] = useState<{ usd: number; limit: number; estimated: boolean } | null>(null);
  const [round, setRound] = useState(0);
  const [runMode, setRunMode] = useState(settings.mode);
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
        if (e.type === "spend") setSpend(e);
        if (["start", "direction", "refused", "post", "turn", "report", "accepted"].includes(e.type)) setSwarm((s) => [...s, e]);
        if (e.type === "attempt") setAttempts((a) => [...a, e]);
        if (e.type === "node") setNodes((n) => [...n, e]);
        if (e.type === "round") setRound(e.round);
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

  const leanReady = !!health && !!health.lake && health.hasMathlib;
  const needsLean = settings.mode !== "ultramath" || problemKind(problem) === "lean";
  const priceMissing = !!health?.model && (settings.maxCostPerSession > 0 || settings.globalLimit > 0) && !settings.prices[health.model];
  const ready = !!health && (leanReady || !needsLean) && health.keySource !== "none" && !!health.model && !priceMissing;
  const accepted = swarm.find((e): e is Extract<RunEvent, { type: "accepted" }> => e.type === "accepted");

  const run = async () => {
    setAttempts([]);
    setNodes([]);
    setSwarm([]);
    setSpend(null);
    setRound(0);
    setRunMode(settings.mode);
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
  const usableProviders = health?.providers.filter((p) => p.usable) ?? [];

  return (
    <div className="prove">
      <div className="toolbar">
        <div className="toolbar-title">
          <span className="crumb">Problem</span>
          <span className="theorem">{theoremName(problem)}</span>
        </div>
        <div className="toolbar-actions">
          <div className="mode-switch" title="Single: one agent revises one proof. Search tree: parallel workers extend the most promising partial proofs. Ultramath: several members attack the problem from different directions and share a board.">
            <button className={settings.mode === "single" ? "active" : ""} disabled={running} onClick={() => void saveSettings({ mode: "single" })}>
              <Repeat size={13} /> Single
            </button>
            <button className={settings.mode === "search" ? "active" : ""} disabled={running} onClick={() => void saveSettings({ mode: "search" })}>
              <GitBranch size={13} /> Search tree
            </button>
            <button className={settings.mode === "ultramath" ? "active" : ""} disabled={running} onClick={() => void saveSettings({ mode: "ultramath" })}>
              <Users size={13} /> Ultramath
            </button>
          </div>
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
            {usableProviders.length > 0 && (
              <span className="model-chip" title={health?.model}>
                <Cpu size={13} />
                <select
                  className="model-select"
                  value={settings.provider}
                  disabled={running}
                  onChange={async (e) => {
                    await saveSettings({ provider: e.target.value as Settings["provider"] });
                    onHealthChange();
                  }}
                >
                  {!usableProviders.some((p) => p.id === settings.provider) && <option value={settings.provider}>{providerInfo(settings.provider).label}: not set up</option>}
                  {usableProviders.map((p) => (
                    <option key={p.id} value={p.id}>
                      {providerInfo(p.id).label} · {p.model.split("/").pop()}
                    </option>
                  ))}
                </select>
              </span>
            )}
          </div>
          <div className="run-scroll">
            {!ready && <SetupNudge health={health} priceMissing={priceMissing} onGoSetup={onGoSetup} />}

            {ready && !running && attempts.length === 0 && nodes.length === 0 && swarm.length === 0 && !solved && !failure && <HowItWorks mode={settings.mode} />}

            {runMode === "ultramath" && (running || swarm.length > 0) && (
              <div className="progress">
                <div className="progress-head">
                  {running ? <Spinner /> : solved || accepted ? <CircleCheck size={16} className="ok" /> : <CircleAlert size={16} className="bad" />}
                  <span className="progress-status">{running ? status : solved || accepted ? "Solved" : "Finished without an accepted solution"}</span>
                  {running && <span className="muted small">{elapsed}s</span>}
                  {spend && <SpendChip spend={spend} />}
                </div>
              </div>
            )}

            {runMode === "search" && (running || nodes.length > 0) && (
              <div className="progress">
                <div className="progress-head">
                  {running ? <Spinner /> : solved ? <CircleCheck size={16} className="ok" /> : <CircleAlert size={16} className="bad" />}
                  <span className="progress-status">{running ? status : solved ? "Solved" : "Finished without a proof"}</span>
                  {running && <span className="muted small">{elapsed}s</span>}
                  {spend && <SpendChip spend={spend} />}
                </div>
                <TreeSummary nodes={nodes} rounds={round} k1={settings.search.k1} />
              </div>
            )}

            {runMode === "single" && (running || attempts.length > 0) && (
              <div className="progress">
                <div className="progress-head">
                  {running ? <Spinner /> : solved ? <CircleCheck size={16} className="ok" /> : <CircleAlert size={16} className="bad" />}
                  <span className="progress-status">{running ? status : solved ? "Solved" : "Finished without a proof"}</span>
                  {running && <span className="muted small">{elapsed}s</span>}
                  {spend && <SpendChip spend={spend} />}
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
            {solved && (
              <SolvedCard
                solved={solved}
                problem={problem}
                where={runMode === "search" ? `Node ${solved.n} of the search tree` : runMode === "ultramath" ? `Member ${solved.n}` : undefined}
              />
            )}
            {accepted && <AcceptedCard accepted={accepted} />}
            {attempts.length > 0 && <Timeline attempts={attempts} />}
            {nodes.length > 0 && <TreeView nodes={nodes} />}
            {swarm.length > 0 && <UltramathView events={swarm} />}
          </div>
        </section>
      </div>
    </div>
  );
}

function SetupNudge({ health, priceMissing, onGoSetup }: { health: Health | null; priceMissing: boolean; onGoSetup: () => void }) {
  const items = [
    { ok: !!health?.lake && !!health?.hasMathlib, label: "Lean and Mathlib installed" },
    { ok: health?.keySource !== "none", label: `${providerInfo(health?.provider ?? "fireworks").label} API key added` },
    { ok: !!health?.model, label: "Model chosen" },
    { ok: !priceMissing, label: "Model price set (the spending limits need it)" },
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

function HowItWorks({ mode }: { mode: Settings["mode"] }) {
  const steps = mode === "ultramath" ? [
    ["Members pick directions", "Each member registers a line of attack; one that repeats a direction already on the board is refused."],
    ["They share a board", "Lemmas, partial results, counterexamples and dead ends go on a shared board; helper lemmas Lean accepts are marked as checked."],
    ["A judge decides", "With a Lean statement the strict verifier judges submissions; for a problem in plain words, a coordinating agent referees them."],
  ] : mode === "search" ? [
    ["Workers branch out", "Several workers start from the statement, each writing a proof that may leave `sorry` gaps for later."],
    ["Lean scores every node", "Each file is checked; partial proofs score higher than broken ones, and a complete proof goes to the verifier."],
    ["The best branches grow", "Later rounds continue the most promising nodes instead of starting over, until the verifier accepts one."],
  ] : [
    ["The model proposes", "Your model writes a complete Lean proof of the frozen statement."],
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

function SpendChip({ spend }: { spend: { usd: number; limit: number; estimated: boolean } }) {
  return (
    <span className={`spend-chip ${spend.limit > 0 && spend.usd >= spend.limit * 0.8 ? "warn" : ""}`} title={spend.estimated ? "Some calls reported no usage; their tokens were estimated." : "From the token counts your provider reported."}>
      {spend.estimated ? "≈" : ""}
      {formatUsd(spend.usd)}
      {spend.limit > 0 ? ` of ${formatUsd(spend.limit)}` : ""}
    </span>
  );
}
