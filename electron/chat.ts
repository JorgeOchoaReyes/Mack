// The research chat's main-process side (build step 4): projects, sessions,
// the agent's turns, the approvals the person decides, and project memory.
// The renderer sees sessions and decides approvals; it never runs a tool.

import { BrowserWindow, dialog, ipcMain, type WebContents } from "electron";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { runTurn, type ChatEvent, type ChatSession } from "../core/chat/agent";
import { execute } from "../core/chat/executor";
import { consolidate, extractSession, forgetMemory, readMemory } from "../core/chat/memory";
import { TOOL_SPECS, type ToolCall } from "../core/chat/tools";
import type { LeanCheckRun } from "../core/lean/check";
import type { LeanRun } from "../core/lean/verify";
import type { ModelProvider } from "../core/model/provider";
import type { RunEvent, RunMode, RunRecord, Settings } from "./main";

export type Project = { id: string; name: string; folder: string; createdAt: number };
export type SessionSummary = Pick<ChatSession, "id" | "projectId" | "title" | "startedAt" | "updatedAt"> & { messages: number };
export type PendingApproval = { id: string; sessionId: string; call: ToolCall };
export type ChatWire = { sessionId: string; event: ChatEvent } | { sessionId: string; approval: PendingApproval } | { sessionId: string; approvalDone: string };

type Deps = {
  userData: (...p: string[]) => string;
  readSettings: () => Settings;
  makeProvider: (s: Settings) => ModelProvider;
  lean: (s: Settings) => { run: LeanRun; check?: LeanCheckRun } | undefined;
  runProof: (problem: string, mode: RunMode, forward: (ev: RunEvent) => void) => Promise<RunRecord>;
};

export const PROJECTS_ROOT = join(homedir(), "MackProjects");

export function registerChat(d: Deps): void {
  const registryPath = () => d.userData("projects.json");
  const projectData = (id: string, ...p: string[]) => d.userData("projects", id, ...p);
  const sessionsDir = (id: string) => {
    const dir = projectData(id, "sessions");
    mkdirSync(dir, { recursive: true });
    return dir;
  };
  const memoryStore = (id: string) => ({ dir: projectData(id, "memory") });
  const safeId = (id: unknown): string => {
    if (typeof id !== "string" || !/^[a-z0-9-]{1,64}$/.test(id)) throw new Error("bad id");
    return id;
  };

  const projects = (): Project[] => {
    try {
      return JSON.parse(readFileSync(registryPath(), "utf8")) as Project[];
    } catch {
      return [];
    }
  };
  const saveProjects = (ps: Project[]) => writeFileSync(registryPath(), JSON.stringify(ps, null, 2));
  const project = (id: string): Project => {
    const p = projects().find((x) => x.id === safeId(id));
    if (!p) throw new Error("no such project");
    if (!existsSync(p.folder)) throw new Error(`the project folder ${p.folder} is gone`);
    return p;
  };
  const addProject = (name: string, folder: string): Project => {
    const p: Project = { id: `p${Date.now().toString(36)}`, name: name.trim() || basename(folder), folder, createdAt: Date.now() };
    saveProjects([...projects(), p]);
    return p;
  };

  const loadSession = (projectId: string, id: string): ChatSession | null => {
    const f = join(sessionsDir(projectId), `${safeId(id)}.json`);
    return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as ChatSession) : null;
  };
  const saveSession = (s: ChatSession) => writeFileSync(join(sessionsDir(s.projectId), `${s.id}.json`), JSON.stringify(s));

  const running = new Map<string, AbortController>();
  const pending = new Map<string, { approval: PendingApproval; resolve: (ok: boolean) => void }>();

  const send = (wc: WebContents, w: ChatWire) => {
    if (!wc.isDestroyed()) wc.send("chat:event", w);
  };

  /** Read every session that changed since memory last read it, then consolidate. */
  const remember = async (projectId: string): Promise<{ extracted: number; consolidated: boolean }> => {
    const s = d.readSettings();
    const provider = d.makeProvider(s);
    const model = s.models[s.provider];
    if (!model) throw new Error("Choose a model in Setup first.");
    let extracted = 0;
    for (const f of readdirSync(sessionsDir(projectId)).filter((x) => x.endsWith(".json"))) {
      const session = loadSession(projectId, f.slice(0, -5));
      if (!session || running.has(session.id) || (session.rememberedAt ?? 0) >= session.updatedAt || session.messages.length < 2) continue;
      const messages = session.messages.flatMap((m) =>
        m.role === "tool"
          ? [{ role: "user" as const, content: `Tool results: ${m.results.map((r) => `[${r.name}] ${r.ok ? "ok" : "failed"}: ${r.output.slice(0, 1500)}`).join("\n")}` }]
          : [{ role: m.role, content: m.content }],
      );
      if (await extractSession(memoryStore(projectId), { id: session.id, startedAt: session.startedAt, messages }, provider, model)) extracted++;
      session.rememberedAt = Date.now();
      saveSession(session);
    }
    const consolidated = await consolidate(memoryStore(projectId), provider, model);
    return { extracted, consolidated };
  };

  ipcMain.handle("projects:list", () => projects());

  ipcMain.handle("projects:create", (_e, name: string) => {
    const clean = String(name).trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, "").slice(0, 60);
    if (!clean) throw new Error("give the project a name");
    const folder = join(PROJECTS_ROOT, clean);
    mkdirSync(folder, { recursive: true });
    return addProject(clean, folder);
  });

  ipcMain.handle("projects:open", async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const r = await dialog.showOpenDialog(win!, { properties: ["openDirectory", "createDirectory"], title: "Choose a project folder" });
    if (r.canceled || !r.filePaths[0]) return null;
    return addProject(basename(r.filePaths[0]), r.filePaths[0]);
  });

  /** Forget a project: its sessions and memory go; its folder and files stay. */
  ipcMain.handle("projects:remove", (_e, id: string) => {
    safeId(id);
    saveProjects(projects().filter((p) => p.id !== id));
    rmSync(projectData(id), { recursive: true, force: true });
  });

  ipcMain.handle("sessions:list", (_e, projectId: string): SessionSummary[] =>
    readdirSync(sessionsDir(safeId(projectId)))
      .filter((f) => f.endsWith(".json"))
      .flatMap((f) => {
        try {
          const s = JSON.parse(readFileSync(join(sessionsDir(projectId), f), "utf8")) as ChatSession;
          return [{ id: s.id, projectId: s.projectId, title: s.title, startedAt: s.startedAt, updatedAt: s.updatedAt, messages: s.messages.length }];
        } catch {
          return [];
        }
      })
      .sort((a, b) => b.updatedAt - a.updatedAt),
  );

  ipcMain.handle("sessions:get", (_e, projectId: string, id: string) => loadSession(safeId(projectId), id));

  ipcMain.handle("sessions:delete", (_e, projectId: string, id: string) => {
    rmSync(join(sessionsDir(safeId(projectId)), `${safeId(id)}.json`), { force: true });
  });

  ipcMain.handle("chat:send", async (e, projectId: string, sessionId: string | null, text: string) => {
    const p = project(projectId);
    const s = d.readSettings();
    const model = s.models[s.provider];
    if (!model) throw new Error("Choose a model in Setup first.");
    const provider = d.makeProvider(s);
    const session: ChatSession = (sessionId && loadSession(p.id, sessionId)) || {
      id: `s${Date.now().toString(36)}`,
      projectId: p.id,
      title: text.trim().split("\n")[0].slice(0, 60) || "New chat",
      startedAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
    };
    if (running.has(session.id)) throw new Error("this chat is still answering");
    session.messages.push({ role: "user", content: text, at: Date.now() });
    session.updatedAt = Date.now();
    saveSession(session);
    const ctl = new AbortController();
    running.set(session.id, ctl);
    const wc = e.sender;
    const lean = d.lean(s);
    void (async () => {
      try {
        await runTurn(session, {
          provider,
          model,
          projectName: p.name,
          memory: (await readMemory(memoryStore(p.id))).index,
          signal: ctl.signal,
          onEvent: (event) => {
            session.updatedAt = Date.now();
            saveSession(session);
            send(wc, { sessionId: session.id, event });
          },
          execute: (call) =>
            execute(call, {
              root: p.folder,
              lean,
              policy: s.approvals,
              signal: ctl.signal,
              ask: (recorded) =>
                new Promise<boolean>((resolve) => {
                  const approval: PendingApproval = { id: `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, sessionId: session.id, call: recorded };
                  const finish = (ok: boolean) => {
                    pending.delete(approval.id);
                    send(wc, { sessionId: session.id, approvalDone: approval.id });
                    resolve(ok);
                  };
                  pending.set(approval.id, { approval, resolve: finish });
                  // A stopped turn denies what it was waiting for.
                  ctl.signal.addEventListener("abort", () => pending.has(approval.id) && finish(false), { once: true });
                  send(wc, { sessionId: session.id, approval });
                }),
              startProof: async (problem, mode) => {
                send(wc, { sessionId: session.id, event: { type: "status", message: `A ${mode === "search" ? "search-tree" : "single-agent"} proof run is going…` } });
                const record = await d.runProof(problem, mode, (ev) => {
                  if (ev.type === "status") send(wc, { sessionId: session.id, event: { type: "status", message: ev.message } });
                });
                const solved = record.events.find((x): x is Extract<RunEvent, { type: "solved" }> => x.type === "solved");
                return solved
                  ? `verified: the strict verifier accepted a proof (run ${record.id} in History; axioms: ${solved.axioms.join(", ") || "none"}):\n\`\`\`lean\n${solved.proof}\`\`\``
                  : `no verified proof (run ${record.id} in History): ${record.message}`;
              },
            }),
        });
      } catch (err) {
        send(wc, { sessionId: session.id, event: { type: "error", message: (err as Error).message } });
      } finally {
        running.delete(session.id);
        session.updatedAt = Date.now();
        saveSession(session);
        send(wc, { sessionId: session.id, event: { type: "done" } });
      }
    })();
    return session.id;
  });

  ipcMain.handle("chat:stop", (_e, sessionId: string) => running.get(sessionId)?.abort());

  ipcMain.handle("approvals:list", () => [...pending.values()].map((p) => p.approval));

  /** The person's decision on one pending call. Single-use: a decided approval is gone. */
  ipcMain.handle("approvals:decide", (_e, id: string, approve: boolean) => {
    const p = pending.get(id);
    if (!p) throw new Error("that request is no longer waiting");
    p.resolve(approve === true);
  });

  ipcMain.handle("memory:get", async (_e, projectId: string) => readMemory(memoryStore(safeId(projectId))));
  ipcMain.handle("memory:update", async (_e, projectId: string) => remember(safeId(projectId)));
  ipcMain.handle("memory:forget", async (_e, projectId: string) => forgetMemory(memoryStore(safeId(projectId))));

  ipcMain.handle("chat:tools", () => TOOL_SPECS);
}
