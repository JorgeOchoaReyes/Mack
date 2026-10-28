import { UltramathView } from "../components/UltramathView";
import type { RunEvent, SwarmRecord } from "../api";
import { AlarmClock, Brain, ChevronRight, Users, Download, ExternalLink, GitCompare, GitPullRequest, KeyRound, FolderPlus, Maximize2, MessageSquarePlus, MessagesSquare, ShieldAlert, Terminal, Trash2, Wrench, X } from "lucide-react";
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
import { Markdown, visible } from "../components/chat/Markdown";
import { Logo } from "../components/Logo";
import { formatUsd } from "../../core/model/metered";
import { Badge, Button, Spinner, timeAgo, Toggle } from "../components/ui";
import type { ProveContext } from "./ProvePage";
import { firstQuestion } from "./StartPage";

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
  /** Set when the chat is a panel beside Prove: what Prove shows, and the panel's controls. */
  docked?: { context: ProveContext | null; onClose: () => void; onExpand: () => void } | null;
  health: Health | null;
  settings: Settings;
  saveSettings: (s: Partial<Settings>) => Promise<void>;
  onGoSetup: () => void;
};
const EFFORTS: ReasoningEffort[] = ["off", "on", "low", "medium", "high", "xhigh"];

export function ChatPage({ project, hasProjects, onCreateProject, incomingDraft, onOpenInProve, docked, health, settings, saveSettings, onGoSetup }: Props) {
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
  const [newName, setNewName] = useState("");
  const [projectError, setProjectError] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<ChatSession | null>(null);
  sessionRef.current = session;

  const ready = !!health && health.keySource !== "none" && !!health.model;

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
        const cur = sessionRef.current;
        const mine = cur?.id === w.sessionId;
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
    if (projectId && sessionRef.current && sessionRef.current.messages.length > 1) void api.updateMemory(projectId).catch(() => {});
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

  const sendMessage = async (sendNow = false) => {
    const text = draft.trim();
    if ((!text && !files.length) || !projectId) return;
    setDraft("");
    setFiles([]);
    setError("");
    setSuggestion(null);
    if (!busy) {
      setBusy(true);
      setStatus("Thinking…");
    }
    try {
      const id = await api.sendChat(projectId, session?.id ?? null, text, { sendNow, attachments: files });
      const s = await api.getSession(projectId, id);
      setSession(s);
      setSessions(await api.listSessions(projectId));
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  const [skills, setSkills] = useState<{ name: string; description: string }[]>([]);
  useEffect(() => {
    if (projectId) void api.listSkills(projectId).then(setSkills).catch(() => setSkills([]));
  }, [projectId, session?.messages.length]);

  const commands: SlashCommand[] = [
    { name: "/skill", hint: "List this project's skills", group: "Skills", send: true },
    ...skills.map((k) => ({ name: `/skill ${k.name}`, hint: k.description || "Load this skill", group: "Skills" as const, send: true })),
    { name: "/skill https://", hint: "Load a published skill from its SKILL.md URL", group: "Skills", insert: "/skill https://" },
    { name: "/prove", hint: "Formalize a statement in Lean and run a proof search", group: "Start", insert: "Write the Lean 4 statement of the following, check that it compiles, then start a proof search on it: " },
    { name: "/ultramath", hint: "Put several agents on a hard problem", group: "Start", insert: "Start Ultramath with 4 members on: " },
    { name: "/research", hint: "Find and summarize the literature on a topic", group: "Start", insert: "Find the key papers on the following, save them to the project, and summarize what each proves in notes/literature.md: " },
    { name: "/remind", hint: "Have the assistant come back to something later", group: "Start", insert: "In 30 minutes, remind yourself to " },
    { name: "/new", hint: "Start a new chat", group: "Chat", run: () => void openSession(null) },
    { name: "/export", hint: "Save this chat as Markdown, secrets masked", group: "Chat", run: () => session && void api.exportSession(projectId, session.id) },
    { name: "/memory", hint: "What this project remembers", group: "Panels", run: () => setPanel("memory") },
    { name: "/review", hint: "Uncommitted changes; open a pull request", group: "Panels", run: () => setPanel("review") },
    { name: "/tools", hint: "What the assistant can do, and approvals", group: "Panels", run: () => setPanel("tools") },
    { name: "/swarms", hint: "This chat's Ultramath swarms", group: "Panels", run: () => setPanel("swarms") },
  ];

  const sessionApprovals = approvals.filter((a) => a.sessionId === session?.id);
  const otherApprovals = approvals.filter((a) => a.sessionId !== session?.id);
  const effort = session?.effort ?? settings.chatEffort;

  return (
    <div className={docked ? "chat docked" : "chat"}>
      <aside className="chat-side">
        {project && (
          <div className="chat-side-head">
            <b>{project.name}</b>
            <code className="path small">{project.folder}</code>
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
          <Button size="sm" variant="ghost" icon={Brain} disabled={!projectId} onClick={() => setPanel(panel === "memory" ? "none" : "memory")}>
            Memory
          </Button>
          <Button size="sm" variant="ghost" icon={Wrench} onClick={() => setPanel(panel === "tools" ? "none" : "tools")}>
            What it can do
          </Button>
          <Button size="sm" variant="ghost" icon={GitCompare} disabled={!projectId} onClick={() => setPanel(panel === "review" ? "none" : "review")}>
            Review
          </Button>
          <Button size="sm" variant="ghost" icon={Users} disabled={!projectId} onClick={() => setPanel(panel === "swarms" ? "none" : "swarms")}>
            Ultramath
          </Button>
          {session && (
            <Button size="sm" variant="ghost" icon={Download} onClick={() => void api.exportSession(projectId, session.id)} title="Save this chat as Markdown, secrets masked">
              Export
            </Button>
          )}
        </div>
      </aside>

      <section className="chat-main">
        {docked && (
          <div className="dock-head">
            <MessagesSquare size={15} />
            <b>Assistant</b>
            <span className="muted small dock-title">{session ? session.title : "New chat"}</span>
            <button className="icon-btn" title="New chat" disabled={!projectId} onClick={() => void openSession(null)}>
              <MessageSquarePlus size={15} />
            </button>
            <button className="icon-btn" title="Open in the full Chat screen, with every chat of this project" onClick={docked.onExpand}>
              <Maximize2 size={15} />
            </button>
            <button className="icon-btn" title="Close the assistant" onClick={docked.onClose}>
              <X size={15} />
            </button>
          </div>
        )}
        {panel === "memory" && projectId && <MemoryPanel projectId={projectId} onClose={() => setPanel("none")} />}
        {panel === "review" && projectId && <ReviewPanel projectId={projectId} sessionId={session?.id ?? null} chatTitle={session?.title ?? ""} onClose={() => setPanel("none")} />}
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
              <h2>{docked ? "Ask about this statement" : project.name}</h2>
              <p className="muted">
                {docked
                  ? "The assistant works in this project: it can explain the statement, sketch a proof, check pieces with Lean, and write lemmas as new files that show up on Prove."
                  : <>Ask about a problem, a paper or a proof. Type <kbd>/</kbd> for commands and skills; attach PDFs, images and .lean files with the clip.</>}
              </p>
              <div className="starters">
                {(docked ? proveStarters(docked.context) : projectStarters(project)).map(([t, q]) => (
                  <button key={t} className="starter" onClick={() => setDraft(q)}>
                    <b>{t}</b>
                    <span>{q.split("\n\n```")[0]}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {session && <Conversation messages={session.messages} projectId={projectId} secretMarks={secretMarks} busy={busy} onOpenInProve={onOpenInProve} />}
          {streaming && visible(streaming) && (
            <div className="msg assistant fade-in">
              <div className="avatar">
                <Logo />
              </div>
              <div className="msg-body">
                <Markdown text={visible(streaming)} projectId={projectId} />
                <span className="cursor" />
              </div>
            </div>
          )}
          {sessionApprovals.map((a) => (
            <ApprovalCard key={a.id} approval={a} />
          ))}
          {otherApprovals.length > 0 && <div className="notice">Another chat is waiting for your approval.</div>}
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
          disabled={!project || !ready}
          placeholder={project ? (busy ? "Add to the conversation…" : `Message the assistant about ${project.name}…`) : "Create a project first"}
          suggestion={suggestion}
          effort={effort}
          onEffort={async (v) => {
            if (session) {
              await api.setEffort(projectId, session.id, v);
              setSession({ ...session, effort: v });
            } else await saveSettings({ chatEffort: v });
          }}
          spend={session?.costUsd !== undefined ? formatUsd(session.costUsd) : undefined}
        />
      </section>
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

function Conversation({ messages, projectId, secretMarks, busy, onOpenInProve }: { messages: StoredMessage[]; projectId: string; secretMarks: Record<number, Finding[]>; busy: boolean; onOpenInProve: (path: string) => void }) {
  const list = items(messages);
  return (
    <>
      {list.map((it, k) => {
        const mark = secretMarks[it.index] && <SecretMark findings={secretMarks[it.index]} />;
        if (it.kind === "activity") return <Activity key={k} results={it.results} running={busy && k === list.length - 1} onOpenInProve={onOpenInProve} />;
        if (it.kind === "assistant")
          return (
            <div key={k} className="msg assistant fade-in">
              <div className="avatar">
                <Logo />
              </div>
              <div className="msg-body">
                <Markdown text={it.text} projectId={projectId} />
                {mark}
              </div>
            </div>
          );
        const m = it.m;
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
        <b>Project memory</b>
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
          <span className="muted small">This project folder is not a git repository.</span>
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

/** Starting points for a project chat, about the project's topic (its name, as words). */
function projectStarters(p: Project): [string, string][] {
  const topic = p.name.replace(/[-_]+/g, " ").trim();
  return [
    ["New here? Find a first statement", firstQuestion(p)],
    ["Survey what is known", `Find the key papers and results on ${topic}, save them here, and summarize what each proves and what is still open.`],
    ["Formalize & prove", `Pick one basic known fact about ${topic}, write it as a Lean 4 statement in its own .lean file, check that it compiles, then start a proof run.`],
    ["Plan an attack", `Plan how to formalize the main known result on ${topic} as a chain of small Lean lemmas, easiest first.`],
  ];
}

/** Starting points beside Prove, about what it shows: the open file, or the statement in the editor. */
function proveStarters(c: ProveContext | null): [string, string][] {
  if (!c) return [];
  const about = c.path ? `\`${c.path}\`` : "the statement below";
  const code = c.path ? "" : `\n\n\`\`\`lean\n${c.statement.trim()}\n\`\`\``;
  const out: [string, string][] = [
    ["Explain it", `Explain in plain words what ${about} says, and whether it looks true as written.${code}`],
    ["Sketch a proof", `Sketch a proof of ${about} in words first, then name the Mathlib lemmas and tactics to try. Check each step with Lean before you suggest it.${code}`],
    ["Split into lemmas", `Split ${about} into small lemmas, each in its own .lean file in this project, easiest first, so I can prove them one at a time on Prove.${code}`],
  ];
  if (c.lastRun === "failed")
    out.unshift(["Why did it fail?", `A proof run on ${about} did not verify. Check the statement with Lean: is it true as written, is a hypothesis missing, or is it too big for one proof? Tell me what to change or prove first.${code}`]);
  else out.push(["What next?", `I'm working on ${about} on the Prove screen and I'm new to this. What should I do next, and why?${code}`]);
  return out;
}
