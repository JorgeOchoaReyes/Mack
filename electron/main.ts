// The Electron main process: owns settings, the API key, Lean, setup, run
// history and the model provider. The renderer only sees what preload.ts
// exposes; the key never crosses to it.

import { app, BrowserWindow, dialog, ipcMain, nativeTheme, safeStorage, shell } from "electron";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { dirname, join } from "node:path";
import { checkFromRun } from "../core/lean/check";
import { hasRepl, replPool, splitHeader, type ReplPool } from "../core/lean/repl";
import { analyzeSketch, type Analysis } from "../core/lean/sketch";
import { leanBudget, leanRunner, setLeanSlots, splitBudget } from "../core/lean/runner";
import { DEFAULT_WORKSPACE, hasMathlib, hasProject, runSetup, verifyWorkspace, type SetupEvent } from "../core/lean/setup";
import { lakeVersion } from "../core/lean/toolchain";
import { OpenAICompatibleProvider } from "../core/model/openai-compatible";
import { PROVIDERS, providerInfo, type ProviderId } from "../core/model/providers";
import { ghCliToken, githubLogin, openCommunityPr, pullState, type GitHubTokenSource } from "../core/github";
import { COMMUNITY_REPO } from "../core/community";
import { prove, type ProveEvent } from "../core/prove";
import { lemmaSource, type Lemma } from "../core/prepare";
import { describeDecls, describePremises, MathlibIndex, mathlibRev, mathlibSource, nameHints, renameFor, premises, searchDecls } from "../core/lean/mathlib-index";
import { describeEnvironment, probeEnvironment } from "../core/environment";
import { readPlan } from "../core/chat/plan";
import { search, type SearchEvent } from "../core/search/search";
import { DEFAULT_LIMITS, type Limits } from "../core/search/tree";
import { DEFAULT_ULTRAMATH, problemKind, ultramath, type UltramathEvent, type UltramathLimits } from "../core/ultramath/swarm";
import { checkUpstream } from "../core/upstream";
import { diagnosticsText, issueUrl, openIssues, type Diagnostics, type FeedbackKind } from "../core/feedback";
import os from "node:os";
import { ASSUMED_PRICE, formatUsd, metered, priceFor, type Meter, type Price } from "../core/model/metered";
import { Ledger, type Period } from "../core/model/ledger";
import type { ModelProvider } from "../core/model/provider";
import { registerChat } from "./chat";
import { RunManager, type Problem, type RunStatus } from "../core/search/runs";
import { RUN_TOOLS } from "../core/search/run-tools";
import { CHAT_TOOLS as SWARM_CHAT_TOOLS, SwarmService } from "../core/ultramath/service";
import { confine, registerTools } from "../core/chat/tools";
import { CONSTRUCT_TOOLS, ConstructionService } from "../core/construct/service";
import { extractStatement, frozenObjection } from "../core/lean/rules";
import { basename } from "node:path";
import { statSync } from "node:fs";
import { registerUpdates } from "./updates";
import { remoteLean, setRemoteLean } from "../core/lean/remote";
import { describeExamples, ProofStore, trainingData } from "../core/proof-store";
import { decompose } from "../core/decompose";
import { stepSearch } from "../core/stepsearch";
import { helperLemmas, relevantLemmas } from "../core/bench/pool";
import { easierVersions } from "../core/variants";
import { attemptKind, attemptsDataset, harnessOf, BENCH_SETS, BENCH_SHARE_DIR, benchReport, benchSet, benchShare, benchSlug, classifyFailure, LOG_LIMITS, splitReply, type AttemptLog, type BenchEnv, pickSample, runBench, type AttemptNote, type BenchEvent, type BenchResult, type BenchRun } from "../core/bench/bench";
import { newerMackRelease, UPSTREAM } from "../core/upstream";
import type { ApprovalPolicy } from "../core/chat/executor";
import type { ReasoningEffort } from "../core/model/provider";

export type Settings = {
  /** The provider runs use; each provider remembers its own model. */
  provider: ProviderId;
  models: Record<ProviderId, string>;
  /** The custom OpenAI-compatible endpoint, such as http://localhost:11434/v1. */
  customBaseUrl: string;
  /** The LiteLLM proxy, such as http://localhost:4000/v1. */
  litellmBaseUrl: string;
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
  /** Before proving: try to break the statement with Lean's random tester. */
  checkStatement: boolean;
  /** Before proving: have the model plan the proof in words, which every attempt is given. */
  proofIdea: boolean;
  /** Single mode: independent chains of attempts run at once, sharing the attempt budget. */
  parallelAttempts: number;
  /** What the chat may do without asking, per protected tool; absent means ask. */
  approvals: Partial<Record<string, ApprovalPolicy>>;
  /** Models that read images: attachments and `view_image` reach only these. */
  visionModels: string[];
  /** The reasoning effort a new chat starts with. */
  chatEffort: ReasoningEffort;
  /** Offer a likely next message in an empty composer, and title new chats. */
  suggestions: boolean;
  /** New chats start on Autopilot: the assistant works end to end on what it is asked, without stopping to ask. */
  autopilotNewChats: boolean;
  /** How many Lean processes (each holds Mathlib, about 5–6 GB) may run at once; 0 picks from this computer's memory. */
  maxLeanProcesses: number;
  /** A model trained for Lean that writes the proof attempts (empty: the main model writes them). */
  proverProvider: ProviderId;
  proverModel: string;
  /** Feedback rounds an attempt chain gets before it starts over fresh (0: never). */
  revisionsPerChain: number;
  /** Try Lean's automation on the statement and on every `sorry` an attempt leaves. */
  leanAutomation: boolean;
  /** Show attempts verified proofs of similar statements from earlier runs. */
  reuseProofs: boolean;
  /** Decompose mode: how many levels a step may be split again, attempts per statement before splitting, and splits tried per statement. */
  decomposeDepth: number;
  decomposeAttempts: number;
  decomposeRounds: number;
  /** Before the attempts, prove easier versions of the statement and offer them as lemmas. */
  easierFirst: boolean;
  /** Premise selection: give every attempt the Mathlib theorems the statement's concepts point to. */
  premiseSelection: boolean;
  /** Lean on another machine over SSH (empty host: Lean runs here). */
  remoteLean: { host: string; workspace: string; repl: boolean; processes: number };
  /** USD all of Mack may spend in `globalPeriod`, every session and background call together; 0 means no limit. */
  globalLimit: number;
  globalPeriod: Period;
  /** USD one session (a chat, a proof run, a search run, an Ultramath swarm) may spend; 0 means no cap. */
  maxCostPerSession: number;
  /** Model prices, USD per million tokens, by model id. */
  prices: Record<string, Price>;
  /** The price counted for a model with none entered: high, so limits stop an unpriced model early. */
  assumedPrice: Price;
  /** Download and install new Mack releases from GitHub. */
  autoUpdate: boolean;
  /** Check Open Math Harness for methodology changes on every launch. */
  upstreamCheck: boolean;
  /** An upstream head the user chose to stay behind; no banner until upstream moves past it. */
  upstreamDismissed: string;
  /** The project every screen works in (Prove's files, Chat, History, Runs); empty when there is none yet. */
  activeProject: string;
  /** Before projects were shared, the folder the Prove page listed; moved into a project on launch. */
  proveFolder: string;
};

export type RunMode = "single" | "decompose" | "search" | "ultramath";

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
  /** The project the run belongs to, and the project file it proved; absent on older runs. */
  projectId?: string;
  file?: string;
  startedAt: number;
  finishedAt: number;
  model: string;
  /** USD the run spent, when the model had a price. */
  spentUsd?: number;
  /** Absent on runs recorded before providers were selectable: those used Fireworks. */
  provider?: ProviderId;
  /** Absent on runs recorded before the search tree: those were "single". */
  mode?: RunMode;
  /** "chat": the chat wrote the proof itself and checked it with `verify_lean`; one attempt, no prover. */
  via?: "chat";
  problem: string;
  outcome: "solved" | "failed";
  message: string;
  events: RunEvent[];
};

export type RunSummary = Pick<RunRecord, "id" | "projectId" | "file" | "startedAt" | "finishedAt" | "model" | "mode" | "via" | "outcome" | "message"> & {
  theorem: string;
  attempts: number;
};

const DEFAULTS: Settings = {
  provider: "fireworks",
  models: { fireworks: "", openrouter: "", cheaperinference: "", litellm: "", custom: "" },
  customBaseUrl: "http://localhost:11434/v1",
  litellmBaseUrl: "http://localhost:4000/v1",
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
  autopilotNewChats: true,
  maxLeanProcesses: 0,
  proverProvider: "openrouter",
  proverModel: "",
  revisionsPerChain: 4,
  leanAutomation: true,
  reuseProofs: true,
  decomposeDepth: 2,
  decomposeAttempts: 16,
  decomposeRounds: 2,
  easierFirst: false,
  premiseSelection: true,
  remoteLean: { host: "", workspace: "~/mack-lean", repl: true, processes: 8 },
  autoUpdate: true,
  maxCostPerSession: 2,
  globalLimit: 10,
  globalPeriod: "month",
  prices: {},
  assumedPrice: ASSUMED_PRICE,
  useRepl: true,
  searchWorker: "fixed",
  searchAnalysis: true,
  runConcurrency: 1,
  checkStatement: true,
  proofIdea: true,
  parallelAttempts: 1,
  upstreamCheck: true,
  upstreamDismissed: "",
  activeProject: "",
  proveFolder: "",
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
      remoteLean: { ...DEFAULTS.remoteLean, ...saved.remoteLean },
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
function makeProvider(s: Settings, id: ProviderId, model = s.models[id]): ModelProvider {
  const base = makeBaseProvider(s, id);
  return metered(base, priceFor(s.prices, model, s.assumedPrice).price, ledger, { scope: "global", onCharge: broadcastSpend, onCap: broadcastSpend });
}

function makeBaseProvider(s: Settings, id: ProviderId): OpenAICompatibleProvider {
  const info = providerInfo(id);
  const key = readKey(id);
  if (info.keyRequired && !key) throw new Error(`Add your ${info.label} API key in Setup first.`);
  const headers: Record<string, string> = { ...info.headers, ...(id === "openrouter" ? { "HTTP-Referer": "https://github.com/JorgeOchoaReyes/Mack", "X-Title": "Mack" } : {}) };
  return new OpenAICompatibleProvider(info.label, info.baseUrl ?? s[info.endpointSetting ?? "customBaseUrl"], key, {
    extraHeaders: headers,
    reasoning: id === "openrouter" ? "openrouter" : "openai",
    prices: info.prices,
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
/** The Lean processes allowed at once: the remote machine's own number, or this computer's budget. */
function leanProcesses(s: Settings): number {
  return remoteOn(s) ? Math.max(1, Math.floor(s.remoteLean.processes) || 1) : leanBudget(s.maxLeanProcesses, os.totalmem());
}

const remoteOn = (s: Settings) => !!s.remoteLean.host.trim();

/** Lean can run: installed here, or on the remote machine (which Mack cannot look at without a run). */
const leanReady = (s: Settings) => remoteOn(s) || hasProject(s.leanWorkspace);

function quickCheck(s: Settings, size: number) {
  // Every Lean process holds Mathlib in memory, so all of them, resident REPLs and fresh runs, share one budget.
  const { repls, fresh } = splitBudget(leanProcesses(s), size);
  setLeanSlots(fresh);
  size = repls;
  const replHere = remoteOn(s) ? s.remoteLean.repl : hasRepl(s.leanWorkspace);
  if (!size || !s.useRepl || !replHere) {
    repl?.pool.stop();
    repl = null;
    return undefined;
  }
  const key = `${remoteOn(s) ? `${s.remoteLean.host}:${s.remoteLean.workspace}` : s.leanWorkspace}|${size}|${s.timeoutMs}`;
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
ipcMain.handle("lean:memory", () => ({ totalGb: Math.round(os.totalmem() / 1024 ** 3), auto: leanBudget(0, os.totalmem()) }));

function writeSettings(patch: Partial<Settings>): Settings {
  const next = { ...readSettings(), ...patch };
  writeFileSync(settingsPath(), JSON.stringify(next, null, 2));
  return next;
}

/** Before any REPL is wanted, every Lean slot goes to fresh runs; a changed limit drops the REPLs, which restart within it. */
function applyLeanBudget(s: Settings): void {
  repl?.pool.stop();
  repl = null;
  setRemoteLean(remoteOn(s) ? { host: s.remoteLean.host, workspace: s.remoteLean.workspace } : null);
  setLeanSlots(leanProcesses(s));
}

ipcMain.handle("settings:set", (_e, s: Partial<Settings>) => {
  const lean = (x: Settings) => JSON.stringify([x.maxLeanProcesses, x.remoteLean]);
  const before = lean(readSettings());
  const next = writeSettings(s);
  if (lean(next) !== before) applyLeanBudget(next);
  broadcastSpend();
  return next;
});

async function feedbackDiagnostics(): Promise<Diagnostics> {
  const s = readSettings();
  return { app: app.getVersion(), os: `${process.platform === "win32" ? "Windows" : process.platform} ${os.release()}`, lean: await lakeVersion(s.leanWorkspace), provider: providerInfo(s.provider).label, mode: s.mode, repl: hasRepl(s.leanWorkspace) };
}

ipcMain.handle("feedback:diagnostics", async () => diagnosticsText(await feedbackDiagnostics()));
ipcMain.handle("feedback:open", async (_e, kind: FeedbackKind, title: string, body: string) => {
  if (kind !== "bug" && kind !== "idea") throw new Error("unknown kind");
  return shell.openExternal(issueUrl(kind, String(title), String(body), await feedbackDiagnostics()));
});
ipcMain.handle("feedback:issues", () => openIssues());

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

/** The GitHub token for project PRs: GITHUB_TOKEN or GH_TOKEN, then the one saved in Mack (encrypted), then the GitHub CLI's login. */
async function githubAuth(): Promise<{ token: string; source: GitHubTokenSource }> {
  const env = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (env) return { token: env, source: "env" };
  if (existsSync(userData("github.key"))) {
    try {
      return { token: safeStorage.decryptString(readFileSync(userData("github.key"))), source: "saved" };
    } catch {
      // An unreadable saved token falls through to the CLI.
    }
  }
  const gh = await ghCliToken();
  return gh ? { token: gh, source: "gh" } : { token: "", source: "none" };
}

async function githubStatus(): Promise<{ source: GitHubTokenSource; login?: string; error?: string }> {
  const a = await githubAuth();
  if (!a.token) return { source: "none" };
  try {
    return { source: a.source, login: await githubLogin(a.token) };
  } catch (e) {
    return { source: a.source, error: (e as Error).message };
  }
}

ipcMain.handle("github:status", () => githubStatus());
ipcMain.handle("github:setToken", async (_e, token: string) => {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("OS encryption is unavailable; set GITHUB_TOKEN in .env instead");
  await githubLogin(String(token).trim());
  writeFileSync(userData("github.key"), safeStorage.encryptString(String(token).trim()));
  return githubStatus();
});
ipcMain.handle("github:clearToken", async () => {
  rmSync(userData("github.key"), { force: true });
  return githubStatus();
});

ipcMain.handle("health:get", async (): Promise<Health> => {
  const s = readSettings();
  // Setup asks for health after it installs or moves the workspace: look at the computer again then.
  void refreshEnvironment().catch(() => undefined);
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
  if (!/^https:\/\/(github\.com|fireworks\.ai|app\.fireworks\.ai|openrouter\.ai|platform\.cheaperinference\.com|www\.cheaperinference\.com|leanprover-community\.github\.io)\//.test(url)) {
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

/** A session's meter, priced at the model's price or the assumed one; refused when the global limit is already reached. Chats pass `capped: false`: only the global limit bounds them. */
function newMeter(s: Settings, model: string, spent = 0, capped = true): { meter: Meter; price: Price | undefined } {
  const { price } = priceFor(s.prices, model, s.assumedPrice);
  if (s.globalLimit > 0 && ledger.spent >= s.globalLimit)
    throw new Error(`The global spending limit (${formatUsd(s.globalLimit)}${s.globalPeriod === "total" ? "" : ` per ${s.globalPeriod}`}) is reached. Raise or reset it in Settings → Spending.`);
  return { meter: { spent, limit: capped ? s.maxCostPerSession : 0, estimated: false }, price };
}

/** Where a proof run came from: its project and, when it proves a project file as saved, that file. */
export type RunOrigin = { projectId?: string; file?: string };

/** The index of the Lean workspace's Mathlib, one per workspace, built on first use and cached per Mathlib version. */
let mathlib: { workspace: string; index: MathlibIndex } | null = null;
function mathlibIndex(s: Settings): MathlibIndex | undefined {
  if (!mathlibSource(s.leanWorkspace)) return undefined;
  if (mathlib?.workspace !== s.leanWorkspace) mathlib = { workspace: s.leanWorkspace, index: new MathlibIndex(s.leanWorkspace, userData("mathlib-index.json")) };
  return mathlib.index;
}

async function searchMathlib(query: string, limit: number): Promise<string> {
  const index = mathlibIndex(readSettings());
  if (!index) throw new Error("Mathlib's source is not in the Lean workspace; install Lean and Mathlib in Setup first");
  return describeDecls(searchDecls(await index.load(), query, limit), query);
}

/** The Mathlib theorems a statement's concepts point to, as a note for the attempts; empty without Mathlib's source here. */
async function premisesFor(s: Settings, frozen: string): Promise<string> {
  const index = mathlibIndex(s);
  if (!index) return "";
  return describePremises(premises(await index.load(), extractStatement(frozen) ?? frozen));
}

/** What this computer has installed, for the chat's agent: looked at on launch and after Setup changes the workspace. */
let environmentNote = "";
let environmentOf = "";
async function refreshEnvironment(): Promise<void> {
  const workspace = readSettings().leanWorkspace;
  environmentOf = workspace;
  const note = describeEnvironment(await probeEnvironment(workspace));
  if (environmentOf === workspace) environmentNote = note;
}

/** Real Mathlib names close to ones Lean did not know, for a prover's next attempt; empty without Mathlib's source. */
async function mathlibHints(names: string[]): Promise<string> {
  const index = names.length ? mathlibIndex(readSettings()) : undefined;
  return index ? nameHints(await index.load(), names) : "";
}

/** For names Lean did not know, the one real Mathlib name each almost certainly meant. */
async function mathlibRenames(names: string[]): Promise<Record<string, string>> {
  const index = names.length ? mathlibIndex(readSettings()) : undefined;
  if (!index) return {};
  const decls = await index.load();
  const out: Record<string, string> = {};
  for (const n of names) {
    const to = renameFor(decls, n);
    if (to) out[n] = to;
  }
  return out;
}

/**
 * The lemmas a verifier accepted in a project, newest first, from its plan's Proved list: the
 * accepted proof file for `verify_lean`, the run's proof for a proof run. `except` is the
 * statement being proved now, which must not be offered its own proof.
 */
async function projectLemmas(projectId: string, except?: string): Promise<Lemma[]> {
  let folder: string;
  try {
    folder = chat.project(projectId).folder;
  } catch {
    return [];
  }
  const plan = await readPlan(folder);
  const out: Lemma[] = [];
  for (const p of [...(plan.proved ?? [])].reverse()) {
    if (p.file === except || !p.proof) continue;
    try {
      if (p.how === "verify_lean") out.push({ file: p.file, source: lemmaSource(readFileSync(await confine(folder, p.proof), "utf8")) });
      else {
        const r = JSON.parse(readFileSync(join(runsDir(), `${p.proof.replace(/[^0-9]/g, "")}.json`), "utf8")) as RunRecord;
        const solved = r.events.find((e): e is Extract<RunEvent, { type: "solved" }> => e.type === "solved");
        if (solved) out.push({ file: p.file, source: lemmaSource(solved.proof) });
      }
    } catch {
      // A proof file or run that is gone is simply not offered.
    }
  }
  return out;
}

/** Every proof the strict verifier accepted in a proof run, kept for later attempts to learn from. */
let proofs: ProofStore | null = null;
const proofStore = () => (proofs ??= new ProofStore(userData("proofs.jsonl")));

/** The prover models named in Settings (comma-separated), each priced into the same meter as the run's main model; empty when none is set. */
const proverModels = (s: Settings) =>
  s.proverModel
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);

function proversFor(s: Settings, meter: Meter, hooks: { onCharge?: (m: Meter) => void; onCap?: (why: string) => void }): { provider: ModelProvider; model: string }[] {
  return proverModels(s).map((model) => ({ provider: metered(makeProvider(s, s.proverProvider, model), priceFor(s.prices, model, s.assumedPrice).price, meter, hooks), model }));
}

const parallelOf = (s: Settings) => Math.max(1, Math.min(32, Math.floor(s.parallelAttempts) || 1));

/**
 * A single or decompose proof run of `problem` with the settings' attempts, prover models, automation and
 * reuse of earlier proofs; with `easierFirst`, easier versions are proved first and offered as lemmas.
 * Shared by proof runs and the benchmark.
 */
async function attemptProof(
  s: Settings,
  mode: "single" | "decompose",
  problem: string,
  o: {
    provider: ModelProvider;
    model: string;
    meter: Meter;
    hooks: { onCharge?: (m: Meter) => void; onCap?: (why: string) => void };
    run: ReturnType<typeof leanRunner>;
    prepare?: { checkStatement: boolean; idea: boolean };
    lemmas?: Lemma[];
    signal: AbortSignal;
    onEvent: (e: ProveEvent) => void;
  },
): Promise<void> {
  const parallel = parallelOf(s);
  const base = {
    provider: o.provider,
    model: o.model,
    run: o.run,
    check: quickCheck(s, parallel),
    parallel,
    lookup: mathlibHints,
    rename: mathlibRenames,
    provers: proversFor(s, o.meter, o.hooks),
    revisions: s.revisionsPerChain,
    automation: s.leanAutomation,
    premises: s.premiseSelection ? (frozen: string) => premisesFor(s, frozen) : undefined,
    signal: o.signal,
  };
  let lemmas = o.lemmas ?? [];
  if (s.easierFirst) {
    const check = base.check ?? (async (src: string) => checkFromRun(await o.run(src)));
    const easier = await easierVersions({
      frozen: problem,
      provider: o.provider,
      model: o.model,
      check,
      signal: o.signal,
      onStatus: (message) => o.onEvent({ type: "status", message }),
      prove: async (v) => {
        let proof: string | null = null;
        await prove({ ...base, frozen: v, maxAttempts: Math.max(2, Math.min(8, Math.floor(s.maxAttempts / 4))), onEvent: (e) => e.type === "solved" && (proof = e.proof) });
        return proof;
      },
    });
    lemmas = [...easier, ...lemmas];
  }
  const options = {
    ...base,
    frozen: problem,
    maxAttempts: s.maxAttempts,
    prepare: o.prepare,
    lemmas,
    examples: s.reuseProofs ? describeExamples(proofStore().similar(problem)) : "",
    onEvent: o.onEvent,
  };
  if (mode === "decompose") await decompose({ ...options, maxDepth: s.decomposeDepth, lemmaAttempts: s.decomposeAttempts, rounds: s.decomposeRounds });
  else await prove(options);
}

/** One proof run in the given mode, recorded in the run history. Shared by the Prove screen and the chat's `start_proof`. */
async function runProof(problem: string, mode: RunMode, forward: (ev: RunEvent) => void, origin: RunOrigin = {}): Promise<RunRecord> {
  if (proving) throw new Error("a proof run is already in progress");
  const s = { ...readSettings(), mode };
  const model = s.models[s.provider];
  if (!model) throw new Error(`Choose a ${providerInfo(s.provider).label} model in Setup first.`);
  const needsLean = s.mode !== "ultramath" || problemKind(problem) === "lean";
  if (needsLean && !leanReady(s)) throw new Error("Install Lean and Mathlib in Setup first.");
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
    ...(origin.projectId ? { projectId: origin.projectId } : {}),
    ...(origin.file ? { file: origin.file } : {}),
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
    if (ev.type === "solved" && "proof" in ev && typeof ev.proof === "string") void proofStore().add(problem, ev.proof, `run ${record.id}`).catch(() => undefined);
    forward(ev);
  };
  try {
    const run = leanRunner({ workspace: s.leanWorkspace, timeoutMs: s.timeoutMs });
    const lemmas = origin.projectId ? await projectLemmas(origin.projectId, origin.file) : [];
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
        prepare: { checkStatement: s.checkStatement, idea: s.proofIdea },
        lemmas,
        lookup: mathlibHints,
        limits: s.search,
        analysis: s.searchAnalysis,
        sketch: sketchFor(problem),
        worker: s.searchWorker,
        workspace: userData("prove-workspaces", record.id),
        signal: proving.signal,
        onEvent: send,
      });
    } else {
      await attemptProof(s, s.mode === "decompose" ? "decompose" : "single", problem, {
        provider,
        model,
        meter,
        hooks: {
          onCharge: (m) => send({ type: "spend", usd: m.spent, limit: m.limit, estimated: m.estimated }),
          onCap: (why) => {
            capped = why;
            ctl.abort();
          },
        },
        run,
        prepare: { checkStatement: s.checkStatement, idea: s.proofIdea },
        lemmas,
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

ipcMain.handle("prove:start", async (e, problem: string, origin?: RunOrigin) => {
  const o: RunOrigin = { projectId: typeof origin?.projectId === "string" ? origin.projectId : undefined, file: typeof origin?.file === "string" ? origin.file : undefined };
  const record = await runProof(
    problem,
    readSettings().mode,
    (ev) => {
      if (!e.sender.isDestroyed()) e.sender.send("prove:event", ev);
    },
    o,
  );
  return record.id;
});

ipcMain.handle("prove:stop", () => proving?.abort());

// The benchmark: a fixed set of formal problems, run with the current settings, one problem at a time.
let benching: AbortController | null = null;
let benchingId = "";
const benchDir = () => {
  const d = userData("bench");
  mkdirSync(d, { recursive: true });
  return d;
};
const saveBench = (run: BenchRun) => writeFileSync(join(benchDir(), `${run.id}.json`), JSON.stringify(run));

async function benchOne(s: Settings, p: { id: string; source: string }, bench: BenchRun, signal: AbortSignal, status: (m: string) => void, pool: Lemma[] = []): Promise<BenchResult> {
  const t0 = Date.now();
  const model = s.models[s.provider];
  const left = bench.budget > 0 ? bench.budget - bench.results.reduce((a, r) => a + r.usd, 0) : 0;
  const meter: Meter = { spent: 0, limit: Math.max(0, left), estimated: false };
  const ctl = new AbortController();
  const hooks = { onCap: () => ctl.abort() };
  const provider = metered(makeProvider(s, s.provider), priceFor(s.prices, model, s.assumedPrice).price, meter, hooks);
  const run = leanRunner({ workspace: s.leanWorkspace, timeoutMs: s.timeoutMs });
  let attempts = 0;
  let proof: string | undefined;
  let message = "";
  // How each attempt ended, to say afterwards why the problem was not solved.
  const notes: AttemptNote[] = [];
  let lastCandidate = "";
  const log: AttemptLog[] = [];
  const timeline: { t: number; message: string }[] = [];
  // The run's own steps, once each and in order: everything the agent did besides its attempts.
  const trace = (message: string) => {
    if (timeline.length < LOG_LIMITS.timeline && timeline[timeline.length - 1]?.message !== message) timeline.push({ t: Date.now() - t0, message: message.slice(0, LOG_LIMITS.step) });
  };
  // Every method's attempts land in one log: a Mack attempt, a search node, or a swarm member's turn.
  const onEvent = (ev: ProveEvent) => {
      if (ev.type === "attempt") {
        if (log.length < LOG_LIMITS.attempts) {
          const { thinking, prose } = splitReply(ev.reply ?? "", ev.reasoning);
          log.push({
            n: ev.n,
            outcome: ev.outcome,
            kind: ev.outcome === "verified" ? "verified" : attemptKind(ev),
            ...(ev.model ? { model: ev.model } : {}),
            ...(ev.at ? { at: new Date(ev.at).toISOString() } : {}),
            ms: ev.ms,
            tokens: ev.tokens,
            ...(ev.promptTokens ? { promptTokens: ev.promptTokens } : {}),
            ...(ev.truncated ? { truncated: true } : {}),
            detail: ev.detail.slice(0, LOG_LIMITS.detail),
            candidate: ev.candidate.slice(0, LOG_LIMITS.candidate),
            ...(thinking ? { thinking: thinking.slice(0, LOG_LIMITS.thinking) } : {}),
            ...(prose ? { prose: prose.slice(0, LOG_LIMITS.prose) } : {}),
          });
        }
      }
      if (ev.type === "attempt" && ev.n > 0) {
        attempts++;
        if (ev.outcome !== "verified") {
          notes.push({ outcome: ev.outcome, detail: ev.detail });
          lastCandidate = ev.candidate;
        }
      }
      if (ev.type === "solved") proof = ev.proof;
      if (ev.type === "failed") message = ev.message;
      if (ev.type === "status") {
        status(ev.message);
        trace(ev.message);
      }
      if (ev.type === "idea") trace(`The plan in words, which every attempt was given:\n${ev.text}`);
      if (ev.type === "statementCheck") trace(`Statement check: ${JSON.stringify(ev.check).slice(0, 400)}`);
  };
  const both = AbortSignal.any([signal, ctl.signal]);
  const method = bench.config.method ?? "single";
  const check = () => (async (src: string) => checkFromRun(await run(src)));
  if (method === "search") {
    await search({
      frozen: p.source,
      provider,
      model,
      run,
      check: quickCheck(s, Math.min(2, s.search.w)) ?? check(),
      prepare: { checkStatement: false, idea: s.proofIdea },
      lookup: mathlibHints,
      limits: s.search,
      analysis: s.searchAnalysis,
      sketch: sketchFor(p.source),
      worker: s.searchWorker,
      workspace: userData("bench-workspaces", bench.id, p.id),
      signal: both,
      onEvent: (ev) => {
        if (ev.type === "node") {
          const n = ev.node;
          const outcome = n.status === "invalid" ? "refused" : n.status === "complete" ? "rejected" : n.status;
          onEvent({ type: "attempt", n: n.id + 1, candidate: n.file, outcome, detail: n.detail, ms: ev.ms, tokens: ev.tokens, model, at: Date.now() - ev.ms });
          trace(`Node ${n.id + 1}${n.parent !== null ? ` (from node ${n.parent + 1})` : ""}, round ${n.round}: ${n.status}, score ${n.score.toFixed(2)}${n.approach ? `. Approach: ${n.approach}` : ""}`);
        } else if (ev.type === "round") trace(`Round ${ev.round}: continuing node${ev.batch.length === 1 ? "" : "s"} ${ev.batch.map((b) => b + 1).join(", ")}`);
        else if (ev.type === "solved" || ev.type === "failed" || ev.type === "status" || ev.type === "idea" || ev.type === "statementCheck") onEvent(ev);
      },
    });
  } else if (method === "steps") {
    quickCheck(s, 2);
    const pool = repl?.pool;
    if (!pool) onEvent({ type: "failed", message: "Step by step needs the Lean REPL, and it is not running." });
    else
      await stepSearch({
        frozen: p.source,
        provider,
        model,
        session: pool.session,
        run,
        maxCalls: s.maxAttempts,
        automation: s.leanAutomation,
        notes: s.premiseSelection ? await premisesFor(s, p.source).catch(() => "") : "",
        signal: both,
        onEvent,
      });
  } else if (method === "ultramath") {
    let turn = 0;
    await ultramath({
      problem: p.source,
      provider,
      model,
      run,
      check: quickCheck(s, 2) ?? check(),
      limits: s.ultramath,
      signal: both,
      onEvent: (ev) => {
        if (ev.type === "turn") {
          // A member's turn is the swarm's attempt: what its Lean check said, when it ran one, judges it.
          const said = ev.check ?? "";
          const outcome = !said ? "no verdict" : /error/i.test(said) ? "errors" : /sorry/i.test(said) ? "sorries" : "rejected";
          onEvent({ type: "attempt", n: ++turn, candidate: ev.summary, outcome, detail: said || "(the member ran no Lean check this turn)", ms: 0, tokens: ev.tokens, model: `${model} · member ${ev.member}`, at: Date.now() });
          trace(`Member ${ev.member}, round ${ev.round}: ${ev.summary}`);
        } else if (ev.type === "direction") trace(`A member registered a direction: ${JSON.stringify(ev.direction).slice(0, 600)}`);
        else if (ev.type === "refused") trace(`Member ${ev.member}'s direction was refused (${ev.reason}): ${ev.text}`);
        else if (ev.type === "post") trace(`Board post: ${JSON.stringify(ev.post).slice(0, 800)}`);
        else if (ev.type === "report") trace(`Member ${ev.member} reported (${ev.accepted ? "accepted" : "not accepted"}: ${ev.reason}): ${ev.report}`);
        else if (ev.type === "solved" || ev.type === "failed" || ev.type === "status") onEvent(ev);
      },
    });
  } else {
    // Lemmas this run proved on earlier problems, the ones related to this statement.
    const offered = bench.config.lemmaPool ? relevantLemmas(pool, p.source) : [];
    if (offered.length) trace(`Offered ${offered.length} lemma${offered.length === 1 ? "" : "s"} proved earlier in this run: ${offered.map((l) => /^(?:private\s+)?(?:theorem|lemma)\s+(\S+)/.exec(l.source)?.[1] ?? "?").join(", ")}`);
    // Never the person's own past proofs as examples: they are private, so no one else could reproduce the run.
    await attemptProof({ ...s, reuseProofs: false }, method, p.source, {
      lemmas: offered,
      provider,
      model,
      meter,
      hooks,
      run,
      // Benchmark statements are known to be right; the random tester would only spend time.
      prepare: { checkStatement: false, idea: s.proofIdea },
      signal: both,
      onEvent,
    });
  }
  if (proof && bench.config.lemmaPool) pool.push(...helperLemmas(proof, p.source, p.id));
  if (proof) return { id: p.id, outcome: "solved", attempts, ms: Date.now() - t0, usd: meter.spent, proof, log, timeline };
  const outcomes: Record<string, number> = {};
  for (const n of notes) outcomes[n.outcome] = (outcomes[n.outcome] ?? 0) + 1;
  const failure = classifyFailure(notes, message);
  return {
    id: p.id,
    outcome: "failed",
    attempts,
    ms: Date.now() - t0,
    usd: meter.spent,
    message,
    failure,
    outcomes,
    ...(notes.length ? { lastError: notes[notes.length - 1].detail.slice(0, 2000), lastCandidate: lastCandidate.slice(0, 4000) } : {}),
    log,
    timeline,
  };
}

ipcMain.handle("proofs:stats", () => ({ count: proofStore().all().length }));
ipcMain.handle("proofs:export", async (e) => {
  const proofs = proofStore().all();
  if (!proofs.length) throw new Error("No verified proofs are kept yet: they are kept from proof runs once Lean verifies them.");
  const win = BrowserWindow.fromWebContents(e.sender);
  const opts = { title: "Export verified proofs as fine-tuning data", defaultPath: "mack-proofs.jsonl", filters: [{ name: "JSON Lines", extensions: ["jsonl"] }] };
  const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
  if (r.canceled || !r.filePath) return null;
  writeFileSync(r.filePath, `${trainingData(proofs)}\n`, "utf8");
  return { path: r.filePath, count: proofs.length };
});
ipcMain.handle("bench:sets", () => BENCH_SETS.map(({ problems, ...rest }) => ({ ...rest, size: problems.length })));
/** The models one benchmark run uses: its main model, and the prover models that write the attempts (none: the main model writes them). */
export type BenchModels = { provider: ProviderId; model: string; proverProvider: ProviderId; proverModel: string };

/** The settings with a benchmark run's own models in place of the ones in Settings. */
function withModels(s: Settings, m: BenchModels): Settings {
  return { ...s, provider: m.provider, models: { ...s.models, [m.provider]: m.model }, proverProvider: m.proverProvider, proverModel: m.proverModel };
}

const benchLabel = (m: BenchModels) => `${m.model.split("/").pop()}${m.proverModel.trim() ? ` + ${m.proverModel.split(",").map((x) => x.trim().split("/").pop()).filter(Boolean).join(", ")}` : ""}`;

/**
 * One benchmark run per set of models, one after another on the same problems
 * (the same sample, the same budget each), so their results compare: a
 * comparison is a group of runs. Stopping stops the run going and the ones
 * queued behind it.
 */
ipcMain.handle("bench:start", async (e, setId: string, n: number, budget: number, method?: string, models?: BenchModels[], opts?: { lemmaPool?: boolean }) => {
  if (benching) throw new Error("A benchmark is already running.");
  const base = readSettings();
  const set = benchSet(String(setId));
  if (!set) throw new Error("unknown benchmark set");
  const list = (Array.isArray(models) && models.length ? models : [{ provider: base.provider, model: base.models[base.provider], proverProvider: base.proverProvider, proverModel: base.proverModel }])
    .filter((m) => m && isProvider(m.provider) && typeof m.model === "string" && m.model.trim())
    .map((m) => ({ provider: m.provider, model: m.model.trim(), proverProvider: isProvider(m.proverProvider) ? m.proverProvider : m.provider, proverModel: String(m.proverModel ?? "").trim() }));
  if (!list.length) throw new Error(`Choose a model for the run, or one in Setup.`);
  if (list.length > 6) throw new Error("Compare at most 6 models at once.");
  if (!leanReady(base)) throw new Error("Install Lean and Mathlib in Setup first.");
  if (method === "steps" && !(base.useRepl && (remoteOn(base) ? base.remoteLean.repl : hasRepl(base.leanWorkspace))))
    throw new Error("Step by step works on Lean's live proof states, so it needs the Lean REPL: turn it on in Settings → Prover, or build it in Settings → Setup.");
  const sample = pickSample(set, Math.floor(Number(n)) || 10);
  const group = list.length > 1 ? `${Date.now()}` : undefined;
  const env: BenchEnv = {
    app: app.getVersion(),
    platform: `${process.platform === "win32" ? "Windows" : process.platform === "darwin" ? "macOS" : process.platform} ${os.release()}, ${Math.round(os.totalmem() / 1024 ** 3)} GB`,
    lean: (await lakeVersion(base.leanWorkspace).catch(() => null)) ?? undefined,
    // The Mathlib the proofs were checked against, so CI re-checks them against the same one (a remote machine's is not known here).
    ...(remoteOn(base) ? {} : { mathlib: mathlibRev(base.leanWorkspace) }),
    leanDeadlineMs: base.timeoutMs,
    leanProcesses: leanProcesses(base),
    repl: base.useRepl && (remoteOn(base) ? base.remoteLean.repl : hasRepl(base.leanWorkspace)),
    remoteLean: remoteOn(base),
    proofIdea: base.proofIdea,
  };
  const runs: BenchRun[] = list.map((m, i) => {
    const s = withModels(base, m);
    const run: BenchRun = {
      id: `${Date.now() + i}`,
      set: set.id,
      startedAt: 0,
      finishedAt: 0,
      status: "running",
      config: {
        provider: m.provider,
        model: m.model,
        ...(proverModels(s).length ? { prover: proverModels(s).join(", "), proverProvider: m.proverProvider } : {}),
        maxAttempts: s.maxAttempts,
        parallel: parallelOf(s),
        automation: s.leanAutomation,
        revisions: s.revisionsPerChain,
        method: (["decompose", "steps", "search", "ultramath"] as const).find((x) => x === method) ?? "single",
        easierFirst: s.easierFirst,
        premises: s.premiseSelection,
        ...((method === "single" || method === "decompose" || !method) && opts?.lemmaPool !== false ? { lemmaPool: true } : {}),
      },
      sample,
      results: [],
      budget: Math.max(0, Number(budget) || 0),
      ...(group ? { group } : {}),
      label: benchLabel(m),
      env,
    };
    run.harness = harnessOf(run.config, app.getVersion(), UPSTREAM.baseline);
    return run;
  });
  const ctl = new AbortController();
  benching = ctl;
  const send = (run: BenchRun) => (ev: BenchEvent) => {
    if (!e.sender.isDestroyed()) e.sender.send("bench:event", ev);
    if (ev.type !== "status") saveBench(run);
  };
  void (async () => {
    for (const [i, run] of runs.entries()) {
      const s = withModels(base, list[i]);
      // Each run its own lemma pool: runs compared on the same problems never share one.
      const pool: Lemma[] = [];
      benchingId = run.id;
      run.startedAt = Date.now();
      if (ctl.signal.aborted) {
        run.status = "stopped";
        run.message = "stopped before it started";
        run.finishedAt = Date.now();
        saveBench(run);
        continue;
      }
      await runBench({ run, set, signal: ctl.signal, onEvent: send(run), proveOne: (p, signal) => benchOne(s, p, run, signal, (message) => send(run)({ type: "status", id: p.id, message }), pool) }).catch((err: Error) => {
        run.status = "stopped";
        run.message = err.message;
      });
      saveBench(run);
    }
  })().finally(() => {
    benching = null;
  });
  return runs;
});
ipcMain.handle("bench:stop", () => benching?.abort());
ipcMain.handle("bench:list", (): BenchRun[] =>
  readdirSync(benchDir())
    .filter((f) => f.endsWith(".json"))
    .flatMap((f) => {
      try {
        const r = JSON.parse(readFileSync(join(benchDir(), f), "utf8")) as BenchRun;
        // A run that was going when Mack quit is not running now.
        if (r.status === "running" && !(benching && r.id === benchingId)) r.status = "stopped";
        return [r];
      } catch {
        return [];
      }
    })
    .sort((a, b) => b.startedAt - a.startedAt),
);
/** One saved run, or null. */
function readBench(id: string): BenchRun | null {
  if (!/^\d+$/.test(id)) return null;
  const f = join(benchDir(), `${id}.json`);
  return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as BenchRun) : null;
}
ipcMain.handle("bench:report", (_e, id: string) => {
  const run = readBench(String(id));
  if (!run) throw new Error("That benchmark run is gone.");
  return benchReport(run, benchSet(run.set), app.getVersion());
});
ipcMain.handle("bench:export", async (e, id: string) => {
  const run = readBench(String(id));
  if (!run) throw new Error("That benchmark run is gone.");
  const win = BrowserWindow.fromWebContents(e.sender);
  const opts = { title: "Save the benchmark report", defaultPath: `mack-benchmark-${run.set}-${run.id}.md`, filters: [{ name: "Markdown", extensions: ["md"] }] };
  const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
  if (r.canceled || !r.filePath) return null;
  writeFileSync(r.filePath, benchReport(run, benchSet(run.set), app.getVersion()), "utf8");
  return r.filePath;
});
// A run shared as a pull request on the Mack repo, so its results can be reviewed there.
ipcMain.handle("bench:share", async (_e, id: string, logs?: boolean) => {
  const run = readBench(String(id));
  if (!run) throw new Error("That benchmark run is gone.");
  if (run.status === "running") throw new Error("Wait for the run to finish, or stop it, before sharing it.");
  const { token } = await githubAuth();
  if (!token) throw new Error("Connect GitHub first: Settings → GitHub, or log in with the GitHub CLI (gh auth login).");
  if (run.sharedPr) throw new Error(`This run is already shared: ${run.sharedPr.url}`);
  const set = benchSet(run.set);
  const opened = await openCommunityPr(token, { ...COMMUNITY_REPO, dir: BENCH_SHARE_DIR }, benchSlug(run), (_slug, login) => benchShare(run, set, app.getVersion(), login, { logs: logs !== false }), "benchmark");
  // The run remembers its pull request, so the screen can show it and follow whether it was merged.
  run.sharedPr = { url: opened.url, number: Number(/\/pull\/(\d+)/.exec(opened.url)?.[1] ?? 0), at: Date.now(), logs: logs !== false };
  saveBench(run);
  return run.sharedPr;
});
// Where each shared run's pull request stands, for the runs that have one.
ipcMain.handle("bench:prs", async (): Promise<Record<string, "open" | "merged" | "closed" | "unknown">> => {
  const shared = readdirSync(benchDir())
    .filter((f) => f.endsWith(".json"))
    .flatMap((f) => {
      try {
        const r = JSON.parse(readFileSync(join(benchDir(), f), "utf8")) as BenchRun;
        return r.sharedPr?.number ? [r] : [];
      } catch {
        return [];
      }
    });
  if (!shared.length) return {};
  const { token } = await githubAuth();
  const out: Record<string, "open" | "merged" | "closed" | "unknown"> = {};
  for (const r of shared) out[r.id] = token ? await pullState(token, COMMUNITY_REPO.owner, COMMUNITY_REPO.repo, r.sharedPr!.number).catch(() => "unknown" as const) : "unknown";
  return out;
});
// Every attempt of a run as a JSON Lines dataset, saved where the person chooses.
ipcMain.handle("bench:dataset", async (e, id: string) => {
  const run = readBench(String(id));
  if (!run) throw new Error("That benchmark run is gone.");
  const data = attemptsDataset(run);
  if (!data) throw new Error("This run kept no attempt log: runs from Mack 0.2.19 on keep one.");
  const win = BrowserWindow.fromWebContents(e.sender);
  const opts = { title: "Save every attempt of the run", defaultPath: `mack-attempts-${run.set}-${run.id}.jsonl`, filters: [{ name: "JSON Lines", extensions: ["jsonl"] }] };
  const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
  if (r.canceled || !r.filePath) return null;
  writeFileSync(r.filePath, data, "utf8");
  return r.filePath;
});
ipcMain.handle("bench:delete", (_e, id: string) => {
  if (/^\d+$/.test(id)) rmSync(join(benchDir(), `${id}.json`), { force: true });
});

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

/** A project's .lean files, relative to its folder, with when each last changed. */
export type ProjectFiles = { projectId: string; folder: string; files: { path: string; mtime: number }[] };

// Ultramath members' workspaces hold many scratch files; the project's own files are what Prove lists.
const SKIP_DIRS = new Set([".lake", ".git", ".github", ".mack", ".ultramath", "node_modules", "build"]);
const SKIPPED = /(^|[\\/])(\.lake|\.git|\.github|\.mack|\.ultramath|node_modules|build)([\\/]|$)/;
const MAX_LEAN_FILES = 5000;

function leanFiles(root: string, dir = "", out: ProjectFiles["files"] = []): ProjectFiles["files"] {
  let entries;
  try {
    entries = readdirSync(join(root, dir), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (out.length >= MAX_LEAN_FILES) break;
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory() && !SKIP_DIRS.has(e.name)) leanFiles(root, rel, out);
    else if (e.isFile() && e.name.endsWith(".lean")) {
      let mtime = 0;
      try {
        mtime = statSync(join(root, rel)).mtimeMs;
      } catch {
        // Gone between the listing and the stat; listed without a time.
      }
      out.push({ path: rel, mtime });
    }
  }
  return out;
}

const leanPath = (rel: unknown): string => {
  if (typeof rel !== "string" || !rel.endsWith(".lean")) throw new Error("not a .lean file");
  return rel;
};

ipcMain.handle("project:leanFiles", (_e, projectId: string): ProjectFiles => {
  const p = chat.project(projectId);
  return { projectId: p.id, folder: p.folder, files: leanFiles(p.folder) };
});

ipcMain.handle("project:readLean", async (_e, projectId: string, rel: string) => readFileSync(await confine(chat.project(projectId).folder, leanPath(rel)), "utf8"));

ipcMain.handle("project:writeLean", async (_e, projectId: string, rel: string, text: string) => {
  if (typeof text !== "string") throw new Error("no text to write");
  const file = await confine(chat.project(projectId).folder, leanPath(rel));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text, "utf8");
});

/** The active project's folder, watched so Prove lists files the chat, a command or another editor writes. */
let projectWatch: { projectId: string; watcher: FSWatcher } | null = null;

ipcMain.handle("project:watch", (_e, projectId: string) => {
  if (projectWatch?.projectId === projectId) return;
  projectWatch?.watcher.close();
  projectWatch = null;
  if (!projectId) return;
  const folder = chat.project(projectId).folder;
  let timer: NodeJS.Timeout | undefined;
  const changed = (_ev: string, name: string | Buffer | null) => {
    const n = name ? String(name) : "";
    if (n && SKIPPED.test(n)) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.isDestroyed()) w.webContents.send("project:files", projectId);
    }, 300);
  };
  let watcher: FSWatcher;
  try {
    watcher = watch(folder, { recursive: true }, changed);
  } catch {
    // Without recursive watching, at least the project's top folder is watched.
    watcher = watch(folder, changed);
  }
  watcher.on("error", () => {});
  projectWatch = { projectId, watcher };
});

registerUpdates(() => readSettings().autoUpdate);

const runMeters = new Map<string, { meter: Meter; price: Price | undefined }>();

/** Who started a run from a chat, to wake that chat when the run ends. */
const runOwners = new Map<string, { projectId: string; sessionId: string }>();

const runs = new RunManager(
  userData("discovery"),
  async ({ problem, task, workspace, resume, journal, onEvent, signal }) => {
    const s = readSettings();
    if (!leanReady(s)) throw new Error("Install Lean and Mathlib in Setup first.");
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
      prepare: { checkStatement: s.checkStatement, idea: s.proofIdea },
      lemmas: task.project ? await projectLemmas(task.project) : [],
      lookup: mathlibHints,
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
registerTools(CONSTRUCT_TOOLS);

const constructions = new ConstructionService({
  provider: () => {
    const s = readSettings();
    const model = s.models[s.provider];
    const m = newMeter(s, model);
    return { provider: metered(makeProvider(s, s.provider), m.price, m.meter), model };
  },
  wake: (projectId, sessionId, text) => chat.wake(projectId, sessionId, "job", text),
});

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
  searchMathlib,
  environment: () => environmentNote,
  recordChatAttempt: (a) => {
    const id = `${a.at}`;
    const record: RunRecord = {
      id,
      projectId: a.projectId,
      file: a.file,
      startedAt: a.at,
      finishedAt: a.at,
      model: a.model,
      mode: "single",
      via: "chat",
      problem: a.problem,
      outcome: a.accepted ? "solved" : "failed",
      message: a.accepted ? "" : `The verifier rejected ${a.proofFile}: ${a.detail}`,
      events: [
        { type: "attempt", n: 1, candidate: a.proof, outcome: a.accepted ? "verified" : "rejected", detail: a.detail, ms: 0, tokens: 0 },
        ...(a.accepted ? [{ type: "solved" as const, n: 1, proof: a.proof, axioms: a.axioms }] : []),
      ],
    };
    try {
      writeFileSync(join(runsDir(), `${id}.json`), JSON.stringify(record));
    } catch {
      // The attempt still stands in the chat; only its copy here is lost.
    }
  },
  githubToken: async () => (await githubAuth()).token,
  extraTools: ({ projectId, root, sessionId }) => (call) => runTool(call, { projectId, root, sessionId }) ?? swarmTool(call, { projectId, root, sessionId }) ?? constructTool(call, { projectId, root, sessionId }),
});

// The folder an older Prove page had open becomes a project, so it is listed as before.
{
  const s = readSettings();
  if (s.proveFolder) {
    try {
      const p = existsSync(s.proveFolder) ? chat.adopt(s.proveFolder) : null;
      writeSettings({ proveFolder: "", ...(p && !s.activeProject ? { activeProject: p.id } : {}) });
    } catch {
      // A folder that cannot be adopted is simply no longer listed.
    }
  }
}

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

/** The chat's `construction_*` tools; a search is the chat's, named by the session. */
function constructTool(call: { name: string; args: Record<string, unknown> }, ctx: { projectId: string; root: string; sessionId: string }): Promise<string> | undefined {
  switch (call.name) {
    case "construction_search":
      return constructions.start(ctx.projectId, ctx.root, ctx.sessionId, call.args);
    case "construction_status":
      return (async () => constructions.status(ctx.sessionId, call.args.name))();
    case "construction_stop":
      return (async () => constructions.stop(ctx.sessionId, call.args.name))();
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
  return runs.start({ name: `run-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`, project: s.activeProject, problems, limits: s.search, worker: s.searchWorker, concurrency: s.runConcurrency, analysis: s.searchAnalysis });
});

loadDotEnv();
void app.whenReady().then(createWindow);
void app.whenReady().then(() => applyLeanBudget(readSettings()));
void app.whenReady().then(() => void refreshEnvironment().catch(() => undefined));
// Build the Mathlib index in the background soon after launch, so the first search does not wait for it.
void app.whenReady().then(() => setTimeout(() => void mathlibIndex(readSettings())?.load().catch(() => undefined), 20_000));
app.on("window-all-closed", () => app.quit());
app.on("will-quit", () => {
  runs.stopAll();
  swarms.stopAll();
  constructions.stopAll();
  repl?.pool.stop();
  chat.stopAll();
});
