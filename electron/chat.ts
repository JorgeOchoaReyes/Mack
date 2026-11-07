// The research chat's main-process side (build step 4): projects, sessions,
// the agent's turns, the approvals the person decides, project memory,
// reminders, background jobs, attachments, suggestions and skills.
// The renderer sees sessions and decides approvals; it never runs a tool.

import { BrowserWindow, dialog, ipcMain } from "electron";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join } from "node:path";
import { runSubAgent, runTurn, type Attachment, type ChatEvent, type ChatSession, type StoredMessage, type ToolOutcome } from "../core/chat/agent";
import { execute, verifyFiles, type SessionHooks } from "../core/chat/executor";
import { prBody, verifiedPairs, type Verdict } from "../core/chat/pr";
import { consolidate, extractSession, forgetMemory, readMemory, recordCitations } from "../core/chat/memory";
import { JobManager, type Job } from "../core/chat/shell";
import { describeStatement, normalizePlan, planPrompt, provedBy, readPlan, recordProved, writePlan, type Plan } from "../core/chat/plan";
import { proofPath, type ProofPath } from "../core/chat/path";
import { parseWalkthrough, proofHash, proofsHash, readWalkthrough, saveWalkthrough, SHOWME_ALL_PROMPT, SHOWME_PROMPT, showmeAllRequest, showmeRequest, type StoredWalkthrough, type Walkthrough } from "../core/showme";
import { listSkills, loadSkill, SKILL_DIR } from "../core/chat/skills";
import { suggestNext, suggestTitle, type Transcript } from "../core/chat/suggestions";
import { confine, imageDataUrl, imageType, MAX_IMAGE_BYTES, pdfText, registerTools, SUB_AGENT_TOOLS, toolSpecs, truncate, type ToolCall } from "../core/chat/tools";
import { changes, fileDiff, initRepo, isRepo } from "../core/git";
import { openCommunityPr, openProjectPr, type PullRequest } from "../core/github";
import { buildEntry, COMMUNITY_DIR, COMMUNITY_REPO, communityPrBody, entrySlug, type EntryMeta } from "../core/community";
import type { LeanCheckRun } from "../core/lean/check";
import { findings, maskSecrets, type Finding } from "../core/secrets";
import { PluginRegistry } from "../core/mcp/plugins";
import type { LeanRun } from "../core/lean/verify";
import type { ModelProvider, ReasoningEffort } from "../core/model/provider";
import { metered, type Meter, type Price } from "../core/model/metered";
import type { RunEvent, RunMode, RunOrigin, RunRecord, Settings } from "./main";

export type Project = { id: string; name: string; folder: string; createdAt: number };
export type SessionSummary = Pick<ChatSession, "id" | "projectId" | "title" | "startedAt" | "updatedAt"> & { messages: number; busy: boolean };
export type PendingApproval = { id: string; sessionId: string; call: ToolCall };
export type Reminder = { id: string; sessionId: string; text: string; dueAt: number };
export type ChatWire =
  | { sessionId: string; event: ChatEvent }
  | { sessionId: string; approval: PendingApproval }
  | { sessionId: string; approvalDone: string }
  | { sessionId: string; suggestion: string | null }
  | { sessionId: string; changed: true }
  | { sessionId: string; plan: Plan; projectId: string }
  | { sessionId: string; autoStopped: string };
export type SendOptions = { sendNow?: boolean; attachments?: string[]; /** Start a new chat in auto mode. */ auto?: boolean };

type Deps = {
  userData: (...p: string[]) => string;
  readSettings: () => Settings;
  makeProvider: (s: Settings) => ModelProvider;
  /** A meter for one session, and the model's price; throws when the global limit is reached. `capped: false` leaves out the per-session cap. */
  newMeter: (s: Settings, model: string, spent?: number, capped?: boolean) => { meter: Meter; price: Price | undefined };
  lean: (s: Settings) => { run: LeanRun; check?: LeanCheckRun } | undefined;
  runProof: (problem: string, mode: RunMode, forward: (ev: RunEvent) => void, origin?: RunOrigin) => Promise<RunRecord>;
  /** The GitHub token for project pull requests, or "" when none is set up. */
  githubToken: () => Promise<string>;
  /** Runs the tools other features register (Ultramath, proof search, MCP) for one session. */
  extraTools?: (ctx: { projectId: string; root: string; sessionId: string; signal: AbortSignal }) => (call: ToolCall) => Promise<string> | undefined;
};

export const PROJECTS_ROOT = join(homedir(), "MackProjects");
export const UPLOADS = "uploads";
/** Auto mode starts at most this many turns in a row before it waits for the person. */
const MAX_AUTO_TURNS = 30;
/** Every protected tool allowed: auto mode's approval policy. */
const ALLOW_ALL = new Proxy({}, { get: () => "allow" }) as Partial<Record<string, "allow">>;

/** The chat's live state and operations, for other features that wake a session (Ultramath reports, finished runs). */
export type ChatControl = {
  wake: (projectId: string, sessionId: string, source: "reminder" | "job", text: string) => void;
  project: (id: string) => Project;
  projects: () => Project[];
  /** The project of a folder: the one already registered for it, or a new one. */
  adopt: (folder: string) => Project;
  stopAll: () => void;
};

export function registerChat(d: Deps): ChatControl {
  registerTools([
    {
      name: "open_pr",
      description:
        "Commit the project's changes and open a GitHub pull request with them, so the person can review the work from anywhere (the first one creates a private repository). The description lists the files and re-runs the strict verifier on every proof you verified. Use it when a piece of work is finished. Needs the person's approval.",
      args: { title: "a short title for the change", "summary?": "what the PR contains and what is and is not verified, in a few sentences" },
      protected: true,
    },
    {
      name: "plan_update",
      description:
        "Update the problem's plan, which the person reads beside the chat: the goal in plain words, an honest outlook, and the steps. Fields you leave out stay as they are; `steps`, when given, replaces the whole list, so send every step.",
      args: {
        "goal?": "the problem in one or two plain sentences",
        "outlook?": "where we honestly stand: what is known, how hard it is, what we can realistically aim for",
        "steps?":
          "array of {id, title, kind, via?, status, why?, result?, verified?}: kind is lean, read, compute, think or write; via is the Mack feature that does it (web, python, lean_check, proof_run, proof_search, ultramath, agents, reminder, pull_request or chat); status is todo, doing, done, stuck or dropped; verified is true only when a Lean verifier accepted the step's proof",
      },
      protected: false,
    },
  ]);
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

  const cleanName = (name: unknown, what: string): string => {
    const clean = String(name).trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, "").slice(0, 60);
    if (!clean) throw new Error(`give the ${what} a name`);
    return clean;
  };

  const loadSession = (projectId: string, id: string): ChatSession | null => {
    const f = join(sessionsDir(projectId), `${safeId(id)}.json`);
    return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as ChatSession) : null;
  };
  const saveSession = (s: ChatSession) => writeFileSync(join(sessionsDir(s.projectId), `${s.id}.json`), JSON.stringify(s));

  /** Every window hears every chat: a reminder or a finished job can start a turn when no window asked. */
  /** Each problem's plan, kept in memory so the assistant's instructions can read it synchronously. */
  const plans = new Map<string, Plan>();
  const planOf = async (p: Project): Promise<Plan> => {
    let plan = plans.get(p.id);
    if (!plan) {
      plan = await readPlan(p.folder);
      // A plan from before Mack kept the Proved list: rebuild it once from the chats' verifier verdicts.
      if (!plan.proved) {
        plan = backfillProved(p, plan);
        if (plan.proved?.length) await writePlan(p.folder, plan);
      }
      plans.set(p.id, plan);
    }
    return plan;
  };

  /** The Proved entry for a verdict on `file`, with the theorem and its description read from the file as it is now. */
  const provedEntry = (p: Project, found: NonNullable<ReturnType<typeof provedBy>>, at: number) => {
    let source = "";
    try {
      source = readFileSync(join(p.folder, found.file), "utf8");
    } catch {
      // The statement file is gone; the entry is still a record of the verdict.
    }
    return { ...found, ...describeStatement(source), at };
  };

  const backfillProved = (p: Project, plan: Plan): Plan => {
    let next: Plan = { ...plan, proved: [] };
    let files: string[] = [];
    try {
      files = readdirSync(sessionsDir(p.id)).filter((f) => f.endsWith(".json"));
    } catch {
      return next;
    }
    const verdicts: { found: NonNullable<ReturnType<typeof provedBy>>; at: number }[] = [];
    for (const f of files) {
      const s = loadSession(p.id, f.slice(0, -5));
      for (const m of s?.messages ?? []) {
        if (m.role !== "tool") continue;
        for (const r of m.results) {
          const found = provedBy(r);
          if (found) verdicts.push({ found, at: m.at ?? 0 });
        }
      }
    }
    for (const v of verdicts.sort((a, b) => a.at - b.at)) next = recordProved(next, provedEntry(p, v.found, v.at));
    return { ...next, updatedAt: plan.updatedAt };
  };

  /** The plan as the person sees it: Proved lists only statements whose file is still in the project. */
  const shown = (p: Project, plan: Plan): Plan => (plan.proved ? { ...plan, proved: plan.proved.filter((x) => existsSync(join(p.folder, x.file))) } : plan);

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

  /** The settings, model and provider for a chat; with a session, the provider counts that chat's spend. Only the global limit stops a chat. */
  const settingsFor = (session?: ChatSession, ctl?: AbortController) => {
    const s = d.readSettings();
    const model = s.models[s.provider];
    if (!model) throw new Error("Choose a model in Setup first.");
    let provider = d.makeProvider(s);
    if (session) {
      const { meter, price } = d.newMeter(s, model, session.costUsd ?? 0, false);
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
    /** A verifier's acceptance goes on the plan's Proved list, straight from the outcome, and the person sees it at once. */
    const noteProved = async (o: ToolOutcome): Promise<ToolOutcome> => {
      const found = provedBy(o);
      if (found) {
        const next = recordProved(await planOf(p), provedEntry(p, found, Date.now()));
        await writePlan(p.folder, next);
        plans.set(p.id, next);
        send({ sessionId: session.id, plan: shown(p, next), projectId: p.id });
      }
      return o;
    };
    const exec = async (call: ToolCall, sub = false): Promise<ToolOutcome> => noteProved(await execRaw(call, sub));
    const execRaw = async (call: ToolCall, sub = false): Promise<ToolOutcome> =>
      execute(call, {
        root: p.folder,
        extra: sub
          ? undefined
          : (c) =>
              c.name === "plan_update"
                ? (async () => {
                    const next = normalizePlan(c.args, await planOf(p));
                    await writePlan(p.folder, next);
                    plans.set(p.id, next);
                    send({ sessionId: session.id, plan: shown(p, next), projectId: p.id });
                    return `The plan now has ${next.steps.length} step${next.steps.length === 1 ? "" : "s"}; the person sees it beside the chat.`;
                  })()
                : c.name === "open_pr"
                ? openPr(p.id, session.id, String(c.args.title ?? "").trim() || session.title, typeof c.args.summary === "string" ? c.args.summary : undefined).then(
                    (r) => `Opened ${r.url}${r.createdRepo ? ` (in the new private repository ${r.repo})` : ""}.`,
                  )
                : (plugins.call(session.id, c.name, c.args, ctl.signal) ?? extra?.(c)),
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
        // Auto mode, read at each call: switching it on lets protected calls through without asking.
        policy: sub ? {} : session.auto ? ALLOW_ALL : s.approvals,
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
        startProof: async (problem, mode, path) => {
          send({ sessionId: session.id, event: { type: "status", message: `A ${mode === "search" ? "search-tree" : "single-agent"} proof run is going…` } });
          const record = await d.runProof(
            problem,
            mode,
            (ev) => {
              if (ev.type === "status") send({ sessionId: session.id, event: { type: "status", message: ev.message } });
            },
            { projectId: session.projectId, file: path },
          );
          const solved = record.events.find((x): x is Extract<RunEvent, { type: "solved" }> => x.type === "solved");
          return solved
            ? `verified: the strict verifier accepted a proof (run ${record.id} in History; axioms: ${solved.axioms.join(", ") || "none"}):\n\`\`\`lean\n${solved.proof}\`\`\``
            : `no verified proof (run ${record.id} in History): ${record.message}`;
        },
      });

    let failed = false;
    void (async () => {
      try {
        await runTurn(session, {
          provider,
          model,
          projectName: p.name,
          memory: (await readMemory(memory)).index,
          plan: ((loaded: Plan) => () => planPrompt(plans.get(p.id) ?? loaded))(await planOf(p)),
          auto: () => session.auto === true,
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
        failed = true;
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
        else if (!failed && !ctl.signal.aborted && session.auto) void continueAuto(p, session);
        else void afterTurn(p.id, session);
      }
    })();
  }

  /** How many turns auto mode has started in a row for each chat; the person's own message resets it. */
  const autoTurns = new Map<string, number>();

  /** Auto mode: after a turn, start the next one while the plan has open steps, within a bound. */
  async function continueAuto(p: Project, session: ChatSession): Promise<void> {
    const stop = (why: string) => {
      autoTurns.delete(session.id);
      send({ sessionId: session.id, autoStopped: why });
      void afterTurn(p.id, session);
    };
    const n = (autoTurns.get(session.id) ?? 0) + 1;
    if (n > MAX_AUTO_TURNS) return stop(`Auto mode paused after ${MAX_AUTO_TURNS} turns in a row. Send a message to keep going.`);
    const plan = await planOf(p);
    const open = plan.steps.filter((x) => x.status === "todo" || x.status === "doing");
    // Without a plan yet, the first auto turn makes one; afterwards an empty list of open steps means the work is done.
    if (plan.steps.length > 0 && open.length === 0) return stop("Auto mode: every plan step is done, stuck or dropped.");
    const fresh = loadSession(p.id, session.id);
    if (!fresh?.auto || live.has(session.id)) return;
    autoTurns.set(session.id, n);
    await new Promise((r) => setTimeout(r, 1500));
    if (live.has(session.id) || !loadSession(p.id, session.id)?.auto) return;
    fresh.messages.push({
      role: "user",
      at: Date.now(),
      source: "auto",
      content: plan.steps.length
        ? `Continue with the plan: take the next open step (${open[0].id}: ${open[0].title}), or the most useful one, and report briefly.`
        : "Make a plan for this problem with plan_update, then start on its first step.",
    });
    saveSession(fresh);
    try {
      startTurn(p.id, fresh);
    } catch (err) {
      send({ sessionId: session.id, event: { type: "error", message: `Auto mode stopped: ${(err as Error).message}` } });
    }
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
    const clean = cleanName(name, "problem");
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

  /** How this problem's chats reached the proof of one statement file. */
  ipcMain.handle("plan:path", (_e, projectId: string, file: string): ProofPath => {
    const p = project(projectId);
    if (typeof file !== "string" || !file) throw new Error("no file");
    const sessions = readdirSync(sessionsDir(p.id))
      .filter((f) => f.endsWith(".json"))
      .map((f) => loadSession(p.id, f.slice(0, -5))?.messages ?? []);
    return proofPath(sessions, file.replace(/\\/g, "/"));
  });

  /** A statement Lean accepted in this problem, with the proof it accepted, found in the proof run or the chats. */
  const acceptedProof = async (projectId: string, file: string) => {
    const p = project(projectId);
    const rel = String(file).replace(/\\/g, "/");
    const proved = (await planOf(p)).proved?.find((x) => x.file === rel);
    if (!proved) throw new Error("Lean has not accepted a proof of that file in this problem.");
    const statement = readFileSync(await confine(p.folder, rel), "utf8");
    let proof: string | undefined;
    const sessions = readdirSync(sessionsDir(p.id))
      .filter((f) => f.endsWith(".json"))
      .map((f) => loadSession(p.id, f.slice(0, -5))?.messages ?? []);
    const path = proofPath(sessions, rel);
    if (proved.how === "proof_run" && proved.proof && /^\d+$/.test(proved.proof)) {
      try {
        const run = JSON.parse(readFileSync(d.userData("runs", `${proved.proof}.json`), "utf8")) as RunRecord;
        proof = run.events.find((x): x is Extract<RunEvent, { type: "solved" }> => x.type === "solved")?.proof;
      } catch {
        // The run was deleted from History.
      }
    }
    proof ??= path.proof;
    if (!proof) throw new Error("The accepted proof is no longer in this problem's chats or proof runs. Prove it again first.");
    return { p, rel, proved, statement, proof, path };
  };

  /** What sharing one proved statement with the community would publish, built locally; nothing is sent. */
  const communityDraft = async (projectId: string, file: string) => {
    const { p, rel, proved, statement, proof, path } = await acceptedProof(projectId, file);
    const meta: EntryMeta = {
      theorem: proved.theorem ?? basename(rel, ".lean"),
      summary: proved.summary,
      problem: p.name,
      contributor: "",
      verifiedBy: proved.how,
      ...(path.steps.length ? { attempts: path.steps.filter((s) => s.kind === "draft").length, rejected: path.steps.filter((s) => s.kind === "verify" && s.ok === false).length } : {}),
      sharedAt: new Date().toISOString(),
    };
    return { statement, proof, meta, slug: entrySlug(meta.theorem) };
  };

  ipcMain.handle("community:preview", async (_e, projectId: string, file: string) => {
    const c = await communityDraft(projectId, file);
    return { slug: c.slug, theorem: c.meta.theorem, summary: c.meta.summary, statement: c.statement, proof: c.proof, repo: `${COMMUNITY_REPO.owner}/${COMMUNITY_REPO.repo}`, dir: COMMUNITY_DIR };
  });

  ipcMain.handle("community:share", async (_e, projectId: string, file: string) => {
    const c = await communityDraft(projectId, file);
    const token = await d.githubToken();
    if (!token) throw new Error("Connect GitHub first: Settings → GitHub, or log in with the GitHub CLI (gh auth login).");
    return openCommunityPr(token, { ...COMMUNITY_REPO, dir: COMMUNITY_DIR }, c.slug, (slug, login) => {
      const meta = { ...c.meta, contributor: login };
      const entry = buildEntry({ slug, statement: c.statement, proof: c.proof, meta });
      return { files: entry.files, title: `Community proof: ${meta.theorem}`, body: communityPrBody(entry, meta) };
    });
  });

  /** Every result this problem has proved that still has its file and its accepted proof, oldest first. */
  const allAccepted = async (projectId: string) => {
    const p = project(projectId);
    const proved = shown(p, await planOf(p)).proved ?? [];
    const items: { file: string; theorem?: string; summary?: string; proof: string }[] = [];
    for (const x of proved) {
      const a = await acceptedProof(projectId, x.file).catch(() => null);
      if (a) items.push({ file: a.rel, theorem: a.proved.theorem, summary: a.proved.summary, proof: a.proof });
    }
    if (!items.length) throw new Error("Nothing in this problem has a proof Lean accepted yet.");
    return { p, items, proofs: Object.fromEntries(items.map((i) => [i.file, i.proof])) as Record<string, string> };
  };

  /** The saved walkthrough of one proved statement, or of the whole problem (`*`), when it matches the proofs as they are now. */
  ipcMain.handle("showme:get", async (_e, projectId: string, file: string) => {
    if (file === "*") {
      const { p, items, proofs } = await allAccepted(projectId);
      const saved = await readWalkthrough(p.folder, "*");
      return { proof: "", theorem: undefined, summary: `${items.length} proved results, together`, saved: saved && saved.proofHash === proofsHash(proofs) ? saved : null };
    }
    const a = await acceptedProof(projectId, file);
    const saved = await readWalkthrough(a.p.folder, a.rel);
    return { proof: a.proof, theorem: a.proved.theorem, summary: a.proved.summary, saved: saved && saved.proofHash === proofHash(a.proof) ? saved : null };
  });

  /** Write a walkthrough with the chat's model, of one proved statement or of the whole problem (`*`), and keep it in the problem folder. */
  ipcMain.handle("showme:make", async (_e, projectId: string, file: string) => {
    const { s, model } = settingsFor();
    const { meter, price } = d.newMeter(s, model, 0, false);
    const provider = metered(d.makeProvider(s), price, meter);
    const ask = async (system: string, request: string, lines: number | Record<string, number>, maxTokens: number): Promise<Walkthrough> => {
      let last = "";
      for (let attempt = 0; attempt < 2; attempt++) {
        const r = await provider.chat({
          model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: attempt ? `${request}\n\nYour last reply was not a valid JSON walkthrough (${last}). Reply with the JSON object only.` : request },
          ],
          maxTokens,
          temperature: 0.3,
          reasoningEffort: "low",
        });
        try {
          return parseWalkthrough(r.content, lines);
        } catch (e) {
          last = (e as Error).message;
        }
      }
      throw new Error(`The model could not write a walkthrough: ${last}`);
    };
    if (file === "*") {
      const { p, items, proofs } = await allAccepted(projectId);
      const plan = await planOf(p);
      const lines = Object.fromEntries(items.map((i) => [i.file, i.proof.split(/\r?\n/).length]));
      const walkthrough = await ask(SHOWME_ALL_PROMPT, showmeAllRequest({ question: p.name, goal: plan.goal, items }), lines, 20000);
      const stored: StoredWalkthrough = { file: "*", proofHash: proofsHash(proofs), proof: "", proofs, model, createdAt: Date.now(), walkthrough };
      await saveWalkthrough(p.folder, stored);
      return stored;
    }
    const a = await acceptedProof(projectId, file);
    const request = showmeRequest({ theorem: a.proved.theorem, summary: a.proved.summary, problem: a.p.name, proof: a.proof });
    const walkthrough = await ask(SHOWME_PROMPT, request, a.proof.split(/\r?\n/).length, 12000);
    const stored: StoredWalkthrough = { file: a.rel, theorem: a.proved.theorem, proofHash: proofHash(a.proof), proof: a.proof, model, createdAt: Date.now(), walkthrough };
    await saveWalkthrough(a.p.folder, stored);
    return stored;
  });

  ipcMain.handle("plan:get", async (_e, projectId: string) => {
    const p = project(projectId);
    return shown(p, await planOf(p));
  });

  ipcMain.handle("projects:rename", (_e, id: string, name: string): Project => {
    const p = { ...project(id), name: cleanName(name, "problem") };
    saveProjects(projects().map((x) => (x.id === p.id ? p : x)));
    return p;
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

  /** Switch auto mode for one chat. Switching it on approves what the chat is already waiting on; an idle chat starts working. */
  ipcMain.handle("sessions:auto", (_e, projectId: string, id: string, on: boolean) => {
    const l = live.get(safeId(id));
    const sess = l?.session ?? loadSession(safeId(projectId), id);
    if (!sess) throw new Error("no such chat");
    sess.auto = on === true;
    saveSession(sess);
    autoTurns.delete(sess.id);
    if (sess.auto) {
      for (const w of [...pending.values()]) if (w.approval.sessionId === sess.id) w.resolve(true);
      if (!l) void continueAuto(project(sess.projectId), sess);
    }
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
    // Refuse before anything is stored when the global limit is reached.
    const { s: st, model: md } = settingsFor();
    d.newMeter(st, md, pre?.costUsd ?? 0, false);
    const attachments = await Promise.all((opts.attachments ?? []).map((a) => attachment(p.folder, a)));
    const message: StoredMessage = { role: "user", content: text, at: Date.now(), source: "person", ...(attachments.length ? { attachments } : {}) };
    if (sessionId) autoTurns.delete(sessionId);
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
      ...(opts.auto ? { auto: true } : {}),
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

  /** Commit the project's changes and open a PR, its description stating what the strict verifier accepts now. */
  async function openPr(projectId: string, sessionId: string | undefined, title: string, summary?: string): Promise<PullRequest> {
    const p = project(projectId);
    const token = await d.githubToken();
    if (!token) throw new Error("Connect GitHub first: Settings → GitHub, or log in with the GitHub CLI (gh auth login).");
    if (!(await initRepo(p.folder))) throw new Error("Git is not installed: install it from https://git-scm.com");
    const files = await changes(p.folder);
    if (!files.length) throw new Error("No changes since the last commit: nothing to put in a pull request.");
    const sess = sessionId ? (live.get(sessionId)?.session ?? loadSession(p.id, sessionId)) : null;
    const lean = d.lean(d.readSettings());
    const verdicts: Verdict[] = [];
    if (lean && sess) {
      for (const pair of verifiedPairs(sess.messages)) {
        const result = await verifyFiles(p.folder, pair.statement, pair.proof, lean.run).catch((e: Error) => `not checked: ${e.message}`);
        verdicts.push({ ...pair, result });
      }
    }
    return openProjectPr(p.folder, token, { title, body: prBody({ chat: sess?.title, summary, files, verdicts, lean: !!lean }) });
  }
  ipcMain.handle("github:pr", async (_e, projectId: string, sessionId: string | null, title: string) => openPr(projectId, sessionId ?? undefined, String(title).trim() || "Work from Mack"));
  ipcMain.handle("skills:list", async (_e, projectId: string) => listSkills(project(projectId).folder));

  // Reminders survive a restart: schedule what is still pending.
  for (const p of projects()) for (const r of readReminders(p.id)) schedule(p.id, r);

  return {
    wake,
    project,
    projects,
    adopt: (folder) => projects().find((p) => p.folder === folder) ?? addProject(basename(folder), folder),
    stopAll: () => {
      plugins.stopAll();
      jobs.stopAll();
      for (const l of live.values()) l.ctl.abort();
    },
  };
}
