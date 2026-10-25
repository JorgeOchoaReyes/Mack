// The Electron main process: owns settings, the API key, Lean and the model
// provider. The renderer only sees what preload.ts exposes; it never receives
// the key.

import { app, BrowserWindow, ipcMain, safeStorage, shell } from "electron";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { leanRunner } from "../core/lean/runner";
import { FireworksProvider } from "../core/model/fireworks";
import { prove, type ProveEvent } from "../core/prove";
import { checkUpstream } from "../core/upstream";

export type Settings = {
  model: string;
  leanWorkspace: string;
  timeoutMs: number;
  maxAttempts: number;
  /** Check Open Math Harness for methodology changes on every launch. */
  upstreamCheck: boolean;
  /** An upstream head the user chose to stay behind; no banner until upstream moves past it. */
  upstreamDismissed: string;
};

const DEFAULTS: Settings = {
  model: "",
  leanWorkspace: "",
  timeoutMs: 300_000,
  maxAttempts: 8,
  upstreamCheck: true,
  upstreamDismissed: "",
};

const settingsPath = () => join(app.getPath("userData"), "settings.json");
const keyPath = () => join(app.getPath("userData"), "fireworks.key");

/** `KEY=value` lines of a `.env` next to the app, for development; never committed (see .gitignore). */
function loadDotEnv(): void {
  const file = join(app.getAppPath(), ".env");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

function readSettings(): Settings {
  try {
    return { ...DEFAULTS, ...(JSON.parse(readFileSync(settingsPath(), "utf8")) as Partial<Settings>) };
  } catch {
    return { ...DEFAULTS };
  }
}

/** The environment variable wins; otherwise the key saved in the app, encrypted with the OS keystore. */
function readKey(): string {
  if (process.env.FIREWORKS_API_KEY) return process.env.FIREWORKS_API_KEY;
  if (!existsSync(keyPath())) return "";
  try {
    return safeStorage.decryptString(readFileSync(keyPath()));
  } catch {
    return "";
  }
}

let running: AbortController | null = null;

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 820,
    title: "Mack",
    webPreferences: { preload: join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  if (process.env.VITE_DEV_SERVER_URL) void win.loadURL(process.env.VITE_DEV_SERVER_URL);
  else void win.loadFile(join(__dirname, "..", "..", "dist", "index.html"));
}

ipcMain.handle("settings:get", () => ({
  settings: readSettings(),
  keySource: process.env.FIREWORKS_API_KEY ? "env" : existsSync(keyPath()) ? "saved" : "none",
}));

ipcMain.handle("settings:set", (_e, s: Partial<Settings>) => {
  const next = { ...readSettings(), ...s };
  writeFileSync(settingsPath(), JSON.stringify(next, null, 2));
  return next;
});

ipcMain.handle("key:set", (_e, key: string) => {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("OS encryption is unavailable; set FIREWORKS_API_KEY in .env instead");
  writeFileSync(keyPath(), safeStorage.encryptString(key.trim()));
  return true;
});

ipcMain.handle("upstream:check", async () => {
  const s = readSettings();
  if (!s.upstreamCheck) return { kind: "off" };
  const report = await checkUpstream();
  if (report.kind === "changed" && report.head === s.upstreamDismissed) return { ...report, dismissed: true };
  return report;
});

ipcMain.handle("open:github", (_e, url: string) => {
  if (!url.startsWith("https://github.com/")) throw new Error("only github.com links open from Mack");
  return shell.openExternal(url);
});

ipcMain.handle("models:list", async () => new FireworksProvider(readKey()).listModels());

ipcMain.handle("prove:start", async (e, frozen: string) => {
  if (running) throw new Error("a proof run is already in progress");
  const s = readSettings();
  if (!s.model) throw new Error("choose a model in Settings first");
  if (!s.leanWorkspace) throw new Error("set the Lean workspace in Settings first");
  const provider = new FireworksProvider(readKey());
  running = new AbortController();
  const send = (ev: ProveEvent) => {
    if (!e.sender.isDestroyed()) e.sender.send("prove:event", ev);
  };
  try {
    await prove({
      frozen,
      provider,
      model: s.model,
      run: leanRunner({ workspace: s.leanWorkspace, timeoutMs: s.timeoutMs }),
      maxAttempts: s.maxAttempts,
      signal: running.signal,
      onEvent: send,
    });
  } finally {
    running = null;
  }
});

ipcMain.handle("prove:stop", () => {
  running?.abort();
});

loadDotEnv();
void app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
