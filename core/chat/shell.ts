// The chat's shell (upstream `interfaces/shell` and the chat agent's
// background jobs, `program-files/chat-agent/src/jobs.rs`), Apache-2.0.
//
// A command runs in PowerShell in the project folder, with Lean's tools on
// PATH, bounded by a deadline and an output limit. It is an arbitrary command
// running as the person, so `shell_exec` is a protected tool: each command
// waits for the person's approval. A background command keeps running after
// its call has answered, and its chat is told when it ends.

import { spawn, type ChildProcess } from "node:child_process";
import { killTree, leanEnv } from "../lean/toolchain";

export const MAX_OUTPUT_CHARS = 200_000;

export type CommandResult = { code: number | null; output: string; timedOut: boolean };

function shellArgs(command: string): [string, string[]] {
  return process.platform === "win32" ? ["powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command]] : ["/bin/sh", ["-c", command]];
}

/** Keep the end of a long output: the end is where the error usually is. */
const tail = (s: string) => (s.length > MAX_OUTPUT_CHARS ? `… (${s.length - MAX_OUTPUT_CHARS} earlier characters dropped)\n${s.slice(-MAX_OUTPUT_CHARS)}` : s);

function start(cwd: string, command: string, onData: (t: string) => void): ChildProcess {
  const [exe, args] = shellArgs(command);
  const child = spawn(exe, args, { cwd, env: leanEnv(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout?.on("data", (d: Buffer) => onData(d.toString("utf8")));
  child.stderr?.on("data", (d: Buffer) => onData(d.toString("utf8")));
  return child;
}

export function runCommand(cwd: string, command: string, timeoutMs: number, signal?: AbortSignal): Promise<CommandResult> {
  return new Promise((resolve) => {
    let output = "";
    let timedOut = false;
    const child = start(cwd, command, (t) => {
      output = (output + t).slice(-MAX_OUTPUT_CHARS * 2);
    });
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutMs);
    const abort = () => killTree(child);
    signal?.addEventListener("abort", abort, { once: true });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: null, output: `${output}\n${e.message}`, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      resolve({ code, output: tail(output), timedOut });
    });
  });
}

export function describeResult(r: CommandResult, timeoutMs: number): string {
  const head = r.timedOut ? `stopped after the ${Math.round(timeoutMs / 1000)} s deadline` : `exit code ${r.code}`;
  return `${head}\n${r.output.trim() || "(no output)"}`;
}

export type Job = {
  id: string;
  sessionId: string;
  command: string;
  startedAt: number;
  endedAt?: number;
  result?: CommandResult;
  output: string;
  child: ChildProcess;
};

/** Background commands, per chat. A job's end is reported once to `onEnd`. */
export class JobManager {
  private jobs = new Map<string, Job>();
  private next = 1;

  constructor(private readonly onEnd: (job: Job) => void) {}

  start(sessionId: string, cwd: string, command: string, timeoutMs: number): Job {
    const id = `j${this.next++}`;
    const job: Job = { id, sessionId, command, startedAt: Date.now(), output: "", child: null as unknown as ChildProcess };
    let timedOut = false;
    job.child = start(cwd, command, (t) => {
      job.output = (job.output + t).slice(-MAX_OUTPUT_CHARS);
    });
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(job.child);
    }, timeoutMs);
    job.child.on("close", (code) => {
      clearTimeout(timer);
      job.endedAt = Date.now();
      job.result = { code, output: tail(job.output), timedOut };
      this.onEnd(job);
    });
    job.child.on("error", (e) => {
      job.output += `\n${e.message}`;
    });
    this.jobs.set(id, job);
    return job;
  }

  list(sessionId: string): string {
    const mine = [...this.jobs.values()].filter((j) => j.sessionId === sessionId);
    if (!mine.length) return "no background commands";
    return mine
      .map((j) => `${j.id}: ${j.endedAt ? (j.result?.timedOut ? "stopped at its deadline" : `ended, exit code ${j.result?.code}`) : "running"} — ${j.command.slice(0, 120)}`)
      .join("\n");
  }

  output(sessionId: string, id: string): string {
    const j = this.jobs.get(id);
    if (!j || j.sessionId !== sessionId) throw new Error(`no background command ${id} in this chat`);
    return j.output.trim() || "(no output yet)";
  }

  stop(sessionId: string, id: string): string {
    const j = this.jobs.get(id);
    if (!j || j.sessionId !== sessionId) throw new Error(`no background command ${id} in this chat`);
    if (j.endedAt) return `${id} had already ended`;
    killTree(j.child);
    return `stopping ${id}`;
  }

  stopAll(): void {
    for (const j of this.jobs.values()) if (!j.endedAt) killTree(j.child);
  }
}
