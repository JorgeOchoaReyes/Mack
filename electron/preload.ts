// The only API the renderer gets. No key ever crosses it back to the page.

import { contextBridge, ipcRenderer } from "electron";

function subscribe(channel: string, cb: (e: unknown) => void): () => void {
  const listener = (_: unknown, e: unknown) => cb(e);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

const api = {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSettings: (s: unknown) => ipcRenderer.invoke("settings:set", s),
  setKey: (key: string) => ipcRenderer.invoke("key:set", key),
  clearKey: () => ipcRenderer.invoke("key:clear"),
  health: () => ipcRenderer.invoke("health:get"),
  verifyWorkspace: () => ipcRenderer.invoke("workspace:verify") as Promise<boolean>,
  pickWorkspace: () => ipcRenderer.invoke("workspace:pick") as Promise<string | null>,
  startSetup: () => ipcRenderer.invoke("setup:start") as Promise<boolean>,
  stopSetup: () => ipcRenderer.invoke("setup:stop"),
  onSetupEvent: (cb: (e: unknown) => void) => subscribe("setup:event", cb),
  checkUpstream: () => ipcRenderer.invoke("upstream:check"),
  openExternal: (url: string) => ipcRenderer.invoke("open:external", url),
  listModels: () => ipcRenderer.invoke("models:list") as Promise<string[]>,
  startProve: (problem: string) => ipcRenderer.invoke("prove:start", problem) as Promise<string>,
  stopProve: () => ipcRenderer.invoke("prove:stop"),
  onProveEvent: (cb: (e: unknown) => void) => subscribe("prove:event", cb),
  listRuns: () => ipcRenderer.invoke("runs:list"),
  getRun: (id: string) => ipcRenderer.invoke("runs:get", id),
  deleteRun: (id: string) => ipcRenderer.invoke("runs:delete", id),
  saveLean: (name: string, text: string) => ipcRenderer.invoke("file:saveLean", name, text) as Promise<boolean>,
  openLean: () => ipcRenderer.invoke("file:openLean") as Promise<string | null>,
};

contextBridge.exposeInMainWorld("mack", api);

export type MackApi = typeof api;
