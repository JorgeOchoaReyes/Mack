// Typed access to the main process (electron/preload.ts).

import type { SetupEvent } from "../core/lean/setup-steps";
import type { ProveEvent } from "../core/prove";
import type { ProviderId } from "../core/model/providers";
import type { ChatEvent, ChatSession, StoredMessage, ToolOutcome } from "../core/chat/agent";
import type { ToolSpec } from "../core/chat/tools";
import type { ChatWire, PendingApproval, Project, SendOptions, SessionSummary } from "../electron/chat";
import type { ReasoningEffort } from "../core/model/provider";
import type { Finding } from "../core/secrets";
import type { RunStatus } from "../core/search/runs";
import type { LedgerState } from "../core/model/ledger";
import type { Issue } from "../core/feedback";
import type { SwarmRecord } from "../core/ultramath/service";
import type { SearchNode } from "../core/search/tree";
import type { ChangedFile } from "../core/git";
import type { GitHubTokenSource, PullRequest } from "../core/github";
import type { UpdateState } from "../electron/updates";
import type { UpstreamReport } from "../core/upstream";
import type { Health, KeySource, ProjectFiles, RunEvent, RunMode, RunOrigin, RunRecord, RunSummary, Settings } from "../electron/main";
import type { MackApi } from "../electron/preload";

declare global {
  interface Window {
    mack: MackApi;
  }
}

export type GitHubStatus = { source: GitHubTokenSource; login?: string; error?: string };
export type { PullRequest };
export type Upstream = (UpstreamReport & { dismissed?: boolean }) | { kind: "off" };
export type { Issue, LedgerState, RunStatus, SearchNode, SwarmRecord };
export type { ChangedFile, Finding, ProviderId, ReasoningEffort, UpdateState };
export type { ChatEvent, ChatSession, ChatWire, PendingApproval, Project, SessionSummary, StoredMessage, ToolOutcome, ToolSpec };
export type { Health, KeySource, ProjectFiles, ProveEvent, RunEvent, RunMode, RunOrigin, RunRecord, RunSummary, SetupEvent, Settings };

const m = () => window.mack;

export const api = {
  getSettings: () => m().getSettings() as Promise<Settings>,
  setSettings: (s: Partial<Settings>) => m().setSettings(s) as Promise<Settings>,
  setKey: (provider: ProviderId, k: string) => m().setKey(provider, k) as Promise<KeySource>,
  clearKey: (provider: ProviderId) => m().clearKey(provider) as Promise<KeySource>,
  health: () => m().health() as Promise<Health>,
  verifyWorkspace: () => m().verifyWorkspace(),
  pickWorkspace: () => m().pickWorkspace(),
  startSetup: () => m().startSetup(),
  stopSetup: () => m().stopSetup(),
  onSetupEvent: (cb: (e: SetupEvent) => void) => m().onSetupEvent((e) => cb(e as SetupEvent)),
  checkUpstream: () => m().checkUpstream() as Promise<Upstream>,
  openExternal: (url: string) => m().openExternal(url),
  listModels: (provider?: ProviderId) => m().listModels(provider),
  startProve: (problem: string, origin?: RunOrigin) => m().startProve(problem, origin),
  stopProve: () => m().stopProve(),
  onProveEvent: (cb: (e: RunEvent) => void) => m().onProveEvent((e) => cb(e as RunEvent)),
  listRuns: () => m().listRuns() as Promise<RunSummary[]>,
  getRun: (id: string) => m().getRun(id) as Promise<RunRecord | null>,
  deleteRun: (id: string) => m().deleteRun(id) as Promise<void>,
  saveLean: (name: string, text: string) => m().saveLean(name, text),
  openLean: () => m().openLean(),
  projectLeanFiles: (projectId: string) => m().projectLeanFiles(projectId) as Promise<ProjectFiles>,
  readProjectLean: (projectId: string, path: string) => m().readProjectLean(projectId, path),
  writeProjectLean: (projectId: string, path: string, text: string) => m().writeProjectLean(projectId, path, text),
  watchProject: (projectId: string) => m().watchProject(projectId),
  onProjectFiles: (cb: (projectId: string) => void) => m().onProjectFiles((e) => cb(e as string)),
  listProjects: () => m().listProjects() as Promise<Project[]>,
  createProject: (name: string) => m().createProject(name) as Promise<Project>,
  openProject: () => m().openProject() as Promise<Project | null>,
  removeProject: (id: string) => m().removeProject(id) as Promise<void>,
  listSessions: (projectId: string) => m().listSessions(projectId) as Promise<SessionSummary[]>,
  getSession: (projectId: string, id: string) => m().getSession(projectId, id) as Promise<ChatSession | null>,
  deleteSession: (projectId: string, id: string) => m().deleteSession(projectId, id) as Promise<void>,
  sendChat: (projectId: string, sessionId: string | null, text: string, opts?: SendOptions) => m().sendChat(projectId, sessionId, text, opts),
  attachFiles: (projectId: string) => m().attachFiles(projectId),
  setEffort: (projectId: string, sessionId: string, effort: ReasoningEffort) => m().setEffort(projectId, sessionId, effort) as Promise<void>,
  suggestStart: () => m().suggestStart(),
  projectImage: (projectId: string, path: string) => m().projectImage(projectId, path),
  listSkills: (projectId: string) => m().listSkills(projectId) as Promise<{ name: string; description: string }[]>,
  sessionFindings: (projectId: string, id: string) => m().sessionFindings(projectId, id) as Promise<Record<number, Finding[]>>,
  exportSession: (projectId: string, id: string) => m().exportSession(projectId, id),
  reviewChanges: (projectId: string) => m().reviewChanges(projectId) as Promise<{ repo: boolean; files: ChangedFile[] }>,
  reviewFile: (projectId: string, path: string) => m().reviewFile(projectId, path),
  reviewInit: (projectId: string) => m().reviewInit(projectId),
  githubStatus: () => m().githubStatus() as Promise<GitHubStatus>,
  githubSetToken: (token: string) => m().githubSetToken(token) as Promise<GitHubStatus>,
  githubClearToken: () => m().githubClearToken() as Promise<GitHubStatus>,
  openPr: (projectId: string, sessionId: string | null, title: string) => m().openPr(projectId, sessionId, title) as Promise<PullRequest>,
  listPlugins: (sessionId: string) => m().listPlugins(sessionId),
  swarmRecords: (projectId: string, sessionId: string) => m().swarmRecords(projectId, sessionId) as Promise<{ id: string; records: SwarmRecord[] }[]>,
  feedbackDiagnostics: () => m().feedbackDiagnostics(),
  openFeedback: (kind: "bug" | "idea", title: string, body: string) => m().openFeedback(kind, title, body) as Promise<void>,
  feedbackIssues: () => m().feedbackIssues() as Promise<Issue[]>,
  globalSpend: () => m().globalSpend() as Promise<LedgerState>,
  resetGlobalSpend: () => m().resetGlobalSpend() as Promise<LedgerState>,
  onGlobalSpend: (cb: (e: LedgerState) => void) => m().onGlobalSpend((e) => cb(e as LedgerState)),
  listDiscovery: () => m().listDiscovery() as Promise<RunStatus[]>,
  discoveryStatus: (run: string) => m().discoveryStatus(run) as Promise<RunStatus>,
  discoveryTree: (run: string, problem: string) => m().discoveryTree(run, problem) as Promise<SearchNode[]>,
  stopDiscovery: (run: string) => m().stopDiscovery(run) as Promise<void>,
  resumeDiscovery: (run: string) => m().resumeDiscovery(run) as Promise<RunStatus>,
  startDiscoveryFromFiles: () => m().startDiscoveryFromFiles() as Promise<RunStatus | null>,
  stopPlugin: (sessionId: string, name: string) => m().stopPlugin(sessionId, name) as Promise<string>,
  stopChat: (sessionId: string) => m().stopChat(sessionId) as Promise<void>,
  onChatEvent: (cb: (e: ChatWire) => void) => m().onChatEvent((e) => cb(e as ChatWire)),
  listApprovals: () => m().listApprovals() as Promise<PendingApproval[]>,
  decideApproval: (id: string, approve: boolean) => m().decideApproval(id, approve) as Promise<void>,
  getMemory: (projectId: string) => m().getMemory(projectId) as Promise<{ index: string; summary: string; records: string[] }>,
  updateMemory: (projectId: string) => m().updateMemory(projectId) as Promise<{ extracted: number; consolidated: boolean }>,
  forgetMemory: (projectId: string) => m().forgetMemory(projectId) as Promise<void>,
  chatTools: () => m().chatTools() as Promise<ToolSpec[]>,
  subscribeUpdates: () => m().subscribeUpdates() as Promise<UpdateState & { appVersion: string }>,
  checkUpdates: () => m().checkUpdates() as Promise<UpdateState>,
  installUpdate: () => m().installUpdate() as Promise<void>,
  onUpdateEvent: (cb: (e: UpdateState) => void) => m().onUpdateEvent((e) => cb(e as UpdateState)),
};

/** The error message of a failed IPC call, without Electron's wrapper text. */
export function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}

export function theoremName(problem: string): string {
  return /^theorem\s+([^\s:({[]+)/m.exec(problem)?.[1] ?? "untitled";
}
