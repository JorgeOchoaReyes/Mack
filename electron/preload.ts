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
  setKey: (provider: string, key: string) => ipcRenderer.invoke("key:set", provider, key),
  clearKey: (provider: string) => ipcRenderer.invoke("key:clear", provider),
  health: () => ipcRenderer.invoke("health:get"),
  verifyWorkspace: () => ipcRenderer.invoke("workspace:verify") as Promise<boolean>,
  pickWorkspace: () => ipcRenderer.invoke("workspace:pick") as Promise<string | null>,
  startSetup: () => ipcRenderer.invoke("setup:start") as Promise<boolean>,
  stopSetup: () => ipcRenderer.invoke("setup:stop"),
  onSetupEvent: (cb: (e: unknown) => void) => subscribe("setup:event", cb),
  checkUpstream: () => ipcRenderer.invoke("upstream:check"),
  openExternal: (url: string) => ipcRenderer.invoke("open:external", url),
  listModels: (provider?: string) => ipcRenderer.invoke("models:list", provider) as Promise<string[]>,
  startProve: (problem: string) => ipcRenderer.invoke("prove:start", problem) as Promise<string>,
  stopProve: () => ipcRenderer.invoke("prove:stop"),
  onProveEvent: (cb: (e: unknown) => void) => subscribe("prove:event", cb),
  listRuns: () => ipcRenderer.invoke("runs:list"),
  getRun: (id: string) => ipcRenderer.invoke("runs:get", id),
  deleteRun: (id: string) => ipcRenderer.invoke("runs:delete", id),
  saveLean: (name: string, text: string) => ipcRenderer.invoke("file:saveLean", name, text) as Promise<boolean>,
  openLean: () => ipcRenderer.invoke("file:openLean") as Promise<string | null>,
  listProjects: () => ipcRenderer.invoke("projects:list"),
  createProject: (name: string) => ipcRenderer.invoke("projects:create", name),
  openProject: () => ipcRenderer.invoke("projects:open"),
  removeProject: (id: string) => ipcRenderer.invoke("projects:remove", id),
  listSessions: (projectId: string) => ipcRenderer.invoke("sessions:list", projectId),
  getSession: (projectId: string, id: string) => ipcRenderer.invoke("sessions:get", projectId, id),
  deleteSession: (projectId: string, id: string) => ipcRenderer.invoke("sessions:delete", projectId, id),
  sendChat: (projectId: string, sessionId: string | null, text: string) => ipcRenderer.invoke("chat:send", projectId, sessionId, text) as Promise<string>,
  stopChat: (sessionId: string) => ipcRenderer.invoke("chat:stop", sessionId),
  onChatEvent: (cb: (e: unknown) => void) => subscribe("chat:event", cb),
  listApprovals: () => ipcRenderer.invoke("approvals:list"),
  decideApproval: (id: string, approve: boolean) => ipcRenderer.invoke("approvals:decide", id, approve),
  getMemory: (projectId: string) => ipcRenderer.invoke("memory:get", projectId),
  updateMemory: (projectId: string) => ipcRenderer.invoke("memory:update", projectId),
  forgetMemory: (projectId: string) => ipcRenderer.invoke("memory:forget", projectId),
  chatTools: () => ipcRenderer.invoke("chat:tools"),
  subscribeUpdates: () => ipcRenderer.invoke("update:subscribe"),
  checkUpdates: () => ipcRenderer.invoke("update:check"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  onUpdateEvent: (cb: (e: unknown) => void) => subscribe("update:event", cb),
};

contextBridge.exposeInMainWorld("mack", api);

export type MackApi = typeof api;
