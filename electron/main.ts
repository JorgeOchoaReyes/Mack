// The Electron main process: owns settings, the API key, Lean, setup, run
// history and the model provider. The renderer only sees what preload.ts
// exposes; the key never crosses to it.

import { app, BrowserWindow, dialog, ipcMain, nativeTheme, safeStorage, shell } from "electron";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkFromRun } from "../core/lean/check";
import { hasRepl, replPool, type ReplPool } from "../core/lean/repl";
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
import { registerChat } from "./chat";
import { registerUpdates } from "./updates";
import { newerMackRelease } from "../core/upstream";
import type { ApprovalPolicy } from "../core/chat/executor";

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
  /** What the chat may do without asking, per protected tool; absent means ask. */
  approvals: Partial<Record<"write_file" | "start_proof", ApprovalPolicy>>;
  /** Download and install new Mack releases from GitHub. */
  autoUpdate: boolean;
  /** Check Open Math Harness for methodology changes on every launch. */
  upstreamCheck: boolean;
  /** An upstream head the user chose to stay behind; no banner until upstream moves past it. */
  upstreamDismissed: string;
};

export type RunMode = "single" | "search" | "ultramath";

export type RunEvent = ProveEvent | SearchEvent | UltramathEvent;

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
  autoUpdate: true,
  useRepl: true,
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

function makeProvider(s: Settings, id: ProviderId): OpenAICompatibleProvider {
  const info = providerInfo(id);
  const key = readKey(id);
  if (info.keyRequired && !key) throw new Error(`Add your ${info.label} API key in Setup first.`);
  const headers: Record<string, string> = id === "openrouter" ? { "HTTP-Referer": "https://github.com/JorgeOchoaReyes/Mack", "X-Title": "Mack" } : {};
  return new OpenAICompatibleProvider(info.label, info.baseUrl ?? s.customBaseUrl, key, headers);
}

const isProvider = (id: unknown): id is ProviderId => PROVIDERS.some((p) => p.id === id);

function theoremOf(problem: string): string {
  return /^theorem\s+([^\s:({[]+)/m.exec(problem)?.[1] ?? "untitled";
}

let proving: AbortController | null = null;
let repl: { pool: ReplPool; key: string } | null = null;

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

ipcMain.handle("settings:set", (_e, s: Partial<Settings>) => {
  const next = { ...readSettings(), ...s };
  writeFileSync(settingsPath(), JSON.stringify(next, null, 2));
  return next;
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
  return makeProvider(s, isProvider(id) ? id : s.provider).listModels();
});

/** One proof run in the given mode, recorded in the run history. Shared by the Prove screen and the chat's `start_proof`. */
async function runProof(problem: string, mode: RunMode, forward: (ev: RunEvent) => void): Promise<RunRecord> {
  if (proving) throw new Error("a proof run is already in progress");
  const s = { ...readSettings(), mode };
  const model = s.models[s.provider];
  if (!model) throw new Error(`Choose a ${providerInfo(s.provider).label} model in Setup first.`);
  const needsLean = s.mode !== "ultramath" || problemKind(problem) === "lean";
  if (needsLean && !hasProject(s.leanWorkspace)) throw new Error("Install Lean and Mathlib in Setup first.");
  const provider = makeProvider(s, s.provider);
  proving = new AbortController();
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
    if (ev.type === "failed") record.message = ev.message;
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
      await search({ frozen: problem, provider, model, run, check, limits: s.search, signal: proving.signal, onEvent: send });
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

registerChat({
  userData,
  readSettings,
  makeProvider: (s) => makeProvider(s, s.provider),
  lean: (s) => {
    if (!hasProject(s.leanWorkspace)) return undefined;
    const run = leanRunner({ workspace: s.leanWorkspace, timeoutMs: s.timeoutMs });
    return { run, check: quickCheck(s, 1) };
  },
  runProof,
});

loadDotEnv();
void app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
app.on("will-quit", () => repl?.pool.stop());
