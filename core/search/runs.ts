// Proof-search runs over problem sets, adapted from open-math-harness
// `interfaces/discovery` and `program-files/discovery` (Apache-2.0).
//
// A run executes one task (problems, limits, worker kind, concurrency) and
// belongs to a project; its name is unique. Each problem is its own rollout
// with its own journal, `<runs>/<run>/<problem>/journal.jsonl`, so a run is
// shown from what it recorded and resumed from it. A run is asynchronous to
// whoever started it: `start` returns once it is queued, and `status` groups
// what keeps going wrong (`failureReasons`) so a chat can stop a run stuck on
// one reason. Stopping kills the run's work; nothing it did is undone. A
// resume is a new execution of what the journal recorded: completed problems
// stay completed, the others continue from their recorded tree, rounds and
// spent calls. A problem interrupted mid-round loses that round's unfinished
// workers, as upstream's does.

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SearchNode } from "./tree";
import type { JournalEntry, SearchEvent } from "./search";
import type { Limits } from "./tree";

export type Problem = { id: string; frozen: string };
export type RunTask = { name: string; project: string; problems: Problem[]; limits: Limits; worker: "fixed" | "tool"; concurrency: number; analysis: boolean };
export type ProblemState = "queued" | "running" | "solved" | "exhausted" | "stopped" | "failed";
export type ProblemStatus = { id: string; state: ProblemState; nodes: number; best: number; message?: string; proof?: string };
export type RunStatus = {
  name: string;
  project: string;
  state: "running" | "ended" | "stopped" | "interrupted";
  startedAt: number;
  endedAt?: number;
  problems: ProblemStatus[];
  failureReasons: { reason: string; count: number }[];
  /** USD the run has spent, across resumes. */
  spentUsd?: number;
};

/** Runs one problem's rollout: the search, given its journal and what to resume from. */
export type Rollout = (o: {
  problem: Problem;
  task: RunTask;
  workspace: string;
  resume?: { nodes: SearchNode[]; rounds: number; calls: number };
  journal: (e: JournalEntry) => void;
  onEvent: (e: SearchEvent) => void;
  signal: AbortSignal;
}) => Promise<void>;

const NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

export function readJournal(file: string): JournalEntry[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as JournalEntry];
      } catch {
        // A line cut by a crash is not a record.
        return [];
      }
    });
}

/** What a journal says: the tree, the rounds done, the calls spent, and how it ended if it did. */
export function replay(entries: JournalEntry[], frozen: string): { nodes: SearchNode[]; rounds: number; calls: number; end?: "solved" | "exhausted" | "stopped" } {
  const nodes: SearchNode[] = [{ id: 0, parent: null, depth: 0, file: frozen, status: "sorries", score: 0.5, detail: "", errors: 0, sorries: 1, continued: 0, round: 0, approach: "the frozen statement" }];
  let rounds = 0;
  let calls = 0;
  let end: "solved" | "exhausted" | "stopped" | undefined;
  for (const e of entries) {
    if (e.kind === "round") rounds = Math.max(rounds, e.round);
    if (e.kind === "node") {
      nodes[e.node.id] = { ...e.node };
      calls += e.calls;
      if (e.node.parent !== null && nodes[e.node.parent]) nodes[e.node.parent].continued++;
    }
    if (e.kind === "end") end = e.outcome;
  }
  // A round whose workers did not all finish is redone: count it as not done.
  const complete = nodes.filter(Boolean);
  if (end !== "solved" && end !== "exhausted" && rounds > 0 && !complete.some((n) => n.round === rounds)) rounds--;
  if (complete.some((n) => n.status === "verified")) end = "solved";
  return { nodes: complete, rounds, calls, end };
}

/** What keeps going wrong across a run's nodes: statuses and the first line of their errors, most frequent first. */
export function failureReasons(nodes: SearchNode[]): { reason: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const n of nodes) {
    if (n.parent === null || n.status === "verified") continue;
    const first = (n.detail.split("\n").find((l) => /error|refused|rejected|deadline|not /i.test(l)) ?? "").trim();
    const reason = `${n.status}${first ? `: ${first.replace(/line \d+, column \d+/g, "line ?").slice(0, 120)}` : ""}`;
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
}

export class RunManager {
  private live = new Map<string, { ctl: AbortController; status: RunStatus }>();

  constructor(
    private readonly root: string,
    private readonly rollout: Rollout,
    private readonly onEnd: (status: RunStatus) => void = () => {},
  ) {
    mkdirSync(root, { recursive: true });
  }

  private dir = (run: string) => join(this.root, run);
  private taskOf = (run: string): RunTask => JSON.parse(readFileSync(join(this.dir(run), "task.json"), "utf8")) as RunTask;
  private safe(run: string): string {
    if (!NAME.test(run)) throw new Error("a run name is letters, digits, dots, dashes and underscores");
    return run;
  }

  start(task: RunTask): RunStatus {
    this.safe(task.name);
    if (existsSync(this.dir(task.name))) throw new Error(`a run named ${task.name} already exists`);
    if (!task.problems.length) throw new Error("the task has no problems");
    for (const p of task.problems) if (!NAME.test(p.id)) throw new Error(`bad problem id ${p.id}`);
    if (new Set(task.problems.map((p) => p.id)).size !== task.problems.length) throw new Error("problem ids must be unique");
    mkdirSync(this.dir(task.name), { recursive: true });
    writeFileSync(join(this.dir(task.name), "task.json"), JSON.stringify(task, null, 2));
    return this.execute(task);
  }

  resume(run: string): RunStatus {
    this.safe(run);
    if (this.live.has(run)) throw new Error(`${run} is still running`);
    if (!existsSync(join(this.dir(run), "task.json"))) throw new Error(`no run named ${run}`);
    return this.execute(this.taskOf(run));
  }

  stop(run: string): void {
    const l = this.live.get(this.safe(run));
    if (!l) throw new Error(`${run} is not running`);
    l.ctl.abort();
  }

  stopAll(): void {
    for (const l of this.live.values()) l.ctl.abort();
  }

  private execute(task: RunTask): RunStatus {
    const ctl = new AbortController();
    const before = existsSync(join(this.dir(task.name), "status.json")) ? (JSON.parse(readFileSync(join(this.dir(task.name), "status.json"), "utf8")) as RunStatus).spentUsd : undefined;
    const status: RunStatus = { name: task.name, project: task.project, state: "running", startedAt: Date.now(), problems: [], failureReasons: [], spentUsd: before };
    const recorded = task.problems.map((p) => ({ p, r: replay(readJournal(join(this.dir(task.name), p.id, "journal.jsonl")), p.frozen) }));
    status.problems = recorded.map(({ p, r }) => ({
      id: p.id,
      state: r.end === "solved" ? "solved" : r.end === "exhausted" ? "exhausted" : "queued",
      nodes: r.nodes.length - 1,
      best: Math.max(0, ...r.nodes.slice(1).map((n) => n.score)),
      proof: r.nodes.find((n) => n.status === "verified")?.file,
    }));
    this.live.set(task.name, { ctl, status });
    const queue = recorded.filter(({ r }) => r.end !== "solved" && r.end !== "exhausted");
    const runOne = async ({ p, r }: (typeof recorded)[number]) => {
      const ps = status.problems.find((x) => x.id === p.id)!;
      const pdir = join(this.dir(task.name), p.id);
      mkdirSync(pdir, { recursive: true });
      ps.state = "running";
      this.save(status);
      const nodes = [...r.nodes];
      try {
        await this.rollout({
          problem: p,
          task,
          workspace: join(pdir, "ws"),
          resume: r.nodes.length > 1 || r.rounds > 0 ? { nodes: r.nodes, rounds: r.rounds, calls: r.calls } : undefined,
          signal: ctl.signal,
          journal: (e) => {
            appendFileSync(join(pdir, "journal.jsonl"), `${JSON.stringify(e)}\n`);
            if (e.kind === "node") {
              nodes.push(e.node);
              ps.nodes = nodes.length - 1;
              ps.best = Math.max(ps.best, e.node.score);
              status.failureReasons = failureReasons(this.allNodes(task));
              this.save(status);
            }
          },
          onEvent: (e) => {
            if (e.type === "solved") {
              ps.state = "solved";
              ps.proof = e.proof;
            }
            if (e.type === "failed") {
              ps.state = ctl.signal.aborted ? "stopped" : e.message.startsWith("No verified proof") ? "exhausted" : "failed";
              ps.message = e.message;
            }
          },
        });
        if (ps.state === "running") ps.state = ctl.signal.aborted ? "stopped" : "exhausted";
      } catch (e) {
        ps.state = "failed";
        ps.message = (e as Error).message;
      }
      this.save(status);
    };
    void (async () => {
      const workers = Array.from({ length: Math.max(1, Math.min(task.concurrency, queue.length)) }, async () => {
        for (let next = queue.shift(); next && !ctl.signal.aborted; next = queue.shift()) await runOne(next);
      });
      await Promise.all(workers);
      for (const ps of status.problems) if (ps.state === "queued" || ps.state === "running") ps.state = "stopped";
      status.state = ctl.signal.aborted ? "stopped" : "ended";
      status.endedAt = Date.now();
      status.failureReasons = failureReasons(this.allNodes(task));
      this.save(status);
      this.live.delete(task.name);
      this.onEnd(status);
    })();
    this.save(status);
    return status;
  }

  /** What a running run has spent so far. */
  recordSpend(run: string, usd: number): void {
    const l = this.live.get(run);
    if (!l) return;
    l.status.spentUsd = usd;
    this.save(l.status);
  }

  private allNodes(task: RunTask): SearchNode[] {
    return task.problems.flatMap((p) => replay(readJournal(join(this.dir(task.name), p.id, "journal.jsonl")), p.frozen).nodes);
  }

  private save(status: RunStatus): void {
    writeFileSync(join(this.dir(status.name), "status.json"), JSON.stringify(status, null, 2));
  }

  status(run: string): RunStatus {
    const l = this.live.get(this.safe(run));
    if (l) return l.status;
    const file = join(this.dir(run), "status.json");
    if (!existsSync(file)) throw new Error(`no run named ${run}`);
    const s = JSON.parse(readFileSync(file, "utf8")) as RunStatus;
    // A run that was running when Mack stopped is interrupted: resume continues it.
    return s.state === "running" ? { ...s, state: "interrupted" } : s;
  }

  list(project?: string): RunStatus[] {
    return readdirSync(this.root)
      .filter((d) => existsSync(join(this.dir(d), "status.json")))
      .map((d) => this.status(d))
      .filter((s) => !project || s.project === project)
      .sort((a, b) => b.startedAt - a.startedAt);
  }

  tree(run: string, problem: string): SearchNode[] {
    const task = this.taskOf(this.safe(run));
    const p = task.problems.find((x) => x.id === problem);
    if (!p) throw new Error(`no problem ${problem} in ${run}`);
    return replay(readJournal(join(this.dir(run), p.id, "journal.jsonl")), p.frozen).nodes;
  }
}
