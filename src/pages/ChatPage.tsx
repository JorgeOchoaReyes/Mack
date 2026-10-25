import { Brain, ChevronRight, FolderOpen, FolderPlus, MessageSquarePlus, Send, ShieldAlert, Square, Trash2, Wrench, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  errorText,
  type ChatSession,
  type ChatWire,
  type Health,
  type PendingApproval,
  type Project,
  type SessionSummary,
  type Settings,
  type StoredMessage,
  type ToolOutcome,
  type ToolSpec,
} from "../api";
import { CodeEditor } from "../components/CodeEditor";
import { Badge, Button, Spinner, timeAgo } from "../components/ui";

type Props = { health: Health | null; settings: Settings; saveSettings: (s: Partial<Settings>) => Promise<void>; onGoSetup: () => void };

const LAST_PROJECT = "mack.chatProject";

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
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [panel, setPanel] = useState<"none" | "memory" | "tools">("none");
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
    if (projectId) void api.listSessions(projectId).then(setSessions);
    else setSessions([]);
  }, [projectId]);

  useEffect(
    () =>
      api.onChatEvent((w: ChatWire) => {
        if ("approval" in w) setApprovals((a) => [...a, w.approval]);
        else if ("approvalDone" in w) setApprovals((a) => a.filter((x) => x.id !== w.approvalDone));
        else {
          const cur = sessionRef.current;
          if (w.event.type === "status") setStatus(w.event.message);
          if (w.event.type === "error") setError(w.event.message);
          if (w.event.type === "done") {
            setBusy(false);
            setStatus("");
          }
          // The stored session is the truth: reload it rather than mirroring every event.
          if (cur && cur.id === w.sessionId && w.event.type !== "status") void api.getSession(cur.projectId, cur.id).then((s) => s && setSession(s));
        }
      }),
    [],
  );

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [session?.messages.length, approvals.length]);

  /** Leaving a session lets memory read it; failures only cost a memory, never the chat. */
  const rememberInBackground = () => {
    if (projectId && sessionRef.current && sessionRef.current.messages.length > 1) void api.updateMemory(projectId).catch(() => {});
  };

  const openSession = async (id: string | null) => {
    rememberInBackground();
    setError("");
    setSession(id ? await api.getSession(projectId, id) : null);
  };

  const sendMessage = async () => {
    const text = draft.trim();
    if (!text || !projectId || busy) return;
    setDraft("");
    setError("");
    setBusy(true);
    setStatus("Thinking…");
    try {
      const id = await api.sendChat(projectId, session?.id ?? null, text);
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
                <span className="chat-session-title">{s.title}</span>
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
        </div>
      </aside>

      <section className="chat-main">
        {panel === "memory" && projectId && <MemoryPanel projectId={projectId} onClose={() => setPanel("none")} />}
        {panel === "tools" && <ToolsPanel settings={settings} saveSettings={saveSettings} onClose={() => setPanel("none")} />}

        <div className="chat-scroll" ref={scroller}>
          {!ready && (
            <div className="notice">
              Choose a model provider, key and model in <button className="link" onClick={onGoSetup}>Setup</button> to chat.
            </div>
          )}
          {projects.length === 0 && (
            <div className="how">
              <h3>Research chat</h3>
              <p className="muted">
                Create a project to start. A project is a folder: the assistant reads and (with your approval) writes files there, checks Lean, searches the web
                and reads PDFs, and can start proof runs once you approve. What it learns is kept as project memory for later chats.
              </p>
            </div>
          )}
          {project && !session && (
            <div className="how">
              <h3>{project.name}</h3>
              <p className="muted">Ask about a problem, a paper or a proof. Put PDFs and .lean files in the project folder for the assistant to read.</p>
            </div>
          )}
          {session?.messages.map((m, i) => <Message key={i} m={m} />)}
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
            void sendMessage();
          }}
        >
          <textarea
            className="input grow"
            rows={3}
            placeholder={project ? `Message the assistant about ${project.name}…` : "Create a project first"}
            value={draft}
            disabled={!project || !ready}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void sendMessage();
              }
            }}
          />
          {busy && session ? (
            <Button variant="danger" icon={Square} type="button" onClick={() => void api.stopChat(session.id)}>
              Stop
            </Button>
          ) : (
            <Button variant="primary" icon={Send} type="submit" disabled={!draft.trim() || !project || !ready}>
              Send
            </Button>
          )}
        </form>
      </section>
    </div>
  );
}

/** Prose with fenced code: Lean blocks in the editor, tool blocks folded away, the rest as text. */
function RichText({ text }: { text: string }) {
  const clean = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const parts = clean.split(/(```[a-zA-Z0-9]*\s*\n[\s\S]*?```)/g);
  return (
    <>
      {parts.map((p, i) => {
        const m = /^```([a-zA-Z0-9]*)\s*\n([\s\S]*?)```$/.exec(p);
        if (!m) return p.trim() ? <div key={i} className="chat-text">{p.trim()}</div> : null;
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

function Message({ m }: { m: StoredMessage }) {
  if (m.role === "user") return <div className="chat-msg chat-user">{m.content}</div>;
  if (m.role === "assistant") {
    const calls = (m.content.match(/```tool/g) ?? []).length;
    return (
      <div className="chat-msg chat-assistant">
        <RichText text={m.content} />
        {calls > 0 && !m.content.replace(/```tool[\s\S]*?```/g, "").trim() && <div className="muted small">Using {calls} tool{calls === 1 ? "" : "s"}…</div>}
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
    .filter(([k]) => k !== "content" && k !== "source")
    .map(([k, v]) => `${k}: ${String(v).slice(0, 80)}`)
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

function ApprovalCard({ approval }: { approval: PendingApproval }) {
  const { call } = approval;
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
        <b>The assistant asks to {call.name === "write_file" ? "write a file" : call.name === "start_proof" ? "start a proof run" : `run ${call.name}`}</b>
      </div>
      <div className="small">
        {call.name === "write_file" && (
          <>
            <code>{String(call.args.path)}</code> will be created or replaced with:
          </>
        )}
        {call.name === "start_proof" && (
          <>
            A {call.args.mode === "single" ? "single-agent" : "search-tree"} run on <code>{String(call.args.path)}</code>. It spends model calls from your account.
          </>
        )}
      </div>
      {call.name === "write_file" && typeof call.args.content === "string" && (
        <div className="code-frame">
          <CodeEditor value={call.args.content} readOnly />
        </div>
      )}
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
        which new chats are given as notes about the past. No chat can add to memory by asking.
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

function ToolsPanel({ settings, saveSettings, onClose }: { settings: Settings; saveSettings: (s: Partial<Settings>) => Promise<void>; onClose: () => void }) {
  const [tools, setTools] = useState<ToolSpec[]>([]);
  useEffect(() => void api.chatTools().then(setTools), []);
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
        operating-system sandbox as Open Math Harness does on Linux, so these checks are the whole boundary.
      </p>
      <ul className="tool-list">
        {tools.map((t) => (
          <li key={t.name}>
            <code>{t.name}</code> {t.description}
            {t.protected && (
              <select
                className="model-select"
                value={settings.approvals[t.name as "write_file" | "start_proof"] ?? "ask"}
                onChange={(e) => void saveSettings({ approvals: { ...settings.approvals, [t.name]: e.target.value } })}
              >
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
