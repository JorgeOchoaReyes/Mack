// A resident Lean REPL (leanprover-community/repl) for quick checks of
// partial proofs: Mathlib is imported once per process, and each check runs
// on that environment instead of starting `lake env lean` again. Replaces
// upstream's resident REPL in `program-files/lean/src/repl.rs` with the
// community REPL, built once into `<workspace>/.mack/repl` by setup.
//
// A check here is never a verdict on a finished proof: the strict verifier
// always elaborates the final candidate in a fresh `lake env lean` process.

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { LeanCheck, LeanCheckRun, LeanMessage, OpenGoal } from "./check";
import { killTree, lakeCommand, leanEnv } from "./toolchain";

export const REPL_DIR = (workspace: string) => join(workspace, ".mack", "repl");
export const replBinary = (workspace: string) =>
  join(REPL_DIR(workspace), ".lake", "build", "bin", process.platform === "win32" ? "repl.exe" : "repl");

export function hasRepl(workspace: string): boolean {
  return existsSync(replBinary(workspace));
}

/** The leading `import` lines, and the rest with those lines blanked so positions stay the file's own. */
export function splitHeader(source: string): { header: string; body: string } {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  let end = 0;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.startsWith("import ")) end = i + 1;
    else if (t !== "" && !t.startsWith("--")) break;
  }
  const header = lines.slice(0, end).filter((l) => l.trim().startsWith("import ")).join("\n");
  const body = [...Array(end).fill(""), ...lines.slice(end)].join("\n");
  return { header, body };
}

type ReplReply = {
  env?: number;
  message?: string;
  messages?: { severity: string; pos: { line: number; column: number }; data: string }[];
  sorries?: { pos: { line: number; column: number }; goal: string }[];
};

/** A REPL reply as a check. */
export function checkFromReply(reply: ReplReply): LeanCheck {
  if (reply.message !== undefined && reply.env === undefined) {
    return { status: "errors", errors: [{ line: 0, col: 0, message: reply.message }], sorries: [], output: reply.message };
  }
  const errors: LeanMessage[] = [];
  const out: string[] = [];
  for (const m of reply.messages ?? []) {
    out.push(`${m.pos.line}:${m.pos.column}: ${m.severity}: ${m.data}`);
    if (m.severity === "error") errors.push({ line: m.pos.line, col: m.pos.column, message: m.data });
  }
  const sorries: OpenGoal[] = (reply.sorries ?? []).map((s) => ({ line: s.pos.line, col: s.pos.column, goal: s.goal }));
  for (const s of sorries) out.push(`${s.line}:${s.col}: sorry, goal:\n${s.goal}`);
  return {
    status: errors.length > 0 ? "errors" : sorries.length > 0 ? "sorries" : "complete",
    errors,
    sorries,
    output: out.join("\n"),
  };
}

/** One REPL process: one command at a time, restarted after a timeout or every `recycleAfter` checks. */
class ReplProcess {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = "";
  private waiting: ((r: ReplReply | Error) => void) | null = null;
  private envs = new Map<string, number>();
  private used = 0;

  constructor(
    private readonly workspace: string,
    private readonly recycleAfter: number,
  ) {}

  private start(): ChildProcessWithoutNullStreams {
    const child = spawn(lakeCommand(), ["env", replBinary(this.workspace)], {
      cwd: this.workspace,
      env: leanEnv(),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    child.stdout.on("data", (d: Buffer) => {
      this.buffer += d.toString("utf8").replace(/\r\n/g, "\n");
      let i: number;
      while ((i = this.buffer.indexOf("\n\n")) !== -1) {
        const chunk = this.buffer.slice(0, i).trim();
        this.buffer = this.buffer.slice(i + 2);
        if (!chunk) continue;
        const w = this.waiting;
        this.waiting = null;
        try {
          w?.(JSON.parse(chunk) as ReplReply);
        } catch (e) {
          w?.(new Error(`unreadable REPL reply: ${(e as Error).message}`));
        }
      }
    });
    child.stderr.on("data", () => {});
    const gone = (why: string) => {
      if (this.child === child) this.reset();
      this.waiting?.(new Error(why));
      this.waiting = null;
    };
    child.on("error", (e) => gone(`could not start the REPL: ${e.message}`));
    child.on("close", (code) => gone(`the REPL exited with ${code}`));
    this.child = child;
    return child;
  }

  private reset(): void {
    this.child = null;
    this.buffer = "";
    this.envs.clear();
    this.used = 0;
  }

  stop(): void {
    const c = this.child;
    this.reset();
    if (c) killTree(c);
  }

  private send<T = ReplReply>(command: object, timeoutMs: number): Promise<T> {
    const child = this.child ?? this.start();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting = null;
        this.stop();
        reject(new Error(`the REPL exceeded the ${timeoutMs} ms deadline`));
      }, timeoutMs);
      this.waiting = (r) => {
        clearTimeout(timer);
        if (r instanceof Error) reject(r);
        else resolve(r as T);
      };
      child.stdin.write(`${JSON.stringify(command)}\n\n`);
    });
  }

  private async headerEnv(header: string, importTimeoutMs: number): Promise<number | ReplReply> {
    const known = this.envs.get(header);
    if (known !== undefined) return known;
    const r = await this.send({ cmd: header }, importTimeoutMs);
    if (r.env === undefined || (r.messages ?? []).some((m) => m.severity === "error")) return r;
    this.envs.set(header, r.env);
    return r.env;
  }

  /** Exclusive use of this process for a procedure that drives the REPL itself (environments, `allTactics`, tactic mode). */
  async session<T>(header: string, importTimeoutMs: number, timeoutMs: number, fn: (s: ReplSession) => Promise<T>): Promise<T> {
    if (this.used >= this.recycleAfter) this.stop();
    const env = await this.headerEnv(header, importTimeoutMs);
    if (typeof env !== "number") throw new Error(`the imports do not elaborate: ${checkFromReply(env).output.slice(0, 500)}`);
    this.used++;
    return fn({
      mathlibEnv: env,
      command: (cmd, onEnv, allTactics = false, ms = timeoutMs) => this.send<RawCommand>({ cmd, env: onEnv, ...(allTactics ? { allTactics: true } : {}) }, ms),
      tactic: (tactic, proofState, ms = timeoutMs) => this.send<RawTactic>({ tactic, proofState }, ms),
    });
  }

  async check(source: string, importTimeoutMs: number, timeoutMs: number): Promise<LeanCheck> {
    if (this.used >= this.recycleAfter) this.stop();
    const { header, body } = splitHeader(source);
    try {
      let env = this.envs.get(header);
      if (env === undefined) {
        const r = await this.send({ cmd: header }, importTimeoutMs);
        if (r.env === undefined || (r.messages ?? []).some((m) => m.severity === "error")) return checkFromReply(r);
        env = r.env;
        this.envs.set(header, env);
      }
      this.used++;
      return checkFromReply(await this.send({ cmd: body, env }, timeoutMs));
    } catch (e) {
      return { status: "noVerdict", errors: [], sorries: [], output: (e as Error).message };
    }
  }
}

export type ReplPos = { line: number; column: number };
export type RawMessage = { severity: string; pos: ReplPos; endPos?: ReplPos | null; data: string };
export type RawCommand = {
  env?: number;
  message?: string;
  messages?: RawMessage[];
  sorries?: { pos: ReplPos; endPos?: ReplPos; goal: string; proofState?: number }[];
  tactics?: { tactic: string; proofState?: number; pos: ReplPos; endPos: ReplPos; goals: string }[];
};
export type RawTactic = { proofState?: number; goals?: string[]; messages?: RawMessage[]; message?: string; proofStatus?: string };

/** A REPL held for one procedure: commands on chosen environments, `allTactics`, and tactics on proof states. */
export type ReplSession = {
  mathlibEnv: number;
  command: (cmd: string, env: number, allTactics?: boolean, timeoutMs?: number) => Promise<RawCommand>;
  tactic: (tactic: string, proofState: number, timeoutMs?: number) => Promise<RawTactic>;
};

export type ReplPool = { check: LeanCheckRun; session: <T>(header: string, fn: (s: ReplSession) => Promise<T>) => Promise<T>; stop: () => void };

/** `size` REPL processes sharing a queue; each check goes to the next free one. */
export function replPool(opts: { workspace: string; size: number; timeoutMs: number; importTimeoutMs?: number; recycleAfter?: number }): ReplPool {
  const procs = Array.from({ length: Math.max(1, opts.size) }, () => new ReplProcess(opts.workspace, opts.recycleAfter ?? 40));
  const free = [...procs];
  const queue: ((p: ReplProcess) => void)[] = [];
  const acquire = () => new Promise<ReplProcess>((resolve) => (free.length ? resolve(free.pop()!) : queue.push(resolve)));
  const release = (p: ReplProcess) => {
    const next = queue.shift();
    if (next) next(p);
    else free.push(p);
  };
  return {
    check: async (source) => {
      const p = await acquire();
      try {
        return await p.check(source, opts.importTimeoutMs ?? Math.max(opts.timeoutMs, 900_000), opts.timeoutMs);
      } finally {
        release(p);
      }
    },
    session: async (header, fn) => {
      const p = await acquire();
      try {
        return await p.session(header, opts.importTimeoutMs ?? Math.max(opts.timeoutMs, 900_000), opts.timeoutMs, fn);
      } finally {
        release(p);
      }
    },
    stop: () => procs.forEach((p) => p.stop()),
  };
}
