// Auto-update from GitHub Releases (build step 6), through electron-updater.
// Only an installed (packaged) Mack updates itself: a development build
// reports "dev". An update downloads in the background and is installed
// when Mack quits, or at once when the person chooses to restart.

import { app, ipcMain, type WebContents } from "electron";
import { autoUpdater } from "electron-updater";

export type UpdateState =
  | { state: "dev" }
  | { state: "idle" }
  | { state: "checking" }
  | { state: "none"; version: string }
  | { state: "available"; version: string }
  | { state: "downloading"; version: string; percent: number }
  | { state: "ready"; version: string }
  | { state: "error"; message: string };

let current: UpdateState = { state: "idle" };
const listeners = new Set<WebContents>();

function set(s: UpdateState): void {
  current = s;
  for (const wc of listeners) if (!wc.isDestroyed()) wc.send("update:event", s);
}

export function registerUpdates(enabled: () => boolean): void {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("checking-for-update", () => set({ state: "checking" }));
  autoUpdater.on("update-not-available", (i) => set({ state: "none", version: i.version }));
  autoUpdater.on("update-available", (i) => set({ state: "available", version: i.version }));
  autoUpdater.on("download-progress", (p) => set({ state: "downloading", version: current.state === "available" || current.state === "downloading" ? current.version : "", percent: Math.round(p.percent) }));
  autoUpdater.on("update-downloaded", (i) => set({ state: "ready", version: i.version }));
  // Before the first release GitHub has nothing to offer; that is being up to date, not an error.
  const failed = (message: string) => set(/No published versions/i.test(message) ? { state: "none", version: app.getVersion() } : { state: "error", message });
  autoUpdater.on("error", (e) => failed(e.message));

  const check = async (): Promise<UpdateState> => {
    if (!app.isPackaged) {
      set({ state: "dev" });
      return current;
    }
    try {
      await autoUpdater.checkForUpdates();
    } catch (e) {
      failed((e as Error).message);
    }
    return current;
  };

  ipcMain.handle("update:subscribe", (e) => {
    listeners.add(e.sender);
    return { ...current, appVersion: app.getVersion() };
  });
  ipcMain.handle("update:check", () => check());
  ipcMain.handle("update:install", () => {
    if (current.state === "ready") autoUpdater.quitAndInstall();
  });

  void app.whenReady().then(() => {
    if (enabled()) setTimeout(() => void check(), 10_000);
    // And every 6 hours while Mack stays open, like the upstream check.
    setInterval(() => enabled() && void check(), 6 * 60 * 60 * 1000);
  });
}
