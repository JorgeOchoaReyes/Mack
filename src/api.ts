// Typed access to the main process (electron/preload.ts).

import type { SetupEvent } from "../core/lean/setup-steps";
import type { ProveEvent } from "../core/prove";
import type { UpstreamReport } from "../core/upstream";
import type { Health, KeySource, RunEvent, RunMode, RunRecord, RunSummary, Settings } from "../electron/main";
import type { MackApi } from "../electron/preload";

declare global {
  interface Window {
    mack: MackApi;
  }
}

export type Upstream = (UpstreamReport & { dismissed?: boolean }) | { kind: "off" };
export type { Health, KeySource, ProveEvent, RunEvent, RunMode, RunRecord, RunSummary, SetupEvent, Settings };

const m = () => window.mack;

export const api = {
  getSettings: () => m().getSettings() as Promise<Settings>,
  setSettings: (s: Partial<Settings>) => m().setSettings(s) as Promise<Settings>,
  setKey: (k: string) => m().setKey(k) as Promise<KeySource>,
  clearKey: () => m().clearKey() as Promise<KeySource>,
  health: () => m().health() as Promise<Health>,
  verifyWorkspace: () => m().verifyWorkspace(),
  pickWorkspace: () => m().pickWorkspace(),
  startSetup: () => m().startSetup(),
  stopSetup: () => m().stopSetup(),
  onSetupEvent: (cb: (e: SetupEvent) => void) => m().onSetupEvent((e) => cb(e as SetupEvent)),
  checkUpstream: () => m().checkUpstream() as Promise<Upstream>,
  openExternal: (url: string) => m().openExternal(url),
  listModels: () => m().listModels(),
  startProve: (problem: string) => m().startProve(problem),
  stopProve: () => m().stopProve(),
  onProveEvent: (cb: (e: RunEvent) => void) => m().onProveEvent((e) => cb(e as RunEvent)),
  listRuns: () => m().listRuns() as Promise<RunSummary[]>,
  getRun: (id: string) => m().getRun(id) as Promise<RunRecord | null>,
  deleteRun: (id: string) => m().deleteRun(id) as Promise<void>,
  saveLean: (name: string, text: string) => m().saveLean(name, text),
  openLean: () => m().openLean(),
};

/** The error message of a failed IPC call, without Electron's wrapper text. */
export function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}

export function theoremName(problem: string): string {
  return /^theorem\s+([^\s:({[]+)/m.exec(problem)?.[1] ?? "untitled";
}
