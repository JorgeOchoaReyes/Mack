import { UltramathView } from "../components/UltramathView";
import type { Proved, RunEvent, SwarmRecord } from "../api";
import { AlarmClock, Brain, Check, ChevronRight, Rocket, Users, Download, ExternalLink, GitCompare, GitPullRequest, KeyRound, FolderPlus, ListChecks, MessageSquarePlus, ShieldAlert, ShieldCheck, Terminal, Trash2, Wrench, X } from "lucide-react";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  errorText,
  type ChangedFile,
  type ChatSession,
  type Finding,
  type ChatWire,
  type Health,
  type PendingApproval,
  type Project,
  type PullRequest,
  type ReasoningEffort,
  type SessionSummary,
  type Settings,
  type StoredMessage,
  type ToolOutcome,
  type ToolSpec,
} from "../api";
import { CodeEditor } from "../components/CodeEditor";
import { Activity } from "../components/chat/Activity";
import { Composer, type SlashCommand } from "../components/chat/Composer";
import { Markdown, splitChoices, visible } from "../components/chat/Markdown";
import { Logo } from "../components/Logo";
import { PlanView } from "../components/PlanView";
import { ShowMe } from "../components/ShowMe";
import { Resizer, usePanelWidth } from "../components/Resizer";
import { formatUsd } from "../../core/model/metered";
import { Badge, Button, Spinner, timeAgo, Toggle } from "../components/ui";

type Props = {
  /** The active project, chosen in the sidebar for every screen. */
  project: Project | null;
  hasProjects: boolean;
  /** Resolves to an error message, or "" when the project was created. */
  onCreateProject: (name: string) => Promise<string>;
  /** A message another screen handed over, put in the composer. */
  incomingDraft: { text: string; n: number } | null;
  /** Open a project .lean file on the Prove screen. */
  onOpenInProve: (path: string) => void;
  /** Open one proof run on the Proof attempts screen. */
  onOpenRun?: (id: string) => void;
  health: Health | null;
  settings: Settings;
  saveSettings: (s: Partial<Settings>) => Promise<void>;
  onGoSetup: () => void;
  /** The problem as the person first described it: sent as the first message of a new problem. */
  firstMessage?: string;
  onFirstMessageUsed?: () => void;
};

const PLAN_KEY = "mack.planOpen";

function planOpenAtStart(): boolean {
  try {
    return localStorage.getItem(PLAN_KEY) !== "0";
  } catch {
    return true;
  }
}

const EFFORTS: ReasoningEffort[] = ["off", "on", "low", "medium", "high", "xhigh"];

export function ChatPage({ project, hasProjects, onCreateProject, incomingDraft, onOpenInProve, onOpenRun, health, settings, saveSettings, onGoSetup, firstMessage, onFirstMessageUsed }: Props) {
  const projectId = project?.id ?? "";
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [session, setSession] = useState<ChatSession | null>(null);
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [panel, setPanel] = useState<"none" | "memory" | "tools" | "review" | "swarms">("none");
  const [secretMarks, setSecretMarks] = useState<Record<number, Finding[]>>({});
  const [planOpen, setPlanOpenState] = useState(planOpenAtStart);
  /** Auto mode for the chat the next message starts, before it exists. */
  const [newChatAuto, setNewChatAuto] = useState(false);
  /** Why auto mode last paused, shown until the person acts. */
  const [autoNote, setAutoNote] = useState("");
  const [sideWidth, setSideWidth] = usePanelWidth("mack.chatSideWidth", 240, 160, 420);
  const [planWidth, setPlanWidth] = usePanelWidth("mack.planWidth", 320, 220, 640);
  // The saved widths give way when the window is narrow, so the conversation always keeps room.
  const chatBox = useRef<HTMLDivElement>(null);
  const [boxWidth, setBoxWidth] = useState(0);
  useEffect(() => {
    const el = chatBox.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBoxWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const MAIN_MIN = 380;
  let sideShown = sideWidth;
  let planShown = planOpen ? planWidth : 0;
  if (boxWidth > 0) {
    let over = sideShown + planShown + MAIN_MIN - boxWidth;
    if (over > 0 && planOpen) {
      const cut = Math.min(over, planShown - 220);
      planShown -= Math.max(0, cut);
      over -= Math.max(0, cut);
    }
    if (over > 0) sideShown = Math.max(160, sideShown - over);
  }
  const setPlanOpen = (v: boolean) => {
    setPlanOpenState(v);
    try {
      localStorage.setItem(PLAN_KEY, v ? "1" : "0");
    } catch {
      // Only a remembered layout.
    }
  };
  const scroller = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<ChatSession | null>(null);
  sessionRef.current = session;

  const ready = !!health && health.keySource !== "none" && !!health.model;

  const [newName, setNewName] = useState("");
  const [projectError, setProjectError] = useState("");
  const create = async (name: string) => {
    const err = await onCreateProject(name);
    setProjectError(err);
    if (!err) setNewName("");
  };

  useEffect(() => {
    if (incomingDraft) setDraft(incomingDraft.text);
  }, [incomingDraft?.n]);

  const reloadSession = useCallback(async () => {
    const cur = sessionRef.current;
    if (cur) {
      const s = await api.getSession(cur.projectId, cur.id);
      if (s) setSession({ ...s, messages: [...s.messages] });
    }
  }, []);

  useEffect(() => {
    void api.listApprovals().then(setApprovals);
  }, []);

  useEffect(() => {
    setSession(null);
    setSuggestion(null);
    if (projectId) {
      void api.listSessions(projectId).then(setSessions);
      if (settings.suggestions) void api.suggestStart().then((s) => !sessionRef.current && setSuggestion(s));
    } else setSessions([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(
    () =>
      api.onChatEvent((w: ChatWire) => {
        if ("approval" in w) return setApprovals((a) => [...a, w.approval]);
        if ("approvalDone" in w) return setApprovals((a) => a.filter((x) => x.id !== w.approvalDone));
        if ("plan" in w) return;
        const cur = sessionRef.current;
        const mine = cur?.id === w.sessionId;
        if ("autoStopped" in w) {
          if (mine) setAutoNote(w.autoStopped);
          return;
        }
        if ("suggestion" in w) {
          if (mine) setSuggestion(w.suggestion);
          return;
        }
        if ("changed" in w) {
          if (mine) void reloadSession();
          if (cur) void api.listSessions(cur.projectId).then(setSessions);
          return;
        }
        const e = w.event;
        if (!mine) {
          if (e.type === "done" && cur) void api.listSessions(cur.projectId).then(setSessions);
          return;
        }
        if (e.type === "delta") return setStreaming((t) => t + e.text);
        if (e.type === "spend") return setSession((cur2) => (cur2 && cur2.id === w.sessionId ? { ...cur2, costUsd: e.usd } : cur2));
        if (e.type === "status") return setStatus(e.message);
        if (e.type === "error") setError(e.message);
        if (e.type === "assistant" || e.type === "tool") {
          setStreaming("");
          setBusy(true);
        }
        if (e.type === "done") {
          setBusy(false);
          setStreaming("");
          setStatus("");
          if (cur) void api.listSessions(cur.projectId).then(setSessions);
        }
        void reloadSession();
      }),
    [reloadSession],
  );

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [session?.messages.length, approvals.length, streaming]);

  useEffect(() => {
    if (session && !busy) void api.sessionFindings(session.projectId, session.id).then(setSecretMarks);
    else if (!session) setSecretMarks({});
  }, [session?.id, session?.messages.length, busy]);

  /** Leaving a session lets memory read it; failures only cost a memory, never the chat. */
  const rememberInBackground = () => {
    if (sessionRef.current && sessionRef.current.messages.length > 1) void api.updateMemory(projectId).catch(() => {});
  };

  const openSession = async (id: string | null) => {
    rememberInBackground();
    setError("");
    setSuggestion(null);
    setStreaming("");
    const s = id ? await api.getSession(projectId, id) : null;
    setSession(s);
    setBusy(!!id && !!sessions.find((x) => x.id === id)?.busy);
  };

  const sendMessage = async (sendNow = false, override?: string) => {
    const text = (override ?? draft).trim();
    if (!text && !files.length) return;
    setDraft("");
    setFiles([]);
    setError("");
    setSuggestion(null);
    if (!busy) {
      setBusy(true);
      setStatus("Thinking…");
    }
    try {
      const id = await api.sendChat(projectId, session?.id ?? null, text, { sendNow, attachments: files, auto: !session && newChatAuto });
      setAutoNote("");
      const s = await api.getSession(projectId, id);
      setSession(s);
      setSessions(await api.listSessions(projectId));
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  // A new problem starts with the person's own description of it.
  // The message is cleared once used, so each new problem's opening is sent exactly once.
  useEffect(() => {
    if (!firstMessage || !projectId) return;
    onFirstMessageUsed?.();
    const opening = `${firstMessage}

I am new to this. Explain the problem in plain words, tell me honestly how hard it is and what is already known, then make a plan.`;
    if (ready) void sendMessage(false, opening);
    else setDraft(opening);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstMessage, projectId, ready]);

  const [skills, setSkills] = useState<{ name: string; description: string }[]>([]);
  useEffect(() => {
    if (projectId) void api.listSkills(projectId).then(setSkills).catch(() => setSkills([]));
  }, [projectId, session?.messages.length]);

  // What Lean has proved in this problem, for `/showme`.
  const [proved, setProved] = useState<Proved[]>([]);
  const [showMe, setShowMeState] = useState<{ file: string; id?: string } | null>(null);
  const setShowMe = (file: string, id?: string) => setShowMeState({ file, id });
  // Bumped when a walkthrough closes, so the plan's list of saved ones catches any new one.
  const [savedKey, setSavedKey] = useState(0);
  useEffect(() => {
    if (!projectId) return;
    let live = true;
    void api.getPlan(projectId).then((p) => live && setProved(p.proved ?? [])).catch(() => live && setProved([]));
    const off = api.onChatEvent((w: ChatWire) => {
      if ("plan" in w && w.projectId === projectId) setProved(w.plan.proved ?? []);
    });
    return () => {
      live = false;
      off();
    };
  }, [projectId]);

  const commands: SlashCommand[] = [
    ...(proved.length > 1 ? [{ name: "/showme all", hint: "Walk through the whole proof: every proved result, connected, step by step", group: "Start" as const, run: () => setShowMe("*") }] : []),
    ...(proved.length
      ? [...proved].reverse().map((x): SlashCommand => ({ name: `/showme ${x.theorem ?? x.file}`, hint: `Walk through the whole proof of ${x.file.split("/").pop()}, step by step`, group: "Start", run: () => setShowMe(x.file) }))
      : [{ name: "/showme", hint: "Walk through a proof step by step (nothing proved yet)", group: "Start" as const, insert: "" }]),
    { name: "/plan", hint: "Make or update the plan for this problem", group: "Start", insert: "Update the plan: " },
    { name: "/skill", hint: "List this problem's skills", group: "Skills", send: true },
    ...skills.map((k) => ({ name: `/skill ${k.name}`, hint: k.description || "Load this skill", group: "Skills" as const, send: true })),
    { name: "/skill https://", hint: "Load a published skill from its SKILL.md URL", group: "Skills", insert: "/skill https://" },
    { name: "/prove", hint: "Formalize a statement in Lean and run a proof search", group: "Start", insert: "Write the Lean 4 statement of the following, check that it compiles, then start a proof search on it: " },
    { name: "/ultramath", hint: "Put several agents on a hard problem", group: "Start", insert: "Start Ultramath with 4 members on: " },
    { name: "/research", hint: "Find and summarize the literature on a topic", group: "Start", insert: "Find the key papers on the following, save them to the project, and summarize what each proves in notes/literature.md: " },
    { name: "/remind", hint: "Have the assistant come back to something later", group: "Start", insert: "In 30 minutes, remind yourself to " },
    { name: "/new", hint: "Start a new chat", group: "Chat", run: () => void openSession(null) },
    { name: "/export", hint: "Save this chat as Markdown, secrets masked", group: "Chat", run: () => session && void api.exportSession(projectId, session.id) },
    { name: "/memory", hint: "What Mack remembers about this problem", group: "Panels", run: () => setPanel("memory") },
    { name: "/review", hint: "Uncommitted changes; open a pull request", group: "Panels", run: () => setPanel("review") },
    { name: "/tools", hint: "What the assistant can do, and approvals", group: "Panels", run: () => setPanel("tools") },
    { name: "/swarms", hint: "This chat's Ultramath swarms", group: "Panels", run: () => setPanel("swarms") },
  ];

  const sessionApprovals = approvals.filter((a) => a.sessionId === session?.id);
  const otherApprovals = approvals.filter((a) => a.sessionId !== session?.id);
  const effort = session?.effort ?? settings.chatEffort;

  return (
    <div className="chat" ref={chatBox} style={{ gridTemplateColumns: `${sideShown}px 0 minmax(0, 1fr)${planOpen ? ` 0 ${planShown}px` : ""}` }}>
      <aside className="chat-side">
        {project && (
          <div className="chat-side-head">
            <code className="path small" title="The problem folder: the assistant works on the files here">
              {project.folder}
            </code>
          </div>
        )}
        <Button icon={MessageSquarePlus} disabled={!projectId} onClick={() => void openSession(null)}>
          New chat
        </Button>
        <div className="chat-sessions">
          {sessions.map((s, idx) => (
            <Fragment key={s.id}>
            {(idx === 0 || dayGroup(sessions[idx - 1].updatedAt) !== dayGroup(s.updatedAt)) && <div className="session-group">{dayGroup(s.updatedAt)}</div>}
            <div className={`chat-session ${session?.id === s.id ? "active" : ""}`}>
              <button onClick={() => void openSession(s.id)}>
                <span className="chat-session-title">
                  {s.busy && <Spinner size={11} />} {s.title}
                </span>
                <span className="muted small">{timeAgo(s.updatedAt)}</span>
              </button>
              <button
                className="icon-btn"
                title="Delete chat"
                onClick={async () => {
                  await api.deleteSession(projectId, s.id);
                  if (session?.id === s.id) setSession(null);
                  setSessions(await api.listSessions(projectId));
                }}
              >
                <Trash2 size={13} />
              </button>
            </div>
            </Fragment>
          ))}
        </div>
        <div className="chat-side-foot">
          <Button size="sm" variant="ghost" icon={Brain} onClick={() => setPanel(panel === "memory" ? "none" : "memory")}>
            Memory
          </Button>
          <Button size="sm" variant="ghost" icon={Wrench} onClick={() => setPanel(panel === "tools" ? "none" : "tools")}>
            What it can do
          </Button>
          <Button size="sm" variant="ghost" icon={GitCompare} onClick={() => setPanel(panel === "review" ? "none" : "review")}>
            Review
          </Button>
          <Button size="sm" variant="ghost" icon={Users} onClick={() => setPanel(panel === "swarms" ? "none" : "swarms")}>
            Ultramath
          </Button>
          {!planOpen && (
            <Button size="sm" variant="ghost" icon={ListChecks} onClick={() => setPlanOpen(true)}>
              Show the plan
            </Button>
          )}
          {session && (
            <Button size="sm" variant="ghost" icon={Download} onClick={() => void api.exportSession(projectId, session.id)} title="Save this chat as Markdown, secrets masked">
              Export
            </Button>
          )}
        </div>
      </aside>

      <Resizer width={sideShown} onWidth={setSideWidth} side="left" defaultWidth={240} label="Resize the chat list" />
      <section className="chat-main">
        {panel === "memory" && <MemoryPanel projectId={projectId} onClose={() => setPanel("none")} />}
        {panel === "review" && <ReviewPanel projectId={projectId} sessionId={session?.id ?? null} chatTitle={session?.title ?? ""} onClose={() => setPanel("none")} />}
        {panel === "swarms" &&
          (session ? (
            <SwarmsPanel projectId={projectId} sessionId={session.id} onClose={() => setPanel("none")} />
          ) : (
            <div className="chat-panel">
              <div className="row gap-sm">
                <Users size={16} />
                <b>Ultramath</b>
                <button className="icon-btn" style={{ marginLeft: "auto" }} onClick={() => setPanel("none")}>
                  <X size={15} />
                </button>
              </div>
              <p className="small">
                Ultramath puts several agents on one hard problem, each on a different approach, sharing a board of lemmas, counterexamples and dead ends. You
                (through the assistant) judge what they submit; with a Lean statement, Lean checks first.
              </p>
              <p className="muted small">
                To start one, send a message in a chat, for example: <i>"Start Ultramath on this problem with 4 members: …"</i>. The assistant asks your
                approval, and the swarm then shows here. For a quick run without a chat, use the Ultramath mode on the Prove screen.
              </p>
            </div>
          ))}
        {panel === "tools" && <ToolsPanel health={health} settings={settings} saveSettings={saveSettings} sessionId={session?.id} onClose={() => setPanel("none")} />}

        <div className="chat-scroll" ref={scroller}>
          {!ready && (
            <div className="notice">
              Choose a model provider, key and model in{" "}
              <button className="link" onClick={onGoSetup}>
                Setup
              </button>{" "}
              to chat.
            </div>
          )}
          {!hasProjects && (
            <div className="how">
              <h3>Create your first project</h3>
              <p className="muted">
                A project is a folder: the assistant reads and (with your approval) writes files there, runs commands, checks Lean, searches the web and reads
                PDFs, starts proof runs and Ultramath once you approve, and keeps project memory for later chats. Every screen works in the project chosen in
                the sidebar: Lean files written here show on Prove, and its runs in History.
              </p>
              <form
                className="row gap-sm"
                onSubmit={(e) => {
                  e.preventDefault();
                  void create(newName);
                }}
              >
                <input className="input grow" placeholder="Project name, e.g. odd-perfect" value={newName} onChange={(e) => setNewName(e.target.value)} />
                <Button variant="primary" icon={FolderPlus} type="submit" disabled={!newName.trim()}>
                  Create project
                </Button>
              </form>
              {projectError && <div className="notice notice-bad small">{projectError}</div>}
            </div>
          )}
          {project && !session && (
            <div className="welcome fade-in">
              <div className="welcome-logo">
                <Logo />
              </div>
              <h2>{project.name}</h2>
              <p className="muted">Talk it through in plain words. The assistant explains, plans the work, reads what is known and tries proofs; you decide what it may do.</p>
              <ol className="how-strip">
                <li>
                  <MessageSquarePlus size={15} />
                  <span>
                    <b>Talk</b> Describe the problem or ask a question.
                  </span>
                </li>
                <li>
                  <ListChecks size={15} />
                  <span>
                    <b>Plan</b> It breaks the work into steps, shown on the right.
                  </span>
                </li>
                <li>
                  <ShieldCheck size={15} />
                  <span>
                    <b>Check</b> Proofs go to Lean, a computer proof checker. Only what Lean accepts counts as proved.
                  </span>
                </li>
              </ol>
              <div className="starters">
                {[
                  ["Explain it to me", `Explain "${project.name}" in plain words, as if I had no maths background. What is the question, and why do people care?`],
                  ["What is known?", "What have mathematicians already proved about this problem? Find the key results and papers, save them here, and summarize each in plain words."],
                  ["Make a plan", "Make a plan for this problem: tell me honestly how hard it is, and break the work into steps we can really do."],
                  ["Prove a first piece", "Pick a small, known fact about this problem, state it in Lean, and try to prove it, explaining each step."],
                ].map(([t, q]) => (
                  <button key={t} className="starter" onClick={() => setDraft(q)}>
                    <b>{t}</b>
                    <span>{q}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {session && <Conversation messages={session.messages} projectId={projectId} secretMarks={secretMarks} busy={busy} onChoose={(c) => void sendMessage(false, c)} onOpenInProve={onOpenInProve} />}
          {streaming && visible(streaming) && (
            <div className="msg assistant fade-in">
              <div className="avatar">
                <Logo />
              </div>
              <div className="msg-body">
                <Markdown text={splitChoices(visible(streaming)).body} projectId={projectId} />
                <span className="cursor" />
              </div>
            </div>
          )}
          {sessionApprovals.map((a) => (
            <ApprovalCard key={a.id} approval={a} />
          ))}
          {otherApprovals.length > 0 && <div className="notice">Another chat is waiting for your approval.</div>}
          {autoNote && !busy && (
            <div className="event-note fade-in">
              <Rocket size={13} />
              <span>{autoNote}</span>
            </div>
          )}
          {busy && !(streaming && visible(streaming)) && (
            <div className="thinking fade-in">
              <span className="dots">
                <i />
                <i />
                <i />
              </span>
              {status || "Thinking"}
            </div>
          )}
        </div>
        {error && (
          <div className="notice notice-bad chat-error fade-in">
            {error}
            <button className="icon-btn" onClick={() => setError("")} title="Dismiss">
              <X size={13} />
            </button>
          </div>
        )}

        <Composer
          value={draft}
          onChange={setDraft}
          onSend={(now) => void sendMessage(now)}
          onStop={() => session && void api.stopChat(session.id)}
          onAttach={async () => setFiles([...files, ...(await api.attachFiles(projectId))])}
          files={files}
          onRemoveFile={(f) => setFiles(files.filter((x) => x !== f))}
          commands={commands}
          busy={busy && !!session}
          disabled={!ready}
          placeholder={busy ? "Add to the conversation…" : `Ask anything about ${project?.name ?? "the problem"}…`}
          suggestion={suggestion}
          effort={effort}
          onEffort={async (v) => {
            if (session) {
              await api.setEffort(projectId, session.id, v);
              setSession({ ...session, effort: v });
            } else await saveSettings({ chatEffort: v });
          }}
          spend={session?.costUsd !== undefined ? formatUsd(session.costUsd) : undefined}
          auto={session ? session.auto === true : newChatAuto}
          onAuto={async (on) => {
            if (session) {
              setSession({ ...session, auto: on });
              try {
                await api.setAuto(projectId, session.id, on);
                if (on) setAutoNote("");
              } catch (e) {
                setError(errorText(e));
              }
            } else setNewChatAuto(on);
          }}
        />
      </section>
      {planOpen && <Resizer width={planShown} onWidth={setPlanWidth} side="right" defaultWidth={320} label="Resize the plan" />}
      {planOpen && <PlanView projectId={projectId} onAsk={(q) => void sendMessage(false, q)} onClose={() => setPlanOpen(false)} onOpenInProve={onOpenInProve} onOpenRun={onOpenRun} onShowMe={setShowMe} savedKey={savedKey} />}
      {showMe && projectId && <ShowMe key={`${showMe.file}|${showMe.id ?? ""}`} projectId={projectId} file={showMe.file} savedId={showMe.id} onClose={() => (setShowMeState(null), setSavedKey((k) => k + 1))} onAsk={setDraft} />}
    </div>
  );
}

function dayGroup(t: number): string {
  const d = new Date(t);
  const now = new Date();
  const days = Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86_400_000);
  return days <= 0 ? "Today" : days === 1 ? "Yesterday" : days < 7 ? "This week" : "Earlier";
}

type Item =
  | { kind: "user"; m: Extract<StoredMessage, { role: "user" }>; index: number }
  | { kind: "assistant"; text: string; index: number }
  | { kind: "activity"; results: ToolOutcome[]; index: number };

/** The stored messages as the person reads them: tool work between two answers folded into one activity line. */
function items(messages: StoredMessage[]): Item[] {
  const out: Item[] = [];
  messages.forEach((m, index) => {
    if (m.role === "user") {
      if (m.content.startsWith("Your last reply had no text")) return;
      out.push({ kind: "user", m, index });
    } else if (m.role === "assistant") {
      const text = visible(m.content);
      if (text) out.push({ kind: "assistant", text, index });
    } else {
      const last = out[out.length - 1];
      if (last?.kind === "activity") last.results.push(...m.results);
      else out.push({ kind: "activity", results: [...m.results], index });
    }
  });
  return out;
}

function Conversation({ messages, projectId, secretMarks, busy, onChoose, onOpenInProve }: { messages: StoredMessage[]; projectId: string; secretMarks: Record<number, Finding[]>; busy: boolean; onChoose: (choice: string) => void; onOpenInProve: (path: string) => void }) {
  const list = items(messages);
  /** The person's reply right after a message, to show which option they took. */
  const replyAfter = (k: number): string | undefined => {
    const next = list.slice(k + 1).find((x) => x.kind === "user");
    return next?.kind === "user" ? next.m.content.trim() : undefined;
  };
  return (
    <>
      {list.map((it, k) => {
        const mark = secretMarks[it.index] && <SecretMark findings={secretMarks[it.index]} />;
        if (it.kind === "activity") return <Activity key={k} results={it.results} running={busy && k === list.length - 1} onOpenInProve={onOpenInProve} />;
        if (it.kind === "assistant") {
          const { body, choices } = splitChoices(it.text);
          const answered = choices.length ? replyAfter(k) : undefined;
          const open = choices.length > 0 && answered === undefined && !busy;
          return (
            <div key={k} className="msg assistant fade-in">
              <div className="avatar">
                <Logo />
              </div>
              <div className="msg-body">
                <Markdown text={body} projectId={projectId} />
                {choices.length > 0 && (
                  <div className={`choices ${open ? "" : "closed"}`} role="group" aria-label="Options">
                    {choices.map((c) => (
                      <button key={c} className={`choice ${answered === c ? "picked" : ""}`} disabled={!open} onClick={() => onChoose(c)}>
                        {answered === c && <Check size={13} />}
                        {c}
                      </button>
                    ))}
                    {open && <span className="muted small choices-hint">or type your own answer below</span>}
                  </div>
                )}
                {mark}
              </div>
            </div>
          );
        }
        const m = it.m;
        if (m.source === "auto")
          return (
            <div key={k} className="event-note fade-in">
              <Rocket size={13} />
              <span>
                <b>Auto mode</b> {m.content.split("\n")[0].slice(0, 200)}
              </span>
            </div>
          );
        if (m.source === "reminder" || m.source === "job")
          return (
            <div key={k} className="event-note fade-in">
              {m.source === "reminder" ? <AlarmClock size={13} /> : <Terminal size={13} />}
              <span>
                <b>{m.source === "reminder" ? "Reminder" : "Background work"}</b> {m.content.split("\n")[0].slice(0, 300)}
              </span>
            </div>
          );
        return (
          <div key={k} className="msg user fade-in">
            <div className="msg-body">
              <div className="user-text">{m.content}</div>
              {m.attachments && m.attachments.length > 0 && (
                <div className="composer-files">
                  {m.attachments.map((a) => (
                    <span key={a.path} className="file-chip">
                      {a.path.split("/").pop()}
                    </span>
                  ))}
                </div>
              )}
              {mark}
            </div>
          </div>
        );
      })}
    </>
  );
}

const ASKS: Record<string, string> = {
  write_file: "write a file",
  remove_file: "delete a file",
  start_proof: "start a proof run",
  shell_exec: "run a command",
  http_request: "make a web request",
};

function ApprovalCard({ approval }: { approval: PendingApproval }) {
  const { call } = approval;
  const a = call.args;
  const [error, setError] = useState("");
  const decide = async (ok: boolean) => {
    try {
      await api.decideApproval(approval.id, ok);
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <div className="approval-card">
      <div className="row gap-sm">
        <ShieldAlert size={17} className="accent" />
        <b>The assistant asks to {ASKS[call.name] ?? `use ${call.name}`}</b>
      </div>
      <div className="small">
        {call.name === "write_file" && (
          <>
            <code>{String(a.path)}</code> will be created or replaced with:
          </>
        )}
        {call.name === "remove_file" && (
          <>
            <code>{String(a.path)}</code> will be deleted.
          </>
        )}
        {call.name === "start_proof" && (
          <>
            A {a.mode === "single" ? "single-agent" : "search-tree"} run on <code>{String(a.path)}</code>. It spends model calls from your account.
          </>
        )}
        {call.name === "shell_exec" && <>{a.background === true || a.background === "true" ? "In the background, in the project folder:" : "In the project folder, as you:"}</>}
        {call.name === "http_request" && (
          <>
            <code>{String(a.method ?? "GET")}</code> <code>{String(a.url)}</code>
          </>
        )}
      </div>
      {call.name === "write_file" && typeof a.content === "string" && (
        <div className="code-frame">
          <CodeEditor value={a.content} readOnly />
        </div>
      )}
      {call.name === "shell_exec" && <pre className="lean-output">{String(a.command)}</pre>}
      {call.name === "http_request" && (a.headers !== undefined || a.body !== undefined) && (
        <pre className="lean-output">{`${a.headers ? JSON.stringify(a.headers, null, 2) : ""}\n${typeof a.body === "string" ? a.body : ""}`.trim()}</pre>
      )}
      {!ASKS[call.name] && <pre className="lean-output">{JSON.stringify(a, null, 2)}</pre>}
      <div className="muted small">Exactly this call runs if you approve; nothing can change it in between.</div>
      <div className="row gap-sm">
        <Button variant="primary" onClick={() => void decide(true)}>
          Approve
        </Button>
        <Button variant="ghost" onClick={() => void decide(false)}>
          Deny
        </Button>
      </div>
      {error && <div className="notice notice-bad">{error}</div>}
    </div>
  );
}

function MemoryPanel({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [mem, setMem] = useState<{ index: string; summary: string; records: string[] } | null>(null);
  const [working, setWorking] = useState(false);
  const [note, setNote] = useState("");
  const load = useCallback(() => void api.getMemory(projectId).then(setMem), [projectId]);
  useEffect(load, [load]);
  return (
    <div className="chat-panel">
      <div className="row gap-sm">
        <Brain size={16} />
        <b>What Mack remembers</b>
        <button className="icon-btn" style={{ marginLeft: "auto" }} onClick={onClose}>
          <X size={15} />
        </button>
      </div>
      <p className="muted small">
        Written by Mack, not by the assistant: when you leave a chat, one model call writes a record of it, and another folds the records into the index below,
        which new chats are given as notes about the past. Lines chats cite as useful are kept first. No chat can add to memory by asking.
      </p>
      {mem && !mem.index.trim() ? <div className="muted small">Nothing remembered yet ({mem.records.length} record{mem.records.length === 1 ? "" : "s"}).</div> : <pre className="lean-output">{mem?.index}</pre>}
      {mem?.summary.trim() && (
        <details>
          <summary className="small">Summary</summary>
          <pre className="lean-output">{mem.summary}</pre>
        </details>
      )}
      <div className="row gap-sm">
        <Button
          size="sm"
          loading={working}
          onClick={async () => {
            setWorking(true);
            setNote("");
            try {
              const r = await api.updateMemory(projectId);
              setNote(r.extracted || r.consolidated ? `Read ${r.extracted} chat${r.extracted === 1 ? "" : "s"}${r.consolidated ? " and updated the index" : ""}.` : "Nothing new to remember.");
              load();
            } catch (e) {
              setNote(errorText(e));
            } finally {
              setWorking(false);
            }
          }}
        >
          Update memory now
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={Trash2}
          onClick={async () => {
            await api.forgetMemory(projectId);
            load();
          }}
        >
          Forget all
        </Button>
        {note && <span className="muted small">{note}</span>}
      </div>
    </div>
  );
}

function ToolsPanel({ health, settings, saveSettings, sessionId, onClose }: { health: Health | null; settings: Settings; saveSettings: (s: Partial<Settings>) => Promise<void>; sessionId?: string; onClose: () => void }) {
  const [tools, setTools] = useState<ToolSpec[]>([]);
  const [plugins, setPlugins] = useState<{ name: string; kind: string; tools: string[] }[]>([]);
  useEffect(() => void api.chatTools().then(setTools), []);
  useEffect(() => void (sessionId ? api.listPlugins(sessionId).then(setPlugins) : setPlugins([])), [sessionId]);
  const model = health?.model ?? "";
  const vision = settings.visionModels.includes(model);
  return (
    <div className="chat-panel">
      <div className="row gap-sm">
        <Wrench size={16} />
        <b>What the assistant can do</b>
        <button className="icon-btn" style={{ marginLeft: "auto" }} onClick={onClose}>
          <X size={15} />
        </button>
      </div>
      <p className="muted small">
        Exactly these tools and nothing else. File paths must stay inside the project folder, links included. Mack runs the assistant inside the app, not in an
        operating-system sandbox as Open Math Harness does on Linux: a command you approve runs as you, with your access.
      </p>
      {model && (
        <Toggle
          checked={vision}
          onChange={(v) => void saveSettings({ visionModels: v ? [...settings.visionModels, model] : settings.visionModels.filter((m) => m !== model) })}
          label={`${model.split("/").pop()} reads images (attachments and view_image are sent to it)`}
        />
      )}
      <Toggle checked={settings.suggestions} onChange={(v) => void saveSettings({ suggestions: v })} label="Suggest a next message and title new chats (one short model call each)" />
      {plugins.length > 0 && (
        <div className="small">
          <b>This chat's plugins and MCP servers</b>
          <ul className="tool-list">
            {plugins.map((p) => (
              <li key={p.name}>
                <code>{p.name}</code> ({p.kind}): {p.tools.join(", ") || "no tools"}{" "}
                <button className="link small" onClick={async () => (await api.stopPlugin(sessionId!, p.name), setPlugins(await api.listPlugins(sessionId!)))}>
                  Stop
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <ul className="tool-list">
        {tools.map((t) => (
          <li key={t.name}>
            <code>{t.name}</code> {t.description}
            {t.protected && (
              <select className="model-select" value={settings.approvals[t.name] ?? "ask"} onChange={(e) => void saveSettings({ approvals: { ...settings.approvals, [t.name]: e.target.value as "ask" | "allow" } })}>
                <option value="ask">Ask me every time</option>
                <option value="allow">Allow without asking</option>
              </select>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SecretMark({ findings }: { findings: Finding[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="secret-mark">
      <button className="link small" onClick={() => setOpen(!open)}>
        <KeyRound size={12} /> This message may hold {findings.length === 1 ? "a secret" : `${findings.length} secrets`}
      </button>
      {open && (
        <ul className="small">
          {findings.map((f, i) => (
            <li key={i}>
              <code>{f.rule}</code> {f.preview}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ReviewPanel({ projectId, sessionId, chatTitle, onClose }: { projectId: string; sessionId: string | null; chatTitle: string; onClose: () => void }) {
  const [state, setState] = useState<{ repo: boolean; files: ChangedFile[] } | null>(null);
  const [error, setError] = useState("");
  const [title, setTitle] = useState(chatTitle);
  const [pr, setPr] = useState<PullRequest | null>(null);
  const [opening, setOpening] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [diff, setDiff] = useState("");
  const load = useCallback(() => {
    setError("");
    api.reviewChanges(projectId).then(setState, (e) => setError(errorText(e)));
  }, [projectId]);
  useEffect(load, [load]);
  return (
    <div className="chat-panel">
      <div className="row gap-sm">
        <GitCompare size={16} />
        <b>Review: uncommitted changes</b>
        <button className="link small" onClick={load}>
          Refresh
        </button>
        <button className="icon-btn" style={{ marginLeft: "auto" }} onClick={onClose}>
          <X size={15} />
        </button>
      </div>
      <p className="muted small">What changed in the project's repository since its last commit, whoever made it. Nothing is written until you open a pull request.</p>
      {error && <div className="notice notice-bad">{error}</div>}
      {pr && (
        <div className="notice notice-ok">
          Opened a pull request{pr.createdRepo ? ` in the new private repository ${pr.repo}` : ` in ${pr.repo}`}.{" "}
          <button className="link" onClick={() => void api.openExternal(pr.url)}>
            Review it on GitHub <ExternalLink size={12} />
          </button>
        </div>
      )}
      {state?.repo && state.files.length > 0 && (
        <form
          className="row gap-sm"
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            setOpening(true);
            try {
              setPr(await api.openPr(projectId, sessionId, title));
              load();
            } catch (err) {
              setError(errorText(err));
            } finally {
              setOpening(false);
            }
          }}
        >
          <input className="input grow" placeholder="What this change is" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Button type="submit" icon={GitPullRequest} loading={opening} disabled={!title.trim()} title="Commit these changes and open a GitHub pull request; proofs this chat verified are verified again first">
            Open pull request
          </Button>
        </form>
      )}
      {state && !state.repo && (
        <div className="row gap-sm">
          <span className="muted small">This problem folder is not a git repository.</span>
          <Button size="sm" onClick={async () => ((await api.reviewInit(projectId)) ? load() : setError("Could not run git init: is Git installed?"))}>
            Make it one
          </Button>
        </div>
      )}
      {state?.repo && state.files.length === 0 && <div className="muted small">No uncommitted changes.</div>}
      {state?.files.map((f) => (
        <div key={f.path}>
          <button
            className="tree-row"
            onClick={async () => {
              if (open === f.path) return setOpen(null);
              setOpen(f.path);
              setDiff(await api.reviewFile(projectId, f.path).catch((e) => errorText(e)));
            }}
          >
            <ChevronRight size={13} className="chev" style={{ transform: open === f.path ? "rotate(90deg)" : undefined }} />
            <Badge tone={f.status === "deleted" ? "bad" : f.status === "untracked" || f.status === "added" ? "ok" : "warn"}>{f.status}</Badge>
            <code className="small">{f.path}</code>
            <span className="muted small">{f.binary ? "binary" : f.status === "untracked" ? "" : `+${f.added} −${f.removed}`}</span>
          </button>
          {open === f.path && (
            <pre className="diff">
              {diff.split("\n").map((l, i) => (
                <span key={i} className={l.startsWith("+") && !l.startsWith("+++") ? "diff-add" : l.startsWith("-") && !l.startsWith("---") ? "diff-del" : l.startsWith("@@") ? "diff-hunk" : ""}>
                  {l}
                  {"\n"}
                </span>
              ))}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}

/** A swarm's records as the events the Ultramath view draws. */
function swarmEvents(records: SwarmRecord[]): RunEvent[] {
  const out: RunEvent[] = [];
  for (const r of records) {
    if (r.event === "started") out.push({ type: "start", kind: r.kind, members: r.members.length });
    if (r.event === "direction") out.push({ type: "direction", direction: { id: r.id, member: Number(r.member.slice(1)), text: r.text, state: r.state, reason: r.reason } });
    if (r.event === "refused") out.push({ type: "refused", member: Number(r.member.slice(1)), text: r.text, duplicateOf: r.duplicate_of, reason: r.reason });
    if (r.event === "finding") out.push({ type: "post", post: { id: r.seq, member: Number(r.member.slice(1)), direction: r.direction, kind: r.kind, text: r.text } });
    if (r.event === "member") out.push({ type: "turn", member: Number(r.member.slice(1)), round: r.run, summary: `run ${r.run}: ${r.state}`, tokens: 0 });
    if (r.event === "verdict") out.push({ type: "report", member: Number(r.member.slice(1)), direction: r.direction, report: `judged by the ${r.by}`, accepted: r.accepted, reason: r.reason });
  }
  return out;
}

function SwarmsPanel({ projectId, sessionId, onClose }: { projectId: string; sessionId: string; onClose: () => void }) {
  const [swarms, setSwarms] = useState<{ id: string; records: SwarmRecord[] }[]>([]);
  useEffect(() => {
    const load = () => void api.swarmRecords(projectId, sessionId).then(setSwarms);
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [projectId, sessionId]);
  return (
    <div className="chat-panel">
      <div className="row gap-sm">
        <Users size={16} />
        <b>Ultramath in this chat</b>
        <button className="icon-btn" style={{ marginLeft: "auto" }} onClick={onClose}>
          <X size={15} />
        </button>
      </div>
      {swarms.length === 0 && <p className="muted small">No swarm yet. Ask the assistant to start Ultramath on a hard problem; it needs your approval.</p>}
      {swarms.map((s) => {
        const last = [...s.records].reverse().find((r) => ["started", "resumed", "ended", "interrupted"].includes(r.event));
        return (
          <details key={s.id} open={s === swarms[swarms.length - 1]}>
            <summary className="small">
              <b>{s.id}</b> — {last?.event === "ended" ? `ended ${last.outcome}` : last?.event === "interrupted" ? "interrupted (ask the assistant to resume it)" : "running"}
            </summary>
            <UltramathView events={swarmEvents(s.records)} />
          </details>
        );
      })}
    </div>
  );
}
