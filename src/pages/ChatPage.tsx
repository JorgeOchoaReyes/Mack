import { UltramathView } from "../components/UltramathView";
import type { RunEvent, SwarmRecord } from "../api";
import { AlarmClock, Brain, ChevronRight, Users, Download, GitCompare, KeyRound, FolderOpen, FolderPlus, Lightbulb, MessageSquarePlus, Paperclip, Send, ShieldAlert, Square, Terminal, Trash2, Wrench, X, Zap } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
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
  type ReasoningEffort,
  type SessionSummary,
  type Settings,
  type StoredMessage,
  type ToolOutcome,
  type ToolSpec,
} from "../api";
import { CodeEditor } from "../components/CodeEditor";
import { Badge, Button, Spinner, timeAgo, Toggle } from "../components/ui";

type Props = { health: Health | null; settings: Settings; saveSettings: (s: Partial<Settings>) => Promise<void>; onGoSetup: () => void };

const LAST_PROJECT = "mack.chatProject";
const EFFORTS: ReasoningEffort[] = ["off", "on", "low", "medium", "high", "xhigh"];

export function ChatPage({ health, settings, saveSettings, onGoSetup }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string>(() => {
    try {
      return localStorage.getItem(LAST_PROJECT) ?? "";
    } catch {
      return "";
    }
  });
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
  const scroller = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<ChatSession | null>(null);
  sessionRef.current = session;

  const project = projects.find((p) => p.id === projectId);
  const ready = !!health && health.keySource !== "none" && !!health.model;

  const reloadProjects = useCallback(async () => {
    const ps = await api.listProjects();
    setProjects(ps);
    if (!ps.some((p) => p.id === projectId)) setProjectId(ps[0]?.id ?? "");
  }, [projectId]);

  const reloadSession = useCallback(async () => {
    const cur = sessionRef.current;
    if (cur) {
      const s = await api.getSession(cur.projectId, cur.id);
      if (s) setSession({ ...s, messages: [...s.messages] });
    }
  }, []);

  useEffect(() => {
    void reloadProjects();
    void api.listApprovals().then(setApprovals);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(LAST_PROJECT, projectId);
    } catch {
      // Remembering the last project is only a convenience.
    }
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

  const sessionApprovals = approvals.filter((a) => a.sessionId === session?.id);
  const otherApprovals = approvals.filter((a) => a.sessionId !== session?.id);
  const effort = session?.effort ?? settings.chatEffort;

  return (
    <div className="chat">
      <aside className="chat-side">
        <div className="chat-side-head">
          <select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {projects.length === 0 && <option value="">No project yet</option>}
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <form
            className="row gap-sm"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                const p = await api.createProject(newName);
                setNewName("");
                await reloadProjects();
                setProjectId(p.id);
              } catch (err) {
                setError(errorText(err));
              }
            }}
          >
            <input className="input grow" placeholder="New project name" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <button className="icon-btn" title="Create project" type="submit" disabled={!newName.trim()}>
              <FolderPlus size={16} />
            </button>
            <button
              className="icon-btn"
              title="Use an existing folder as a project"
              type="button"
              onClick={async () => {
                const p = await api.openProject();
                if (p) {
                  await reloadProjects();
                  setProjectId(p.id);
                }
              }}
            >
              <FolderOpen size={16} />
            </button>
          </form>
          {project && <code className="path small">{project.folder}</code>}
        </div>
        <Button icon={MessageSquarePlus} disabled={!projectId} onClick={() => void openSession(null)}>
          New chat
        </Button>
        <div className="chat-sessions">
          {sessions.map((s) => (
            <div key={s.id} className={`chat-session ${session?.id === s.id ? "active" : ""}`}>
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
          <Button size="sm" variant="ghost" icon={Users} disabled={!session} onClick={() => setPanel(panel === "swarms" ? "none" : "swarms")}>
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
        {panel === "memory" && projectId && <MemoryPanel projectId={projectId} onClose={() => setPanel("none")} />}
        {panel === "review" && projectId && <ReviewPanel projectId={projectId} onClose={() => setPanel("none")} />}
        {panel === "swarms" && session && <SwarmsPanel projectId={projectId} sessionId={session.id} onClose={() => setPanel("none")} />}
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
          {projects.length === 0 && (
            <div className="how">
              <h3>Research chat</h3>
              <p className="muted">
                Create a project to start. A project is a folder: the assistant reads and (with your approval) writes files there, runs commands, checks Lean,
                searches the web and reads PDFs, starts proof runs and Ultramath once you approve, and keeps project memory for later chats.
              </p>
            </div>
          )}
          {project && !session && (
            <div className="how">
              <h3>{project.name}</h3>
              <p className="muted">
                Ask about a problem, a paper or a proof. Attach PDFs, images and .lean files with the clip, or put them in the project folder. Type{" "}
                <code>/skill</code> to list the project's skills.
              </p>
            </div>
          )}
          {session?.messages.map((m, i) => (
            <div key={i} className="chat-row">
              <Message m={m} projectId={projectId} />
              {secretMarks[i] && <SecretMark findings={secretMarks[i]} />}
            </div>
          ))}
          {streaming && (
            <div className="chat-msg chat-assistant">
              <RichText text={streaming} projectId={projectId} />
            </div>
          )}
          {sessionApprovals.map((a) => (
            <ApprovalCard key={a.id} approval={a} />
          ))}
          {otherApprovals.length > 0 && <div className="notice">Another chat is waiting for your approval.</div>}
          {busy && (
            <div className="chat-status">
              <Spinner /> {status || "Working…"}
            </div>
          )}
          {error && <div className="notice notice-bad">{error}</div>}
        </div>

        <form
          className="chat-compose"
          onSubmit={(e) => {
            e.preventDefault();
            void sendMessage(false);
          }}
        >
          <div className="chat-compose-main">
            {!draft && suggestion && !busy && (
              <button type="button" className="suggestion" onClick={() => setDraft(suggestion)} title="A suggestion: click to put it in the box">
                <Lightbulb size={13} /> {suggestion}
              </button>
            )}
            {files.length > 0 && (
              <div className="row gap-sm">
                {files.map((f) => (
                  <span key={f} className="file-chip">
                    {f}
                    <button type="button" className="icon-btn" onClick={() => setFiles(files.filter((x) => x !== f))}>
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <textarea
              className="input grow"
              rows={3}
              placeholder={project ? (busy ? "The assistant is working. Send now reaches it between steps; Queue waits for its answer." : `Message the assistant about ${project.name}…`) : "Create a project first"}
              value={draft}
              disabled={!project || !ready}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void sendMessage(busy);
                }
              }}
            />
            <div className="row gap-sm chat-compose-bar">
              <button type="button" className="icon-btn" title="Attach files" disabled={!project} onClick={async () => setFiles([...files, ...(await api.attachFiles(projectId))])}>
                <Paperclip size={15} />
              </button>
              <label className="muted small row gap-sm" title="How deeply the model thinks in this chat">
                Reasoning
                <select
                  className="model-select"
                  value={effort}
                  onChange={async (e) => {
                    const v = e.target.value as ReasoningEffort;
                    if (session) {
                      await api.setEffort(projectId, session.id, v);
                      setSession({ ...session, effort: v });
                    } else await saveSettings({ chatEffort: v });
                  }}
                >
                  {EFFORTS.map((x) => (
                    <option key={x} value={x}>
                      {x}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          {busy && session ? (
            <div className="chat-compose-actions">
              <Button variant="primary" icon={Zap} type="button" disabled={!draft.trim() && !files.length} onClick={() => void sendMessage(true)} title="Reaches the assistant between its steps">
                Send now
              </Button>
              <Button type="button" disabled={!draft.trim() && !files.length} onClick={() => void sendMessage(false)} title="Waits until the assistant answers">
                Queue
              </Button>
              <Button variant="danger" icon={Square} type="button" onClick={() => void api.stopChat(session.id)}>
                Stop
              </Button>
            </div>
          ) : (
            <Button variant="primary" icon={Send} type="submit" disabled={(!draft.trim() && !files.length) || !project || !ready}>
              Send
            </Button>
          )}
        </form>
      </section>
    </div>
  );
}

/** Text with Markdown images of project files: the image is read through the main process, confined to the project. */
function TextWithImages({ text, projectId }: { text: string; projectId: string }) {
  const parts = text.split(/(!\[[^\]]*\]\([^)\s]+(?:\s+"[^"]*")?\))/g);
  return (
    <div className="chat-text">
      {parts.map((p, i) => {
        const m = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/.exec(p);
        return m && !/^[a-z]+:/i.test(m[2]) ? <ProjectImage key={i} alt={m[1]} path={m[2]} projectId={projectId} /> : <span key={i}>{p}</span>;
      })}
    </div>
  );
}

function ProjectImage({ alt, path, projectId }: { alt: string; path: string; projectId: string }) {
  const [src, setSrc] = useState<string | null | undefined>(undefined);
  useEffect(() => void api.projectImage(projectId, path).then(setSrc), [projectId, path]);
  if (src === undefined) return <span className="muted small">[loading {path}]</span>;
  if (src === null) return <span className="muted small">[image {path} could not be shown]</span>;
  return <img className="chat-image" src={src} alt={alt} title={path} />;
}

/** Prose with fenced code: Lean blocks in the editor, tool blocks and citations folded away, the rest as text. */
function RichText({ text, projectId }: { text: string; projectId: string }) {
  const clean = text
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/<think>[\s\S]*$/, "")
    .replace(/<citation_entries>[\s\S]*?(<\/citation_entries>|$)/g, "")
    .trim();
  const parts = clean.split(/(```[a-zA-Z0-9]*\s*\n[\s\S]*?(?:```|$))/g);
  return (
    <>
      {parts.map((p, i) => {
        const m = /^```([a-zA-Z0-9]*)\s*\n([\s\S]*?)(?:```)?$/.exec(p);
        if (!m) return p.trim() ? <TextWithImages key={i} text={p.trim()} projectId={projectId} /> : null;
        if (m[1] === "tool") return null;
        if (m[1].startsWith("lean"))
          return (
            <div key={i} className="code-frame">
              <CodeEditor value={m[2]} readOnly />
            </div>
          );
        return (
          <pre key={i} className="lean-output">
            {m[2]}
          </pre>
        );
      })}
    </>
  );
}

function Message({ m, projectId }: { m: StoredMessage; projectId: string }) {
  if (m.role === "user") {
    if (m.source === "reminder" || m.source === "job")
      return (
        <div className="chat-note">
          {m.source === "reminder" ? <AlarmClock size={13} /> : <Terminal size={13} />} {m.source === "reminder" ? "Reminder" : "Background command"}: {m.content.slice(0, 400)}
        </div>
      );
    return (
      <div className="chat-msg chat-user">
        {m.content}
        {m.attachments?.map((a) => (
          <span key={a.path} className="file-chip">
            {a.path}
          </span>
        ))}
      </div>
    );
  }
  if (m.role === "assistant") {
    const calls = (m.content.match(/```tool/g) ?? []).length;
    const visible = m.content.replace(/```tool[\s\S]*?```/g, "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    if (!visible && calls) return <div className="muted small">Using {calls} tool{calls === 1 ? "" : "s"}…</div>;
    return (
      <div className="chat-msg chat-assistant">
        <RichText text={m.content} projectId={projectId} />
      </div>
    );
  }
  return (
    <div className="chat-tools">
      {m.results.map((r, i) => (
        <ToolCard key={i} r={r} />
      ))}
    </div>
  );
}

function argSummary(args: Record<string, unknown>): string {
  return Object.entries(args)
    .filter(([k]) => k !== "content" && k !== "source" && k !== "body")
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v.slice(0, 80) : JSON.stringify(v).slice(0, 80)}`)
    .join(", ");
}

function ToolCard({ r }: { r: ToolOutcome }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`tool-card tone-${r.ok ? "ok" : "bad"} ${open ? "open" : ""}`}>
      <button className="tree-row" onClick={() => setOpen(!open)}>
        <ChevronRight size={13} className="chev" />
        <code>{r.name}</code>
        <span className="muted small tree-approach">{argSummary(r.args)}</span>
        {r.decision === "approved" && <Badge tone="ok">approved</Badge>}
        {r.decision === "auto" && <Badge>allowed by policy</Badge>}
        {r.decision === "denied" && <Badge tone="bad">denied</Badge>}
        {!r.ok && r.decision !== "denied" && <Badge tone="bad">failed</Badge>}
      </button>
      {open && <pre className="lean-output">{r.output}</pre>}
    </div>
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

function ReviewPanel({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [state, setState] = useState<{ repo: boolean; files: ChangedFile[] } | null>(null);
  const [error, setError] = useState("");
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
      <p className="muted small">What changed in the project's repository since its last commit, whoever made it. Mack only reads the repository here.</p>
      {error && <div className="notice notice-bad">{error}</div>}
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
