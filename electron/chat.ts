// The research chat's main-process side (build step 4): projects, sessions,
// the agent's turns, the approvals the person decides, project memory,
// reminders, background jobs, attachments, suggestions and skills.
// The renderer sees sessions and decides approvals; it never runs a tool.

import { BrowserWindow, dialog, ipcMain } from "electron";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join } from "node:path";
import { runSubAgent, runTurn, type Attachment, type ChatEvent, type ChatSession, type StoredMessage, type ToolOutcome } from "../core/chat/agent";
import { execute, type SessionHooks } from "../core/chat/executor";
import { consolidate, extractSession, forgetMemory, readMemory, recordCitations } from "../core/chat/memory";
import { JobManager, type Job } from "../core/chat/shell";
import { listSkills, loadSkill, SKILL_DIR } from "../core/chat/skills";
import { suggestNext, suggestTitle, type Transcript } from "../core/chat/suggestions";
import { confine, imageDataUrl, imageType, MAX_IMAGE_BYTES, pdfText, SUB_AGENT_TOOLS, toolSpecs, truncate, type ToolCall } from "../core/chat/tools";
import { changes, fileDiff, initRepo, isRepo } from "../core/git";
import type { LeanCheckRun } from "../core/lean/check";
import { findings, maskSecrets, type Finding } from "../core/secrets";
import { PluginRegistry } from "../core/mcp/plugins";
import type { LeanRun } from "../core/lean/verify";
import type { ModelProvider, ReasoningEffort } from "../core/model/provider";
import { metered, type Meter, type Price } from "../core/model/metered";
import type { RunEvent, RunMode, RunRecord, Settings } from "./main";

export type Project = { id: string; name: string; folder: string; createdAt: number };
export type SessionSummary = Pick<ChatSession, "id" | "projectId" | "title" | "startedAt" | "updatedAt"> & { messages: number; busy: boolean };
export type PendingApproval = { id: string; sessionId: string; call: ToolCall };
export type Reminder = { id: string; sessionId: string; text: string; dueAt: number };
export type ChatWire =
  | { sessionId: string; event: ChatEvent }
  | { sessionId: string; approval: PendingApproval }
  | { sessionId: string; approvalDone: string }
  | { sessionId: string; suggestion: string | null }
  | { sessionId: string; changed: true };
export type SendOptions = { sendNow?: boolean; attachments?: string[] };

type Deps = {
  userData: (...p: string[]) => string;
  readSettings: () => Settings;
  makeProvider: (s: Settings) => ModelProvider;
  /** A meter for one session, and the model's price; throws when a cap is set and the model has no price. */
  newMeter: (s: Settings, model: string, spent?: number) => { meter: Meter; price: Price | undefined };
  lean: (s: Settings) => { run: LeanRun; check?: LeanCheckRun } | undefined;
  runProof: (problem: string, mode: RunMode, forward: (ev: RunEvent) => void) => Promise<RunRecord>;
  /** Runs the tools other features register (Ultramath, proof search, MCP) for one session. */
  extraTools?: (ctx: { projectId: string; root: string; sessionId: string; signal: AbortSignal }) => (call: ToolCall) => Promise<string> | undefined;
};

export const PROJECTS_ROOT = join(homedir(), "MackProjects");
export const UPLOADS = "uploads";

/** The chat's live state and operations, for other features that wake a session (Ultramath reports, finished runs). */
export type ChatControl = {
  wake: (projectId: string, sessionId: string, source: "reminder" | "job", text: string) => void;
  project: (id: string) => Project;
  projects: () => Project[];
  stopAll: () => void;
};

export function registerChat(d: Deps): ChatControl {
  const registryPath = () => d.userData("projects.json");
  const projectData = (id: string, ...p: string[]) => d.userData("projects", id, ...p);
  const sessionsDir = (id: string) => {
    const dir = projectData(id, "sessions");
    mkdirSync(dir, { recursive: true });
    return dir;
  };
  const memoryStore = (id: string) => ({ dir: projectData(id, "memory") });
  const safeId = (id: unknown): string => {
    if (typeof id !== "string" || !/^[a-z0-9-]{1,64}$/.test(id)) throw new Error("bad id");
    return id;
  };

  const projects = (): Project[] => {
    try {
      return JSON.parse(readFileSync(registryPath(), "utf8")) as Project[];
    } catch {
      return [];
    }
  };
  const saveProjects = (ps: Project[]) => writeFileSync(registryPath(), JSON.stringify(ps, null, 2));
  const project = (id: string): Project => {
    const p = projects().find((x) => x.id === safeId(id));
    if (!p) throw new Error("no such project");
    if (!existsSync(p.folder)) throw new Error(`the project folder ${p.folder} is gone`);
    return p;
  };
  const addProject = (name: string, folder: string): Project => {
    const p: Project = { id: `p${Date.now().toString(36)}`, name: name.trim() || basename(folder), folder, createdAt: Date.now() };
    saveProjects([...projects(), p]);
    return p;
  };

  const loadSession = (projectId: string, id: string): ChatSession | null => {
    const f = join(sessionsDir(projectId), `${safeId(id)}.json`);
    return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as ChatSession) : null;
  };
  const saveSession = (s: ChatSession) => writeFileSync(join(sessionsDir(s.projectId), `${s.id}.json`), JSON.stringify(s));

  /** Every window hears every chat: a reminder or a finished job can start a turn when no window asked. */
  const send = (w: ChatWire) => {
    for (const win of BrowserWindow.getAllWindows()) if (!win.webContents.isDestroyed()) win.webContents.send("chat:event", w);
  };

  // --- Turns ------------------------------------------------------------------

  /** Live turns: the session object being written, its stop, and what the person sent meanwhile. */
  const live = new Map<string, { session: ChatSession; ctl: AbortController; sendNow: StoredMessage[]; queued: StoredMessage[] }>();
  const pending = new Map<string, { approval: PendingApproval; resolve: (ok: boolean) => void }>();

  const remindersPath = (projectId: string) => projectData(projectId, "reminders.json");
  const readReminders = (projectId: string): Reminder[] => {
    try {
      return JSON.parse(readFileSync(remindersPath(projectId), "utf8")) as Reminder[];
    } catch {
      return [];
    }
  };
  const writeReminders = (projectId: string, rs: Reminder[]) => {
    mkdirSync(projectData(projectId), { recursive: true });
    writeFileSync(remindersPath(projectId), JSON.stringify(rs));
  };
  const timers = new Map<string, NodeJS.Timeout>();
  const schedule = (projectId: string, r: Reminder) => {
    // setTimeout holds at most about 24.8 days; reminders are capped at a week.
    timers.set(
      r.id,
      setTimeout(() => {
        timers.delete(r.id);
        writeReminders(projectId, readReminders(projectId).filter((x) => x.id !== r.id));
        wake(projectId, r.sessionId, "reminder", r.text);
      }, Math.max(0, r.dueAt - Date.now())),
    );
  };

  const plugins = new PluginRegistry();

  const jobs = new JobManager((job: Job) => {
    const owner = sessionProject.get(job.sessionId);
    if (!owner) return;
    const r = job.result!;
    const head = r.timedOut ? "stopped at its deadline" : `ended with exit code ${r.code}`;
    wake(owner, job.sessionId, "job", `Background command ${job.id} ${head}: ${job.command.slice(0, 200)}\n${truncate(r.output, 6000)}`);
  });
  /** Which project a session that ran a turn belongs to, for waking it when its background command ends. */
  const sessionProject = new Map<string, string>();

  /** A message that is not the person's starts a turn now, or waits for the running one to end. */
  function wake(projectId: string, sessionId: string, source: "reminder" | "job", text: string): void {
    const m: StoredMessage = { role: "user", content: text, at: Date.now(), source };
    const l = live.get(sessionId);
    if (l) {
      l.queued.push(m);
      return;
    }
    const session = loadSession(projectId, sessionId);
    if (!session) return;
    session.messages.push(m);
    saveSession(session);
    startTurn(projectId, session);
  }

  /** The settings, model and provider for a chat; with a session, the provider is metered against that chat's cap. */
  const settingsFor = (session?: ChatSession, ctl?: AbortController) => {
    const s = d.readSettings();
    const model = s.models[s.provider];
    if (!model) throw new Error("Choose a model in Setup first.");
    let provider = d.makeProvider(s);
    if (session) {
      const { meter, price } = d.newMeter(s, model, session.costUsd ?? 0);
      provider = metered(provider, price, meter, {
        onCharge: (m) => {
          session.costUsd = m.spent;
          send({ sessionId: session.id, event: { type: "spend", usd: m.spent, limit: m.limit, estimated: m.estimated } });
        },
        onCap: () => ctl?.abort(),
      });
    }
    return { s, model, provider, vision: s.visionModels.includes(model) };
  };

  function startTurn(projectId: string, session: ChatSession): void {
    const p = project(projectId);
    const ctl = new AbortController();
    const { s, model, provider, vision } = settingsFor(session, ctl);
    sessionProject.set(session.id, p.id);
    const state = { session, ctl, sendNow: [] as StoredMessage[], queued: [] as StoredMessage[] };
    live.set(session.id, state);
    const lean = d.lean(s);
    const memory = memoryStore(p.id);

    const hooks: SessionHooks = {
      id: session.id,
      vision,
      jobs,
      remind: (text, minutes) => {
        const r: Reminder = { id: `r${Date.now().toString(36)}`, sessionId: session.id, text, dueAt: Date.now() + minutes * 60_000 };
        writeReminders(p.id, [...readReminders(p.id), r]);
        schedule(p.id, r);
        return `reminder ${r.id} set for ${new Date(r.dueAt).toLocaleString()}`;
      },
      reminders: () => {
        const mine = readReminders(p.id).filter((r) => r.sessionId === session.id);
        return mine.length ? mine.map((r) => `${r.id}: due ${new Date(r.dueAt).toLocaleString()} — ${r.text.slice(0, 200)}`).join("\n") : "no reminders";
      },
      cancelReminder: (id) => {
        const all = readReminders(p.id);
        if (!all.some((r) => r.id === id && r.sessionId === session.id)) throw new Error(`no reminder ${id} in this chat`);
        writeReminders(p.id, all.filter((r) => r.id !== id));
        clearTimeout(timers.get(id));
        timers.delete(id);
        return `cancelled ${id}`;
      },
      subAgent: (task) =>
        runSubAgent(task, {
          provider,
          model,
          projectName: p.name,
          memory: "",
          tools: SUB_AGENT_TOOLS,
          vision,
          effort: session.effort,
          signal: ctl.signal,
          execute: (call) => exec(call, true),
          onEvent: (e) => e.type === "tool" && send({ sessionId: session.id, event: { type: "status", message: `Sub-agent used ${e.outcome.name}` } }),
        }),
    };

    const extra = d.extraTools?.({ projectId: p.id, root: p.folder, sessionId: session.id, signal: ctl.signal });

    const ownTools = () => plugins.specs(session.id);
    const exec = async (call: ToolCall, sub = false): Promise<ToolOutcome> =>
      execute(call, {
        root: p.folder,
        extra: sub ? undefined : (c) => plugins.call(session.id, c.name, c.args, ctl.signal) ?? extra?.(c),
        ownTools: sub ? undefined : ownTools,
        plugins: sub
          ? undefined
          : {
              start: (kind, name, target, map) => plugins.start(session.id, kind, name, target, map, ctl.signal),
              replace: (name, target, map) => plugins.replace(session.id, "plugin", name, target, map, ctl.signal),
              stop: (name) => plugins.stop(session.id, name),
              list: () => plugins.list(session.id),
            },
        lean,
        policy: sub ? {} : s.approvals,
        signal: ctl.signal,
        session: hooks,
        ask: (recorded) =>
          new Promise<boolean>((resolve) => {
            const approval: PendingApproval = { id: `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, sessionId: session.id, call: recorded };
            const finish = (ok: boolean) => {
              pending.delete(approval.id);
              send({ sessionId: session.id, approvalDone: approval.id });
              resolve(ok);
            };
            pending.set(approval.id, { approval, resolve: finish });
            // A stopped turn denies what it was waiting for.
            ctl.signal.addEventListener("abort", () => pending.has(approval.id) && finish(false), { once: true });
            send({ sessionId: session.id, approval });
          }),
        startProof: async (problem, mode) => {
          send({ sessionId: session.id, event: { type: "status", message: `A ${mode === "search" ? "search-tree" : "single-agent"} proof run is going…` } });
          const record = await d.runProof(problem, mode, (ev) => {
            if (ev.type === "status") send({ sessionId: session.id, event: { type: "status", message: ev.message } });
          });
          const solved = record.events.find((x): x is Extract<RunEvent, { type: "solved" }> => x.type === "solved");
          return solved
            ? `verified: the strict verifier accepted a proof (run ${record.id} in History; axioms: ${solved.axioms.join(", ") || "none"}):\n\`\`\`lean\n${solved.proof}\`\`\``
            : `no verified proof (run ${record.id} in History): ${record.message}`;
        },
      });

    void (async () => {
      try {
        await runTurn(session, {
          provider,
          model,
          projectName: p.name,
          memory: (await readMemory(memory)).index,
          skills: await listSkills(p.folder),
          tools: toolSpecs().map((t) => t.name),
          ownTools,
          vision,
          effort: session.effort ?? s.chatEffort,
          signal: ctl.signal,
          takeSendNow: () => state.sendNow.splice(0),
          onEvent: (event) => {
            if (event.type !== "delta") {
              session.updatedAt = Date.now();
              saveSession(session);
            }
            send({ sessionId: session.id, event });
          },
          execute: (call) => exec(call),
        });
      } catch (err) {
        send({ sessionId: session.id, event: { type: "error", message: (err as Error).message } });
      } finally {
        live.delete(session.id);
        session.updatedAt = Date.now();
        // What arrived during the turn and was not sent now starts the next turn.
        const next = [...state.sendNow, ...state.queued];
        session.messages.push(...next);
        saveSession(session);
        send({ sessionId: session.id, event: { type: "done" } });
        if (next.length && !ctl.signal.aborted) startTurn(projectId, session);
        else void afterTurn(p.id, session);
      }
    })();
  }

  /** A title for an untitled chat and the person's likely next message: both untrusted suggestions. */
  async function afterTurn(projectId: string, session: ChatSession): Promise<void> {
    const s = d.readSettings();
    if (!s.suggestions) return;
    try {
      const { model, provider } = settingsFor(session);
      if (!session.titled) {
        const first = session.messages.find((m) => m.role === "user" && (m.source ?? "person") === "person");
        const title = first && first.role === "user" ? await suggestTitle(provider, model, first.content) : null;
        const fresh = loadSession(projectId, session.id);
        if (fresh && title && !live.has(session.id)) {
          fresh.title = title;
          fresh.titled = true;
          saveSession(fresh);
          send({ sessionId: session.id, changed: true });
        }
      }
      const transcript: Transcript = session.messages.flatMap((m): Transcript =>
        m.role === "user" && (m.source ?? "person") === "person" ? [{ role: "person" as const, text: m.content }] : m.role === "assistant" ? [{ role: "assistant" as const, text: m.content }] : [],
      );
      const suggestion = await suggestNext(provider, model, transcript);
      if (!live.has(session.id)) send({ sessionId: session.id, suggestion });
    } catch {
      // A missing suggestion changes nothing else.
    }
  }

  /** What the model is shown of an attached file. */
  async function attachment(root: string, path: string): Promise<Attachment> {
    const file = await confine(root, path);
    const bytes = new Uint8Array(readFileSync(file));
    const type = imageType(bytes);
    if (type) {
      if (bytes.byteLength > MAX_IMAGE_BYTES) return { path, kind: "image", note: "an image larger than 4 MiB; not shown" };
      return { path, kind: "image", image: await imageDataUrl(root, path), note: "an image" };
    }
    if (Buffer.from(bytes.slice(0, 5)).toString() === "%PDF-") {
      try {
        return { path, kind: "pdf", text: truncate(await pdfText(bytes)), note: "a PDF, as text" };
      } catch (e) {
        return { path, kind: "pdf", note: `a PDF that could not be read: ${(e as Error).message}` };
      }
    }
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    if (!text.includes("�")) return { path, kind: "text", text: truncate(text), note: "text" };
    return { path, kind: "other", note: "not text, an image or a PDF; only named" };
  }

  // --- IPC --------------------------------------------------------------------

  ipcMain.handle("projects:list", () => projects());

  ipcMain.handle("projects:create", async (_e, name: string) => {
    const clean = String(name).trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, "").slice(0, 60);
    if (!clean) throw new Error("give the project a name");
    const folder = join(PROJECTS_ROOT, clean);
    mkdirSync(folder, { recursive: true });
    // Upstream projects are git repositories; without git a project simply has no Review.
    await initRepo(folder);
    return addProject(clean, folder);
  });

  ipcMain.handle("projects:open", async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const r = await dialog.showOpenDialog(win!, { properties: ["openDirectory", "createDirectory"], title: "Choose a project folder" });
    if (r.canceled || !r.filePaths[0]) return null;
    return addProject(basename(r.filePaths[0]), r.filePaths[0]);
  });

  /** Forget a project: its sessions and memory go; its folder and files stay. */
  ipcMain.handle("projects:remove", (_e, id: string) => {
    safeId(id);
    saveProjects(projects().filter((p) => p.id !== id));
    rmSync(projectData(id), { recursive: true, force: true });
  });

  ipcMain.handle("sessions:list", (_e, projectId: string): SessionSummary[] =>
    readdirSync(sessionsDir(safeId(projectId)))
      .filter((f) => f.endsWith(".json"))
      .flatMap((f) => {
        try {
          const s = JSON.parse(readFileSync(join(sessionsDir(projectId), f), "utf8")) as ChatSession;
          return [{ id: s.id, projectId: s.projectId, title: s.title, startedAt: s.startedAt, updatedAt: s.updatedAt, messages: s.messages.length, busy: live.has(s.id) }];
        } catch {
          return [];
        }
      })
      .sort((a, b) => b.updatedAt - a.updatedAt),
  );

  /** A live session is read from memory, so a window sees what the running turn has written. */
  ipcMain.handle("sessions:get", (_e, projectId: string, id: string) => live.get(safeId(id))?.session ?? loadSession(safeId(projectId), id));

  ipcMain.handle("sessions:delete", (_e, projectId: string, id: string) => {
    live.get(id)?.ctl.abort();
    plugins.stopSession(id);
    rmSync(join(sessionsDir(safeId(projectId)), `${safeId(id)}.json`), { force: true });
  });

  ipcMain.handle("sessions:effort", (_e, projectId: string, id: string, effort: ReasoningEffort) => {
    const sess = live.get(safeId(id))?.session ?? loadSession(safeId(projectId), id);
    if (!sess) throw new Error("no such chat");
    sess.effort = effort;
    saveSession(sess);
  });

  /** Copy files the person picked into the project's uploads folder; returns their project paths. */
  ipcMain.handle("chat:attach", async (e, projectId: string) => {
    const p = project(projectId);
    const win = BrowserWindow.fromWebContents(e.sender);
    const r = await dialog.showOpenDialog(win!, { properties: ["openFile", "multiSelections"], title: "Attach files" });
    if (r.canceled) return [];
    mkdirSync(join(p.folder, UPLOADS), { recursive: true });
    return r.filePaths.map((src) => {
      if (statSync(src).size > 50_000_000) throw new Error(`${basename(src)} is larger than 50 MB`);
      let name = basename(src);
      for (let i = 2; existsSync(join(p.folder, UPLOADS, name)); i++) name = `${basename(src, extname(src))}-${i}${extname(src)}`;
      copyFileSync(src, join(p.folder, UPLOADS, name));
      return `${UPLOADS}/${name}`;
    });
  });

  ipcMain.handle("chat:send", async (_e, projectId: string, sessionId: string | null, text: string, opts: SendOptions = {}) => {
    const p = project(projectId);
    const pre = sessionId ? live.get(sessionId)?.session ?? loadSession(p.id, sessionId) : null;
    // Refuse before anything is stored: a cap with no price, or a chat that has spent its cap.
    const { s: st, model: md } = settingsFor();
    const { meter } = d.newMeter(st, md, pre?.costUsd ?? 0);
    if (meter.limit > 0 && meter.spent >= meter.limit) throw new Error(`This chat has spent its cap of $${meter.limit.toFixed(2)}. Start a new chat, or raise the cap in Settings.`);
    const attachments = await Promise.all((opts.attachments ?? []).map((a) => attachment(p.folder, a)));
    const message: StoredMessage = { role: "user", content: text, at: Date.now(), source: "person", ...(attachments.length ? { attachments } : {}) };
    const l = sessionId ? live.get(sessionId) : undefined;
    if (l) {
      // While the agent works: "send now" reaches it between steps; otherwise it waits for the turn's end.
      (opts.sendNow ? l.sendNow : l.queued).push(message);
      send({ sessionId: l.session.id, changed: true });
      return l.session.id;
    }
    const session: ChatSession = (sessionId && loadSession(p.id, sessionId)) || {
      id: `s${Date.now().toString(36)}`,
      projectId: p.id,
      title: text.trim().split("\n")[0].slice(0, 60) || "New chat",
      startedAt: Date.now(),
      updatedAt: Date.now(),
      effort: d.readSettings().chatEffort,
      messages: [],
    };
    session.messages.push(message);
    // `/skill` commands: the harness makes the call itself, before the model's first step, recorded like any tool call.
    const skill = /^\/skill(?:\s+(\S+))?\s*$/m.exec(text.trim().split("\n")[0]);
    if (skill) {
      let outcome: ToolOutcome;
      try {
        const arg = skill[1];
        const output = !arg
          ? (await listSkills(p.folder)).map((k) => `- ${k.name}: ${k.description}`).join("\n") || "the project has no skills"
          : /^https:\/\//.test(arg)
            ? await loadSkill(p.folder, arg)
            : readFileSync(await confine(p.folder, `${SKILL_DIR}/${arg}/SKILL.md`), "utf8");
        outcome = { name: arg && /^https:/.test(arg) ? "skills_load" : "skills_list", args: arg ? { skill: arg } : {}, ok: true, output: truncate(output), protected: false };
      } catch (err) {
        outcome = { name: "skills_load", args: { skill: skill[1] }, ok: false, output: (err as Error).message, protected: false };
      }
      session.messages.push({ role: "tool", results: [outcome], at: Date.now() });
    }
    session.updatedAt = Date.now();
    saveSession(session);
    startTurn(p.id, session);
    return session.id;
  });

  ipcMain.handle("chat:stop", (_e, sessionId: string) => live.get(sessionId)?.ctl.abort());

  ipcMain.handle("chat:suggestStart", async () => {
    if (!d.readSettings().suggestions) return null;
    try {
      const { model, provider } = settingsFor();
      return await suggestNext(provider, model, []);
    } catch {
      return null;
    }
  });

  /** A project image as a data URL, for an image the assistant shows in a reply. */
  ipcMain.handle("project:image", async (_e, projectId: string, path: string) => {
    try {
      return await imageDataUrl(project(projectId).folder, path);
    } catch {
      return null;
    }
  });

  ipcMain.handle("approvals:list", () => [...pending.values()].map((p) => p.approval));

  /** The person's decision on one pending call. Single-use: a decided approval is gone. */
  ipcMain.handle("approvals:decide", (_e, id: string, approve: boolean) => {
    const p = pending.get(id);
    if (!p) throw new Error("that request is no longer waiting");
    p.resolve(approve === true);
  });

  /** Read every session that changed since memory last read it, then consolidate. */
  const remember = async (projectId: string): Promise<{ extracted: number; consolidated: boolean }> => {
    const { model, provider } = settingsFor();
    let extracted = 0;
    for (const f of readdirSync(sessionsDir(projectId)).filter((x) => x.endsWith(".json"))) {
      const session = loadSession(projectId, f.slice(0, -5));
      if (!session || live.has(session.id) || (session.rememberedAt ?? 0) >= session.updatedAt || session.messages.length < 2) continue;
      // Secrets are masked before a session reaches extraction: memory goes into every later prompt.
      const messages = session.messages.flatMap((m) =>
        m.role === "tool"
          ? [{ role: "user" as const, content: maskSecrets(`Tool results: ${m.results.map((r) => `[${r.name}] ${r.ok ? "ok" : "failed"}: ${r.output.slice(0, 1500)}`).join("\n")}`) }]
          : [{ role: m.role, content: maskSecrets(m.content) }],
      );
      if (await extractSession(memoryStore(projectId), { id: session.id, startedAt: session.startedAt, messages }, provider, model)) extracted++;
      await recordCitations(memoryStore(projectId), session.citations ?? []);
      session.citations = [];
      session.rememberedAt = Date.now();
      saveSession(session);
    }
    const consolidated = await consolidate(memoryStore(projectId), provider, model);
    return { extracted, consolidated };
  };

  ipcMain.handle("memory:get", async (_e, projectId: string) => readMemory(memoryStore(safeId(projectId))));
  ipcMain.handle("memory:update", async (_e, projectId: string) => remember(safeId(projectId)));
  ipcMain.handle("memory:forget", async (_e, projectId: string) => forgetMemory(memoryStore(safeId(projectId))));

  ipcMain.handle("chat:tools", () => toolSpecs());
  ipcMain.handle("plugins:list", (_e, sessionId: string) => plugins.instances(safeId(sessionId)));
  ipcMain.handle("plugins:stop", (_e, sessionId: string, name: string) => plugins.stop(safeId(sessionId), String(name)));

  /** The secret scan of a chat's records: by message index, what looks like a secret, masked. */
  ipcMain.handle("sessions:findings", (_e, projectId: string, id: string): Record<number, Finding[]> => {
    const sess = live.get(safeId(id))?.session ?? loadSession(safeId(projectId), id);
    const out: Record<number, Finding[]> = {};
    sess?.messages.forEach((m, i) => {
      const text = m.role === "tool" ? m.results.map((r) => `${JSON.stringify(r.args)}\n${r.output}`).join("\n") : m.content;
      const f = findings(text);
      if (f.length) out[i] = f.slice(0, 20);
    });
    return out;
  });

  /** A chat as Markdown, with every finding of the secret scan masked. */
  ipcMain.handle("sessions:export", async (e, projectId: string, id: string) => {
    const sess = loadSession(safeId(projectId), id);
    if (!sess) throw new Error("no such chat");
    const md = [`# ${sess.title}`, "", `${new Date(sess.startedAt).toLocaleString()}`, ""];
    for (const m of sess.messages) {
      if (m.role === "tool") md.push(...m.results.map((r) => `> **${r.name}** ${r.ok ? "ok" : "failed"}\n>\n> \`\`\`\n${r.output.slice(0, 3000).replace(/^/gm, "> ")}\n> \`\`\``), "");
      else md.push(`## ${m.role === "user" ? (m.source === "reminder" ? "Reminder" : m.source === "job" ? "Background command" : "Person") : "Assistant"}`, "", m.content, "");
    }
    const win = BrowserWindow.fromWebContents(e.sender);
    const r = await dialog.showSaveDialog(win!, { defaultPath: `${sess.title.replace(/[<>:"/\\|?*]/g, "").slice(0, 60) || "chat"}.md`, filters: [{ name: "Markdown", extensions: ["md"] }] });
    if (r.canceled || !r.filePath) return false;
    writeFileSync(r.filePath, maskSecrets(md.join("\n")), "utf8");
    return true;
  });

  ipcMain.handle("review:changes", async (_e, projectId: string) => {
    const p = project(projectId);
    return isRepo(p.folder) ? { repo: true, files: await changes(p.folder) } : { repo: false, files: [] };
  });
  ipcMain.handle("review:file", async (_e, projectId: string, path: string) => fileDiff(project(projectId).folder, String(path)));
  ipcMain.handle("review:init", async (_e, projectId: string) => initRepo(project(projectId).folder));
  ipcMain.handle("skills:list", async (_e, projectId: string) => listSkills(project(projectId).folder));

  // Reminders survive a restart: schedule what is still pending.
  for (const p of projects()) for (const r of readReminders(p.id)) schedule(p.id, r);

  return {
    wake,
    project,
    projects,
    stopAll: () => {
      plugins.stopAll();
      jobs.stopAll();
      for (const l of live.values()) l.ctl.abort();
    },
  };
}
