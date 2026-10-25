// The Electron main process: owns settings, the API key, Lean, setup, run
// history and the model provider. The renderer only sees what preload.ts
// exposes; the key never crosses to it.

import { app, BrowserWindow, dialog, ipcMain, nativeTheme, safeStorage, shell } from "electron";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkFromRun } from "../core/lean/check";
import { hasRepl, replPool, splitHeader, type ReplPool } from "../core/lean/repl";
import { analyzeSketch, type Analysis } from "../core/lean/sketch";
import { leanRunner } from "../core/lean/runner";
import { DEFAULT_WORKSPACE, hasMathlib, hasProject, runSetup, verifyWorkspace, type SetupEvent } from "../core/lean/setup";
import { lakeVersion } from "../core/lean/toolchain";
import { OpenAICompatibleProvider } from "../core/model/openai-compatible";
import { PROVIDERS, providerInfo, type ProviderId } from "../core/model/providers";
import { prove, type ProveEvent } from "../core/prove";
import { search, type SearchEvent } from "../core/search/search";
import { DEFAULT_LIMITS, type Limits } from "../core/search/tree";
import { DEFAULT_ULTRAMATH, problemKind, ultramath, type UltramathEvent, type UltramathLimits } from "../core/ultramath/swarm";
import { checkUpstream } from "../core/upstream";
import { formatUsd, metered, type Meter, type Price } from "../core/model/metered";
import { Ledger, type Period } from "../core/model/ledger";
import type { ModelProvider } from "../core/model/provider";
import { registerChat } from "./chat";
import { RunManager, type Problem, type RunStatus } from "../core/search/runs";
import { RUN_TOOLS } from "../core/search/run-tools";
import { CHAT_TOOLS as SWARM_CHAT_TOOLS, SwarmService } from "../core/ultramath/service";
import { confine, registerTools } from "../core/chat/tools";
import { frozenObjection } from "../core/lean/rules";
import { basename } from "node:path";
import { statSync } from "node:fs";
import { registerUpdates } from "./updates";
import { newerMackRelease } from "../core/upstream";
import type { ApprovalPolicy } from "../core/chat/executor";
import type { ReasoningEffort } from "../core/model/provider";

export type Settings = {
  /** The provider runs use; each provider remembers its own model. */
  provider: ProviderId;
  models: Record<ProviderId, string>;
  /** The custom OpenAI-compatible endpoint, such as http://localhost:11434/v1. */
  customBaseUrl: string;
  leanWorkspace: string;
  timeoutMs: number;
  maxAttempts: number;
  /** "single": one agent revises one proof; "search": the proof search tree; "ultramath": a swarm of members. */
  mode: RunMode;
  search: Limits;
  ultramath: UltramathLimits;
  /** Use the resident Lean REPL for quick checks when it is built. */
  useRepl: boolean;
  /** Proof-search workers: the fixed loop, or tool-loop workers in workspaces with the plan board. */
  searchWorker: "fixed" | "tool";
  /** Upstream's completion and sketch analysis on partial nodes (scoring v3). */
  searchAnalysis: boolean;
  /** Problems a proof-search run explores at once. */
  runConcurrency: number;
  /** What the chat may do without asking, per protected tool; absent means ask. */
  approvals: Partial<Record<string, ApprovalPolicy>>;
  /** Models that read images: attachments and `view_image` reach only these. */
  visionModels: string[];
  /** The reasoning effort a new chat starts with. */
  chatEffort: ReasoningEffort;
  /** Offer a likely next message in an empty composer, and title new chats. */
  suggestions: boolean;
  /** USD all of Mack may spend in `globalPeriod`, every session and background call together; 0 means no limit. */
  globalLimit: number;
  globalPeriod: Period;
  /** USD one session (a chat, a proof run, a search run, an Ultramath swarm) may spend; 0 means no cap. */
  maxCostPerSession: number;
  /** Model prices, USD per million tokens, by model id. */
  prices: Record<string, Price>;
  /** Download and install new Mack releases from GitHub. */
  autoUpdate: boolean;
  /** Check Open Math Harness for methodology changes on every launch. */
  upstreamCheck: boolean;
  /** An upstream head the user chose to stay behind; no banner until upstream moves past it. */
  upstreamDismissed: string;
};

export type RunMode = "single" | "search" | "ultramath";

/** What a session has spent, after each priced model call. */
export type SpendEvent = { type: "spend"; usd: number; limit: number; estimated: boolean };

export type RunEvent = ProveEvent | SearchEvent | UltramathEvent | SpendEvent;

export type KeySource = "env" | "saved" | "none";

export type Health = {
  lake: string | null;
  workspace: string;
  hasProject: boolean;
  hasMathlib: boolean;
  hasRepl: boolean;
  provider: ProviderId;
  /** The active provider's key and model. */
  keySource: KeySource;
  model: string;
  providers: { id: ProviderId; keySource: KeySource; model: string; usable: boolean }[];
};

export type RunRecord = {
  id: string;
  startedAt: number;
  finishedAt: number;
  model: string;
  /** USD the run spent, when the model had a price. */
  spentUsd?: number;
  /** Absent on runs recorded before providers were selectable: those used Fireworks. */
  provider?: ProviderId;
  /** Absent on runs recorded before the search tree: those were "single". */
  mode?: RunMode;
  problem: string;
  outcome: "solved" | "failed";
  message: string;
  events: RunEvent[];
};

export type RunSummary = Pick<RunRecord, "id" | "startedAt" | "finishedAt" | "model" | "mode" | "outcome" | "message"> & {
  theorem: string;
  attempts: number;
};

const DEFAULTS: Settings = {
  provider: "fireworks",
  models: { fireworks: "", openrouter: "", custom: "" },
  customBaseUrl: "http://localhost:11434/v1",
  leanWorkspace: DEFAULT_WORKSPACE,
  // A cold first load of Mathlib on Windows can take minutes (antivirus scans every .olean).
  timeoutMs: 600_000,
  maxAttempts: 8,
  mode: "single",
  search: DEFAULT_LIMITS,
  ultramath: DEFAULT_ULTRAMATH,
  approvals: {},
  visionModels: [],
  chatEffort: "medium",
  suggestions: true,
  autoUpdate: true,
  maxCostPerSession: 2,
  globalLimit: 10,
  globalPeriod: "month",
  prices: {},
  useRepl: true,
  searchWorker: "fixed",
  searchAnalysis: true,
  runConcurrency: 1,
  upstreamCheck: true,
  upstreamDismissed: "",
};

const userData = (...p: string[]) => join(app.getPath("userData"), ...p);
const settingsPath = () => userData("settings.json");
const keyPath = (id: ProviderId) => userData(`${id}.key`);
const runsDir = () => {
  const d = userData("runs");
  mkdirSync(d, { recursive: true });
  return d;
};

/** `KEY=value` lines of a `.env` next to the app, for development; never committed (see .gitignore). */
function loadDotEnv(): void {
  const file = join(app.getAppPath(), ".env");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && m[2] && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

function readSettings(): Settings {
  try {
    const saved = JSON.parse(readFileSync(settingsPath(), "utf8")) as Partial<Settings> & { model?: string };
    // Before providers were selectable the one model was a Fireworks model.
    const { model: legacyModel, ...rest } = saved;
    const models = { ...DEFAULTS.models, ...(legacyModel ? { fireworks: legacyModel } : {}), ...saved.models };
    return {
      ...DEFAULTS,
      ...rest,
      models,
      search: { ...DEFAULTS.search, ...saved.search },
      ultramath: { ...DEFAULTS.ultramath, ...saved.ultramath },
      leanWorkspace: saved.leanWorkspace || DEFAULTS.leanWorkspace,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function keySource(id: ProviderId): KeySource {
  return process.env[providerInfo(id).keyEnv] ? "env" : existsSync(keyPath(id)) ? "saved" : "none";
}

/** The environment variable wins; otherwise the key saved in the app, encrypted with the OS keystore. */
function readKey(id: ProviderId): string {
  const env = process.env[providerInfo(id).keyEnv];
  if (env) return env;
  if (!existsSync(keyPath(id))) return "";
  try {
    return safeStorage.decryptString(readFileSync(keyPath(id)));
  } catch {
    return "";
  }
}

/** Whether a provider has what a run needs: a key when it requires one, and a model. */
function usable(s: Settings, id: ProviderId): boolean {
  return !!s.models[id] && (!providerInfo(id).keyRequired || keySource(id) !== "none");
}

/** Every model call Mack makes, charged against the global limit. */
const ledger = new Ledger(userData("spend.json"), () => {
  const s = readSettings();
  return { limit: s.globalLimit, period: s.globalPeriod };
});

const broadcastSpend = () => {
  for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.isDestroyed()) w.webContents.send("spend:global", ledger.state());
};

/** A provider for model calls: every call is priced into the global ledger, and refused once it reaches its limit. */
function makeProvider(s: Settings, id: ProviderId): ModelProvider {
  const base = makeBaseProvider(s, id);
  return metered(base, s.prices[s.models[id]], ledger, { scope: "global", onCharge: broadcastSpend, onCap: broadcastSpend });
}

function makeBaseProvider(s: Settings, id: ProviderId): OpenAICompatibleProvider {
  const info = providerInfo(id);
  const key = readKey(id);
  if (info.keyRequired && !key) throw new Error(`Add your ${info.label} API key in Setup first.`);
  const headers: Record<string, string> = id === "openrouter" ? { "HTTP-Referer": "https://github.com/JorgeOchoaReyes/Mack", "X-Title": "Mack" } : {};
  return new OpenAICompatibleProvider(info.label, info.baseUrl ?? s.customBaseUrl, key, {
    extraHeaders: headers,
    reasoning: id === "openrouter" ? "openrouter" : "openai",
  });
}

const isProvider = (id: unknown): id is ProviderId => PROVIDERS.some((p) => p.id === id);

function theoremOf(problem: string): string {
  return /^theorem\s+([^\s:({[]+)/m.exec(problem)?.[1] ?? "untitled";
}

let proving: AbortController | null = null;
let repl: { pool: ReplPool; key: string } | null = null;

/** Upstream's sketch analysis on the run's REPL pool, or none without the REPL (call after `quickCheck`). */
function sketchFor(frozen: string): ((file: string) => Promise<Analysis>) | undefined {
  const pool = repl?.pool;
  if (!pool) return undefined;
  return (file) => pool.session(splitHeader(file).header, (session) => analyzeSketch(session, frozen, file));
}

/** The quick check for a run: a REPL pool kept alive between runs (Mathlib stays loaded), or none. */
function quickCheck(s: Settings, size: number) {
  if (!s.useRepl || !hasRepl(s.leanWorkspace)) {
    repl?.pool.stop();
    repl = null;
    return undefined;
  }
  const key = `${s.leanWorkspace}|${size}|${s.timeoutMs}`;
  if (repl?.key !== key) {
    repl?.pool.stop();
    repl = { pool: replPool({ workspace: s.leanWorkspace, size, timeoutMs: s.timeoutMs }), key };
  }
  return repl.pool.check;
}
let settingUp: AbortController | null = null;

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: "Mack",
    icon: join(app.getAppPath(), "build", "icon.png"),
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0f0f10" : "#f6f6f3",
    autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  if (process.env.VITE_DEV_SERVER_URL) void win.loadURL(process.env.VITE_DEV_SERVER_URL);
  else void win.loadFile(join(__dirname, "..", "..", "dist", "index.html"));
}

ipcMain.handle("settings:get", () => readSettings());

function writeSettings(patch: Partial<Settings>): Settings {
  const next = { ...readSettings(), ...patch };
  writeFileSync(settingsPath(), JSON.stringify(next, null, 2));
  return next;
}

ipcMain.handle("settings:set", (_e, s: Partial<Settings>) => {
  const next = writeSettings(s);
  broadcastSpend();
  return next;
});

ipcMain.handle("spend:get", () => ledger.state());
ipcMain.handle("spend:reset", () => {
  ledger.reset();
  broadcastSpend();
  return ledger.state();
});

ipcMain.handle("key:set", (_e, id: ProviderId, key: string) => {
  if (!isProvider(id)) throw new Error("unknown provider");
  if (!safeStorage.isEncryptionAvailable()) throw new Error(`OS encryption is unavailable; set ${providerInfo(id).keyEnv} in .env instead`);
  writeFileSync(keyPath(id), safeStorage.encryptString(key.trim()));
  return keySource(id);
});

ipcMain.handle("key:clear", (_e, id: ProviderId) => {
  if (!isProvider(id)) throw new Error("unknown provider");
  rmSync(keyPath(id), { force: true });
  return keySource(id);
});

ipcMain.handle("health:get", async (): Promise<Health> => {
  const s = readSettings();
  return {
    lake: await lakeVersion(s.leanWorkspace),
    workspace: s.leanWorkspace,
    hasProject: hasProject(s.leanWorkspace),
    hasMathlib: hasMathlib(s.leanWorkspace),
    hasRepl: hasRepl(s.leanWorkspace),
    provider: s.provider,
    keySource: providerInfo(s.provider).keyRequired ? keySource(s.provider) : "saved",
    model: s.models[s.provider],
    providers: PROVIDERS.map((p) => ({ id: p.id, keySource: keySource(p.id), model: s.models[p.id], usable: usable(s, p.id) })),
  };
});

ipcMain.handle("workspace:verify", async () => verifyWorkspace(readSettings().leanWorkspace));

ipcMain.handle("workspace:pick", async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showOpenDialog(win!, { properties: ["openDirectory", "createDirectory"], title: "Choose the Lean workspace" });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle("setup:start", async (e) => {
  if (settingUp) throw new Error("setup is already running");
  settingUp = new AbortController();
  const send = (ev: SetupEvent) => {
    if (!e.sender.isDestroyed()) e.sender.send("setup:event", ev);
  };
  try {
    return await runSetup(readSettings().leanWorkspace, send, settingUp.signal);
  } finally {
    settingUp = null;
  }
});

ipcMain.handle("setup:stop", () => settingUp?.abort());

ipcMain.handle("upstream:check", async () => {
  const s = readSettings();
  if (!s.upstreamCheck) return { kind: "off" };
  const report = await checkUpstream();
  if (report.kind === "error") return report;
  // Compare against the installed version: a newer Mack release may already port what changed.
  const release = await newerMackRelease(app.getVersion());
  const withRelease = release ? { ...report, release } : report;
  if (withRelease.kind === "changed" && withRelease.head === s.upstreamDismissed) return { ...withRelease, dismissed: true };
  return withRelease;
});

ipcMain.handle("open:external", (_e, url: string) => {
  if (!/^https:\/\/(github\.com|fireworks\.ai|app\.fireworks\.ai|openrouter\.ai|leanprover-community\.github\.io)\//.test(url)) {
    throw new Error("Mack only opens known links");
  }
  return shell.openExternal(url);
});

ipcMain.handle("models:list", async (_e, id?: ProviderId) => {
  const s = readSettings();
  const provider = makeBaseProvider(s, isProvider(id) ? id : s.provider);
  const models = await provider.listModels();
  // A catalogue that publishes prices fills in the ones the person has not set.
  const published = await provider.listPrices().catch(() => ({}));
  const missing = Object.fromEntries(Object.entries(published).filter(([m]) => !s.prices[m]));
  if (Object.keys(missing).length) writeSettings({ prices: { ...s.prices, ...missing } });
  return models;
});

/** A session's meter, refusing to start when a cap is set and the model has no price (its spend could not be counted). */
function newMeter(s: Settings, model: string, spent = 0): { meter: Meter; price: Price | undefined } {
  const price = s.prices[model];
  if ((s.maxCostPerSession > 0 || s.globalLimit > 0) && !price) throw new Error(`Set the price of ${model} in Setup → Model (the spending limits need it), or turn the limits off in Settings.`);
  if (s.globalLimit > 0 && ledger.spent >= s.globalLimit)
    throw new Error(`The global spending limit (${formatUsd(s.globalLimit)}${s.globalPeriod === "total" ? "" : ` per ${s.globalPeriod}`}) is reached. Raise or reset it in Settings → Spending.`);
  return { meter: { spent, limit: s.maxCostPerSession, estimated: false }, price };
}

/** One proof run in the given mode, recorded in the run history. Shared by the Prove screen and the chat's `start_proof`. */
async function runProof(problem: string, mode: RunMode, forward: (ev: RunEvent) => void): Promise<RunRecord> {
  if (proving) throw new Error("a proof run is already in progress");
  const s = { ...readSettings(), mode };
  const model = s.models[s.provider];
  if (!model) throw new Error(`Choose a ${providerInfo(s.provider).label} model in Setup first.`);
  const needsLean = s.mode !== "ultramath" || problemKind(problem) === "lean";
  if (needsLean && !hasProject(s.leanWorkspace)) throw new Error("Install Lean and Mathlib in Setup first.");
  const { meter, price } = newMeter(s, model);
  const ctl = new AbortController();
  let capped = "";
  const provider = metered(makeProvider(s, s.provider), price, meter, {
    onCharge: (m) => send({ type: "spend", usd: m.spent, limit: m.limit, estimated: m.estimated }),
    onCap: (why) => {
      capped = why;
      ctl.abort();
    },
  });
  proving = ctl;
  const record: RunRecord = {
    id: `${Date.now()}`,
    startedAt: Date.now(),
    finishedAt: 0,
    model,
    provider: s.provider,
    mode: s.mode,
    problem,
    outcome: "failed",
    message: "",
    events: [],
  };
  const send = (ev: RunEvent) => {
    if (ev.type !== "status") record.events.push(ev);
    if (ev.type === "solved" || ev.type === "accepted") record.outcome = "solved";
    if (ev.type === "failed") {
      if (capped) ev = { ...ev, message: `Stopped: ${capped}.` };
      record.message = ev.message;
    }
    if (ev.type === "spend") record.spentUsd = ev.usd;
    forward(ev);
  };
  try {
    const run = leanRunner({ workspace: s.leanWorkspace, timeoutMs: s.timeoutMs });
    if (s.mode === "ultramath") {
      const lean = needsLean ? { run, check: quickCheck(s, 2) ?? (async (src: string) => checkFromRun(await run(src))) } : {};
      await ultramath({ problem, provider, model, ...lean, limits: s.ultramath, signal: proving.signal, onEvent: send });
    } else if (s.mode === "search") {
      // Up to two REPLs for parallel workers: each holds Mathlib in memory.
      const check = quickCheck(s, Math.min(2, s.search.w)) ?? (async (src: string) => checkFromRun(await run(src)));
      await search({
        frozen: problem,
        provider,
        model,
        run,
        check,
        limits: s.search,
        analysis: s.searchAnalysis,
        sketch: sketchFor(problem),
        worker: s.searchWorker,
        workspace: userData("prove-workspaces", record.id),
        signal: proving.signal,
        onEvent: send,
      });
    } else {
      await prove({
        frozen: problem,
        provider,
        model,
        run,
        check: quickCheck(s, 1),
        maxAttempts: s.maxAttempts,
        signal: proving.signal,
        onEvent: send,
      });
    }
  } finally {
    proving = null;
    record.finishedAt = Date.now();
    writeFileSync(join(runsDir(), `${record.id}.json`), JSON.stringify(record));
  }
  return record;
}

ipcMain.handle("prove:start", async (e, problem: string) => {
  const record = await runProof(problem, readSettings().mode, (ev) => {
    if (!e.sender.isDestroyed()) e.sender.send("prove:event", ev);
  });
  return record.id;
});

ipcMain.handle("prove:stop", () => proving?.abort());

ipcMain.handle("runs:list", (): RunSummary[] =>
  readdirSync(runsDir())
    .filter((f) => f.endsWith(".json"))
    .flatMap((f) => {
      try {
        const r = JSON.parse(readFileSync(join(runsDir(), f), "utf8")) as RunRecord;
        const { events, problem, ...rest } = r;
        const attempts = events.filter((x) => x.type === "attempt" || x.type === "node" || x.type === "turn").length;
        return [{ ...rest, theorem: theoremOf(problem), attempts }];
      } catch {
        return [];
      }
    })
    .sort((a, b) => b.startedAt - a.startedAt),
);

ipcMain.handle("runs:get", (_e, id: string): RunRecord | null => {
  if (!/^\d+$/.test(id)) return null;
  const f = join(runsDir(), `${id}.json`);
  return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as RunRecord) : null;
});

ipcMain.handle("runs:delete", (_e, id: string) => {
  if (/^\d+$/.test(id)) rmSync(join(runsDir(), `${id}.json`), { force: true });
});

ipcMain.handle("file:saveLean", async (e, name: string, text: string) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showSaveDialog(win!, { defaultPath: `${name}.lean`, filters: [{ name: "Lean", extensions: ["lean"] }] });
  if (r.canceled || !r.filePath) return false;
  writeFileSync(r.filePath, text, "utf8");
  return true;
});

ipcMain.handle("file:openLean", async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showOpenDialog(win!, { properties: ["openFile"], filters: [{ name: "Lean", extensions: ["lean"] }] });
  return r.canceled ? null : readFileSync(r.filePaths[0], "utf8");
});

registerUpdates(() => readSettings().autoUpdate);

const runMeters = new Map<string, { meter: Meter; price: Price | undefined }>();

/** Who started a run from a chat, to wake that chat when the run ends. */
const runOwners = new Map<string, { projectId: string; sessionId: string }>();

const runs = new RunManager(
  userData("discovery"),
  async ({ problem, task, workspace, resume, journal, onEvent, signal }) => {
    const s = readSettings();
    if (!hasProject(s.leanWorkspace)) throw new Error("Install Lean and Mathlib in Setup first.");
    const run = leanRunner({ workspace: s.leanWorkspace, timeoutMs: s.timeoutMs });
    const check = quickCheck(s, Math.min(2, task.limits.w * Math.max(1, task.concurrency))) ?? (async (src: string) => checkFromRun(await run(src)));
    // One meter per run, across its problems and its resumes.
    let m = runMeters.get(task.name);
    if (!m) runMeters.set(task.name, (m = newMeter(s, s.models[s.provider], runs.status(task.name).spentUsd ?? 0)));
    const meter = m;
    await search({
      frozen: problem.frozen,
      problem: problem.id,
      provider: metered(makeProvider(s, s.provider), meter.price, meter.meter, {
        onCharge: (x) => runs.recordSpend(task.name, x.spent),
        onCap: () => {
          // Several workers can hit the cap at once; the first stop is the one that counts.
          try {
            runs.stop(task.name);
          } catch {
            // Already stopping.
          }
        },
      }),
      model: s.models[s.provider],
      run,
      check,
      limits: task.limits,
      analysis: task.analysis,
      sketch: sketchFor(problem.frozen),
      worker: task.worker,
      workspace,
      resume,
      journal,
      signal,
      onEvent,
    });
  },
  (status) => {
    runMeters.delete(status.name);
    const owner = runOwners.get(status.name);
    if (!owner) return;
    runOwners.delete(status.name);
    const lines = status.problems.map((p) => `${p.id}: ${p.state}${p.state === "solved" ? " (verified)" : ""}, ${p.nodes} node(s), best ${p.best.toFixed(2)}`);
    chat.wake(owner.projectId, owner.sessionId, "job", `Proof-search run ${status.name} ${status.state}.\n${lines.join("\n")}`);
  },
);

registerTools(RUN_TOOLS);
registerTools(SWARM_CHAT_TOOLS);

const swarmMeters = new Map<string, { meter: Meter; price: Price | undefined }>();

const swarms: SwarmService = new SwarmService({
  provider: (swarm) => {
    const s = readSettings();
    const model = s.models[s.provider];
    let m = swarmMeters.get(swarm);
    if (!m) swarmMeters.set(swarm, (m = newMeter(s, model)));
    return { provider: metered(makeProvider(s, s.provider), m.price, m.meter, { onCap: (why) => swarms.capReached(swarm, why) }), model };
  },
  lean: () => {
    const s = readSettings();
    if (!hasProject(s.leanWorkspace)) return undefined;
    const run = leanRunner({ workspace: s.leanWorkspace, timeoutMs: s.timeoutMs });
    return { run, check: quickCheck(s, 2) ?? undefined };
  },
  wake: (projectId, sessionId, text) => chat.wake(projectId, sessionId, "job", text),
});

const chat = registerChat({
  userData,
  readSettings,
  makeProvider: (s) => makeProvider(s, s.provider),
  newMeter,
  lean: (s) => {
    if (!hasProject(s.leanWorkspace)) return undefined;
    const run = leanRunner({ workspace: s.leanWorkspace, timeoutMs: s.timeoutMs });
    return { run, check: quickCheck(s, 1) };
  },
  runProof,
  extraTools: ({ projectId, root, sessionId }) => (call) => runTool(call, { projectId, root, sessionId }) ?? swarmTool(call, { projectId, root, sessionId }),
});

// Swarms that were running when Mack last stopped are recorded as interrupted, ready to resume.
for (const p of chat.projects()) swarms.markInterrupted(p.folder);

/** The chat's `ultramath_*` tools; the swarm is the chat's, named by the session, never by an argument. */
function swarmTool(call: { name: string; args: Record<string, unknown> }, ctx: { projectId: string; root: string; sessionId: string }): Promise<string> | undefined {
  const a = call.args;
  const now = (f: () => string) => (async () => f())();
  switch (call.name) {
    case "ultramath_start":
      return now(() => swarms.start(ctx.projectId, ctx.root, ctx.sessionId, a));
    case "ultramath_status":
      return now(() => swarms.status(ctx.sessionId, a.swarm));
    case "ultramath_verdict":
      return now(() => swarms.verdict(ctx.sessionId, a));
    case "ultramath_records":
      return now(() => swarms.records(ctx.sessionId, a));
    case "ultramath_stop":
      return now(() => swarms.stop(ctx.sessionId, a.swarm));
    case "ultramath_resume":
      return now(() => swarms.resume(ctx.projectId, ctx.root, ctx.sessionId, a));
    default:
      return undefined;
  }
}

ipcMain.handle("swarms:records", (_e, projectId: string, sessionId: string) => swarms.recordsFor(chat.project(projectId).folder, sessionId));

/** The chat's `discovery_*` tools: start, watch, stop and resume proof-search runs of the chat's project. */
function runTool(call: { name: string; args: Record<string, unknown> }, ctx: { projectId: string; root: string; sessionId: string }): Promise<string> | undefined {
  const a = call.args;
  const name = () => {
    if (typeof a.run !== "string" || !a.run) throw new Error("`run` names the run");
    const st = runs.status(a.run);
    if (st.project !== ctx.projectId) throw new Error(`no run named ${a.run} in this project`);
    return a.run;
  };
  const fmt = (st: RunStatus) =>
    `${st.name}: ${st.state}\n${st.problems.map((p) => `- ${p.id}: ${p.state}, ${p.nodes} node(s), best score ${p.best.toFixed(2)}${p.message ? ` — ${p.message.slice(0, 200)}` : ""}`).join("\n")}${
      st.failureReasons.length ? `\nWhat keeps going wrong:\n${st.failureReasons.map((f) => `- ${f.count}× ${f.reason}`).join("\n")}` : ""
    }`;
  switch (call.name) {
    case "discovery_start":
      return (async () => {
        const s = readSettings();
        const paths = Array.isArray(a.problems) ? a.problems.filter((x): x is string => typeof x === "string") : typeof a.problems === "string" ? [a.problems] : [];
        if (!paths.length) throw new Error("`problems` lists .lean files (or folders of them) of the project");
        const problems: Problem[] = [];
        for (const p of paths) {
          const full = await confine(ctx.root, p);
          const files = statSync(full).isDirectory() ? readdirSync(full).filter((f) => f.endsWith(".lean")).map((f) => join(full, f)) : [full];
          for (const f of files) problems.push({ id: basename(f, ".lean").replace(/[^a-zA-Z0-9._-]/g, "_"), frozen: readFileSync(f, "utf8") });
        }
        for (const p of problems) {
          const objection = frozenObjection(p.frozen);
          if (objection) throw new Error(`${p.id} is not a usable frozen file: ${objection}`);
        }
        newMeter(s, s.models[s.provider]);
        const limits = { ...s.search, ...(typeof a.width === "number" ? { w: a.width } : {}), ...(typeof a.rounds === "number" ? { k1: a.rounds } : {}) };
        const runName = typeof a.run === "string" && a.run ? a.run : `run-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}`;
        const st = runs.start({ name: runName, project: ctx.projectId, problems, limits, worker: a.worker === "tool" || a.worker === "fixed" ? a.worker : s.searchWorker, concurrency: Math.max(1, Math.min(4, Number(a.concurrency) || s.runConcurrency)), analysis: s.searchAnalysis });
        runOwners.set(st.name, { projectId: ctx.projectId, sessionId: ctx.sessionId });
        return `started run ${st.name} on ${problems.length} problem(s): ${problems.map((p) => p.id).join(", ")}. It runs on its own; this chat is told when it ends. Set a reminder to check discovery_status meanwhile.`;
      })();
    case "discovery_status":
      return (async () => fmt(runs.status(name())))();
    case "discovery_list":
      return (async () => runs.list(ctx.projectId).map((st) => `${st.name}: ${st.state}, ${st.problems.length} problem(s), ${st.problems.filter((p) => p.state === "solved").length} solved`).join("\n") || "no runs in this project")();
    case "discovery_tree":
      return (async () => {
        const nodes = runs.tree(name(), String(a.problem ?? ""));
        return nodes.map((n) => `node ${n.id}${n.parent === null ? " (root)" : ` ← ${n.parent}`}: ${n.status}, score ${n.score.toFixed(2)}, ${n.sorries} sorry, ${n.errors} error(s)${n.approach ? ` — ${n.approach.slice(0, 120)}` : ""}`).join("\n");
      })();
    case "discovery_stop":
      return (async () => (runs.stop(name()), `stopping ${a.run}`))();
    case "discovery_resume":
      return (async () => {
        const st = runs.resume(name());
        runOwners.set(st.name, { projectId: ctx.projectId, sessionId: ctx.sessionId });
        return `resumed ${st.name}; this chat is told when it ends.`;
      })();
    default:
      return undefined;
  }
}

ipcMain.handle("discovery:list", () => runs.list());
ipcMain.handle("discovery:status", (_e, run: string) => runs.status(run));
ipcMain.handle("discovery:tree", (_e, run: string, problem: string) => runs.tree(run, problem));
ipcMain.handle("discovery:stop", (_e, run: string) => runs.stop(run));
ipcMain.handle("discovery:resume", (_e, run: string) => runs.resume(run));
ipcMain.handle("discovery:startFiles", async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showOpenDialog(win!, { properties: ["openFile", "multiSelections"], filters: [{ name: "Lean", extensions: ["lean"] }], title: "Problems for a proof-search run" });
  if (r.canceled || !r.filePaths.length) return null;
  const s = readSettings();
  newMeter(s, s.models[s.provider]);
  const problems: Problem[] = r.filePaths.map((f) => ({ id: basename(f, ".lean").replace(/[^a-zA-Z0-9._-]/g, "_"), frozen: readFileSync(f, "utf8") }));
  for (const p of problems) {
    const objection = frozenObjection(p.frozen);
    if (objection) throw new Error(`${p.id} is not a usable frozen file: ${objection}`);
  }
  return runs.start({ name: `run-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`, project: "", problems, limits: s.search, worker: s.searchWorker, concurrency: s.runConcurrency, analysis: s.searchAnalysis });
});

loadDotEnv();
void app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
app.on("will-quit", () => {
  runs.stopAll();
  swarms.stopAll();
  repl?.pool.stop();
  chat.stopAll();
});
