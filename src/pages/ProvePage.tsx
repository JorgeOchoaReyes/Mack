import { BookOpen, ChevronDown, FileCode, FolderOpen, GitBranch, MessagesSquare, RefreshCw, Save, Play, Square, Sparkles, CircleCheck, CircleAlert, Cpu, Repeat, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, errorText, theoremName, type Health, type Project, type RunEvent, type Settings } from "../api";
import type { LeanFile, ProjectFilesState } from "../project";
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

/** Open a project file, or put a statement in the editor unattached to any file. */
export type ProveRequest = ({ path: string } | { text: string }) & { n: number };

type Props = {
  problem: string;
  setProblem: (p: string) => void;
  /** The active project, whose .lean files the files pane lists. */
  project: Project | null;
  files: ProjectFilesState;
  /** A project file or statement another screen asked to open here. */
  openRequest: ProveRequest | null;
  /** Hand a message to the assistant, opening its panel beside the editor. */
  onAskChat: (text: string) => void;
  /** Whether the assistant's panel is open beside Prove, and its toggle. */
  assistantOpen: boolean;
  onToggleAssistant: () => void;
  /** What the assistant is told is on this screen, so it can offer help with it. */
  onContext: (c: ProveContext) => void;
  health: Health | null;
  settings: Settings;
  saveSettings: (s: Partial<Settings>) => Promise<void>;
  onGoSetup: () => void;
  onHealthChange: () => void;
  onRunFinished: () => void;
};

/** What Prove shows: the open project file (when saved as shown), the statement, and how the last run went. */
export type ProveContext = { path: string | null; statement: string; lastRun: "verified" | "failed" | null };

export function ProvePage({ problem, setProblem, project, files, openRequest, onAskChat, assistantOpen, onToggleAssistant, onContext, health, settings, saveSettings, onGoSetup, onHealthChange, onRunFinished }: Props) {
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
  /** The project file in the editor, and its text as last read or saved: the editor differs from it when edited. */
  const [openFile, setOpenFile] = useState<{ path: string; text: string; mtime: number } | null>(null);
  const [onDisk, setOnDisk] = useState<string | null>(null);
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

  const projectId = project?.id ?? "";
  const dirty = !!openFile && problem !== openFile.text;

  const loadFile = async (path: string) => {
    if (!projectId) return;
    try {
      const text = await api.readProjectLean(projectId, path);
      setProblem(text);
      setOpenFile({ path, text, mtime: files.files.find((f) => f.path === path)?.mtime ?? Date.now() });
      setOnDisk(null);
      files.markSeen(path);
    } catch (e) {
      setFailure(errorText(e));
    }
  };

  /** Save the editor to its project file, or to a new one named after the theorem. */
  const saveFile = async () => {
    if (!projectId) return;
    let path = openFile?.path;
    if (!path) {
      const base = theoremName(problem).replace(/[^A-Za-z0-9_.-]/g, "_") || "Problem";
      const taken = new Set(files.files.map((f) => f.path));
      path = `${base}.lean`;
      for (let i = 2; taken.has(path); i++) path = `${base}_${i}.lean`;
    }
    try {
      await api.writeProjectLean(projectId, path, problem);
      setOpenFile({ path, text: problem, mtime: Date.now() });
      setOnDisk(null);
      files.markSeen(path);
    } catch (e) {
      setFailure(errorText(e));
    }
  };

  // Another project's files are not this editor's.
  useEffect(() => {
    setOpenFile(null);
    setOnDisk(null);
  }, [projectId]);

  useEffect(() => {
    if (!openRequest) return;
    if ("path" in openRequest) return void (running || loadFile(openRequest.path));
    setProblem(openRequest.text);
    setOpenFile(null);
    setOnDisk(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest?.n]);

  // The open file changed on disk (the chat's agent revised it, say): follow it unless the editor holds unsaved edits.
  const diskFile = openFile && files.files.find((f) => f.path === openFile.path);
  useEffect(() => {
    if (!openFile || !diskFile || diskFile.mtime <= openFile.mtime || !projectId) return;
    void api
      .readProjectLean(projectId, openFile.path)
      .then((text) => {
        if (text === openFile.text) return setOpenFile({ ...openFile, mtime: diskFile.mtime });
        if (dirty || running) return setOnDisk(text);
        setProblem(text);
        setOpenFile({ path: openFile.path, text, mtime: diskFile.mtime });
        files.markSeen(openFile.path);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diskFile?.mtime]);

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
  const lastRun: ProveContext["lastRun"] = solved ? "verified" : !running && (attempts.length > 0 || nodes.length > 0 || swarm.length > 0 || !!failure) ? "failed" : null;
  const contextPath = openFile && !dirty ? openFile.path : null;
  useEffect(() => onContext({ path: contextPath, statement: problem, lastRun }), [contextPath, problem, lastRun]); // eslint-disable-line react-hooks/exhaustive-deps

  const ready = !!health && (leanReady || !needsLean) && health.keySource !== "none" && !!health.model;
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
      await api.startProve(problem, { projectId: projectId || undefined, file: openFile && !dirty ? openFile.path : undefined });
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
          <span className="crumb">{project ? project.name : "Problem"}</span>
          {openFile && (
            <span className="crumb" title={openFile.path}>
              / {openFile.path}
              {dirty ? " •" : ""}
            </span>
          )}
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
                      setOpenFile(null);
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
              if (text !== null) {
                setProblem(text);
                setOpenFile(null);
              }
            }}
          >
            Open file
          </Button>
          {openFile ? (
            <Button icon={Save} disabled={!dirty || running} onClick={() => void saveFile()} title={`Save the editor to ${openFile.path} in the project`}>
              Save
            </Button>
          ) : (
            project && (
              <Button icon={Save} disabled={running} onClick={() => void saveFile()} title={`Save this statement as a new .lean file in ${project.name}`}>
                Save to project
              </Button>
            )
          )}
          {running ? (
            <Button variant="danger" icon={Square} onClick={() => void api.stopProve()}>
              Stop
            </Button>
          ) : (
            <Button variant="primary" icon={Play} disabled={!ready} onClick={() => void run()} title={ready ? "" : "Finish setup first"}>
              Prove
            </Button>
          )}
          <Button
            variant={assistantOpen ? "secondary" : "ghost"}
            className={assistantOpen ? "toggle-on" : ""}
            icon={MessagesSquare}
            onClick={onToggleAssistant}
            title={assistantOpen ? "Close the assistant" : "Open the assistant beside the editor: ask about this statement, a failed attempt, or what to try next"}
          >
            Assistant
          </Button>
        </div>
      </div>

      <div className="split with-files">
        <FilesPane project={project} files={files} current={openFile?.path ?? null} disabled={running} onPick={(p) => void loadFile(p)} />
        <section className="pane editor-pane">
          <div className="pane-head">
            <span>Frozen statement</span>
            <span className="row gap-sm">
              <span className="muted small">Type \to, \forall, \R … for symbols</span>
              {project && (
                <button
                  className="link small"
                  title="Ask the assistant beside the editor about this statement"
                  onClick={() => onAskChat(openFile ? `About \`${openFile.path}\`: ` : `About this Lean statement:\n\n\`\`\`lean\n${problem.trim()}\n\`\`\`\n\n`)}
                >
                  <MessagesSquare size={13} /> Ask the assistant
                </button>
              )}
            </span>
          </div>
          {onDisk !== null && (
            <div className="notice small disk-notice">
              {openFile?.path} changed on disk.
              <button
                className="link small"
                onClick={() => {
                  if (!openFile) return;
                  setProblem(onDisk);
                  setOpenFile({ path: openFile.path, text: onDisk, mtime: Date.now() });
                  setOnDisk(null);
                  files.markSeen(openFile.path);
                }}
              >
                Load it
              </button>
              <button className="link small" onClick={() => setOnDisk(null)}>
                Keep mine
              </button>
            </div>
          )}
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
            {!ready && <SetupNudge health={health} onGoSetup={onGoSetup} />}

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

function SetupNudge({ health, onGoSetup }: { health: Health | null; onGoSetup: () => void }) {
  const items = [
    { ok: !!health?.lake && !!health?.hasMathlib, label: "Lean and Mathlib installed" },
    { ok: health?.keySource !== "none", label: `${providerInfo(health?.provider ?? "fireworks").label} API key added` },
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

function FilesPane({ project, files, current, disabled, onPick }: { project: Project | null; files: ProjectFilesState; current: string | null; disabled: boolean; onPick: (path: string) => void }) {
  const [filter, setFilter] = useState("");
  const q = filter.trim().toLowerCase();
  const shown = q ? files.files.filter((f) => f.path.toLowerCase().includes(q)) : files.files;
  // What changed since it was last opened comes first, newest first.
  const fresh = shown.filter((f) => f.fresh).sort((a, b) => b.mtime - a.mtime);
  const rest = shown.filter((f) => !f.fresh);
  const row = (f: LeanFile) => {
    const slash = f.path.lastIndexOf("/");
    return (
      <button key={f.path} className={`file ${f.path === current ? "active" : ""} ${f.fresh ? "fresh" : ""}`} disabled={disabled} title={f.fresh ? `${f.path}: new or changed since you last opened it` : f.path} onClick={() => onPick(f.path)}>
        <FileCode size={13} />
        <span className="file-name">{f.path.slice(slash + 1)}</span>
        {slash > 0 && <span className="file-dir">{f.path.slice(0, slash)}</span>}
      </button>
    );
  };
  return (
    <section className="pane files-pane">
      <div className="pane-head">
        <span title={files.folder}>{project ? project.name : "Files"}</span>
        {project && (
          <span className="files-actions">
            <button className="icon-btn" title="Rescan the project" onClick={() => void files.refresh()}>
              <RefreshCw size={13} />
            </button>
          </span>
        )}
      </div>
      {!project ? (
        <div className="muted small files-empty">Create or choose a project in the sidebar: its .lean files show here, including those the chat writes.</div>
      ) : (
        <>
          <input className="files-filter" placeholder={`Filter ${files.files.length} files`} value={filter} onChange={(e) => setFilter(e.target.value)} />
          <div className="files-list">
            {shown.length === 0 && (
              <div className="muted small files-empty">{files.files.length ? "No file matches." : "No .lean files yet. Ask the assistant to formalize a statement, or write one in the editor and press Save to project."}</div>
            )}
            {fresh.length > 0 && (
              <div className="files-group">
                <span>New or changed</span>
                <button className="link small" onClick={() => files.markSeen()}>
                  Mark seen
                </button>
              </div>
            )}
            {fresh.map(row)}
            {fresh.length > 0 && rest.length > 0 && <div className="files-group">All files</div>}
            {rest.map(row)}
          </div>
        </>
      )}
    </section>
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
