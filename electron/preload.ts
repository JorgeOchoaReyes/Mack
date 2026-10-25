// The only API the renderer gets. No key ever crosses it back to the page.

import { contextBridge, ipcRenderer } from "electron";

const api = {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSettings: (s: unknown) => ipcRenderer.invoke("settings:set", s),
  setKey: (key: string) => ipcRenderer.invoke("key:set", key),
  checkUpstream: () => ipcRenderer.invoke("upstream:check"),
  openGithub: (url: string) => ipcRenderer.invoke("open:github", url),
  listModels: () => ipcRenderer.invoke("models:list") as Promise<string[]>,
  startProve: (frozen: string) => ipcRenderer.invoke("prove:start", frozen),
  stopProve: () => ipcRenderer.invoke("prove:stop"),
  onProveEvent: (cb: (e: unknown) => void) => {
    const listener = (_: unknown, e: unknown) => cb(e);
    ipcRenderer.on("prove:event", listener);
    return () => {
      ipcRenderer.removeListener("prove:event", listener);
    };
  },
};

contextBridge.exposeInMainWorld("mack", api);

export type MackApi = typeof api;
