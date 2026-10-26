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
  sendChat: (projectId: string, sessionId: string | null, text: string, opts?: unknown) => ipcRenderer.invoke("chat:send", projectId, sessionId, text, opts) as Promise<string>,
  attachFiles: (projectId: string) => ipcRenderer.invoke("chat:attach", projectId) as Promise<string[]>,
  setEffort: (projectId: string, sessionId: string, effort: string) => ipcRenderer.invoke("sessions:effort", projectId, sessionId, effort),
  suggestStart: () => ipcRenderer.invoke("chat:suggestStart") as Promise<string | null>,
  projectImage: (projectId: string, path: string) => ipcRenderer.invoke("project:image", projectId, path) as Promise<string | null>,
  listSkills: (projectId: string) => ipcRenderer.invoke("skills:list", projectId),
  sessionFindings: (projectId: string, id: string) => ipcRenderer.invoke("sessions:findings", projectId, id),
  exportSession: (projectId: string, id: string) => ipcRenderer.invoke("sessions:export", projectId, id) as Promise<boolean>,
  reviewChanges: (projectId: string) => ipcRenderer.invoke("review:changes", projectId),
  reviewFile: (projectId: string, path: string) => ipcRenderer.invoke("review:file", projectId, path) as Promise<string>,
  reviewInit: (projectId: string) => ipcRenderer.invoke("review:init", projectId) as Promise<boolean>,
  githubStatus: () => ipcRenderer.invoke("github:status"),
  githubSetToken: (token: string) => ipcRenderer.invoke("github:setToken", token),
  githubClearToken: () => ipcRenderer.invoke("github:clearToken"),
  openPr: (projectId: string, sessionId: string | null, title: string) => ipcRenderer.invoke("github:pr", projectId, sessionId, title),
  swarmRecords: (projectId: string, sessionId: string) => ipcRenderer.invoke("swarms:records", projectId, sessionId),
  feedbackDiagnostics: () => ipcRenderer.invoke("feedback:diagnostics") as Promise<string>,
  openFeedback: (kind: string, title: string, body: string) => ipcRenderer.invoke("feedback:open", kind, title, body),
  feedbackIssues: () => ipcRenderer.invoke("feedback:issues"),
  globalSpend: () => ipcRenderer.invoke("spend:get"),
  resetGlobalSpend: () => ipcRenderer.invoke("spend:reset"),
  onGlobalSpend: (cb: (e: unknown) => void) => subscribe("spend:global", cb),
  listDiscovery: () => ipcRenderer.invoke("discovery:list"),
  discoveryStatus: (run: string) => ipcRenderer.invoke("discovery:status", run),
  discoveryTree: (run: string, problem: string) => ipcRenderer.invoke("discovery:tree", run, problem),
  stopDiscovery: (run: string) => ipcRenderer.invoke("discovery:stop", run),
  resumeDiscovery: (run: string) => ipcRenderer.invoke("discovery:resume", run),
  startDiscoveryFromFiles: () => ipcRenderer.invoke("discovery:startFiles"),
  listPlugins: (sessionId: string) => ipcRenderer.invoke("plugins:list", sessionId) as Promise<{ name: string; kind: string; tools: string[] }[]>,
  stopPlugin: (sessionId: string, name: string) => ipcRenderer.invoke("plugins:stop", sessionId, name),
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
