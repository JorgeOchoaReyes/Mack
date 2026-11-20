// The chat's construction searches (core/construct/search.ts): started by the
// chat's agent with the person's approval, run on their own, and reported to
// the chat that started them when they end. A search belongs to its chat:
// tools name it by the chat, never by an argument alone.

import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { confine, type ToolSpec } from "../chat/tools";
import type { ModelProvider } from "../model/provider";
import { constructionSearch, findPython, ranked, type Candidate } from "./search";

export const CONSTRUCT_TOOLS: ToolSpec[] = [
  {
    name: "construction_search",
    description:
      "Search for a construction (a configuration, a counterexample, a better bound) the way FunSearch and AlphaEvolve do: the model writes Python programs whose construct() builds a candidate, the evaluator you wrote scores each, and the best programs go back to the model to improve. Runs model-written Python on the person's computer, in constructions/<name>/ of the project. Needs the person's approval. Returns at once; this chat is told when it ends. A score is evidence about the object, not a proof.",
    args: {
      name: "a short lowercase name, e.g. sum-free-20",
      task: "what to construct and what makes one better, in words",
      evaluator: "a .py file of the project defining evaluate(construction) -> float (higher is better, None for invalid); the construction arrives as a Python literal",
      "programs?": "model calls, one program each (default 20, at most 200)",
      "keep?": "how many of the best programs the model sees (default 4, at most 8)",
      "timeout_s?": "seconds per program, building and scoring (default 30, at most 600)",
    },
    protected: true,
  },
  { name: "construction_status", description: "A construction search's progress: the best score, its program and construction, and what failed. Without `name`, this chat's latest.", args: { "name?": "the search" }, protected: false },
  { name: "construction_stop", description: "Stop a construction search; what it found is kept.", args: { name: "the search" }, protected: false },
];

type Search = {
  name: string;
  projectId: string;
  sessionId: string;
  root: string;
  dir: string;
  budget: number;
  ctl: AbortController;
  cands: Candidate[];
  state: "running" | "finished" | "stopped" | "failed";
  error?: string;
  startedAt: number;
};

export type ConstructDeps = {
  /** A metered provider and model for one search. */
  provider: (search: string) => { provider: ModelProvider; model: string };
  /** Tell a chat that something it started has ended. */
  wake: (projectId: string, sessionId: string, text: string) => void;
};

const int = (v: unknown, def: number, min: number, max: number) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && v !== undefined && v !== null && v !== "" ? Math.max(min, Math.min(max, n)) : def;
};

export class ConstructionService {
  private searches = new Map<string, Search>();

  constructor(private readonly deps: ConstructDeps) {}

  async start(projectId: string, root: string, sessionId: string, a: Record<string, unknown>): Promise<string> {
    const name = typeof a.name === "string" ? a.name.trim() : "";
    if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(name)) throw new Error("`name` is a short lowercase name of letters, digits and dashes");
    const key = `${projectId}/${name}`;
    if (this.searches.get(key)?.state === "running") throw new Error(`the search ${name} is already running`);
    const task = typeof a.task === "string" ? a.task.trim() : "";
    if (!task) throw new Error("`task` says what to construct");
    if (typeof a.evaluator !== "string" || !a.evaluator.endsWith(".py")) throw new Error("`evaluator` is a .py file of the project");
    const evaluatorPath = await confine(root, a.evaluator);
    if (!existsSync(evaluatorPath)) throw new Error(`there is no ${a.evaluator} in the project`);
    const evaluatorSource = readFileSync(evaluatorPath, "utf8");
    if (!/\bdef\s+evaluate\s*\(/.test(evaluatorSource)) throw new Error(`${a.evaluator} defines no evaluate(construction)`);
    const python = await findPython();
    if (!python) throw new Error("Python is not installed or not on PATH: install it from https://www.python.org and start Mack again");

    const s: Search = {
      name,
      projectId,
      sessionId,
      root,
      dir: await confine(root, join("constructions", name)),
      budget: int(a.programs, 20, 1, 200),
      ctl: new AbortController(),
      cands: [],
      state: "running",
      startedAt: Date.now(),
    };
    this.searches.set(key, s);
    const { provider, model } = this.deps.provider(key);
    void constructionSearch({
      task,
      evaluatorSource,
      evaluatorPath,
      dir: s.dir,
      provider,
      model,
      budget: s.budget,
      keep: int(a.keep, 4, 1, 8),
      timeoutMs: int(a.timeout_s, 30, 5, 600) * 1000,
      python,
      signal: s.ctl.signal,
      onEvent: (e) => {
        if (e.type === "candidate") s.cands.push(e.candidate);
      },
    })
      .then(() => {
        if (s.state === "running") s.state = "finished";
      })
      .catch((e: Error) => {
        s.state = s.ctl.signal.aborted ? "stopped" : "failed";
        s.error = e.message;
      })
      .finally(() => this.deps.wake(projectId, sessionId, `Construction search ${name} ${s.state}.\n${this.describe(s)}`));
    return `started construction search ${name}: up to ${s.budget} programs, kept in ${relative(root, s.dir)}. It runs on its own; this chat is told when it ends. Check construction_status meanwhile.`;
  }

  private mine(sessionId: string, name?: unknown): Search {
    const all = [...this.searches.values()].filter((s) => s.sessionId === sessionId);
    const s = typeof name === "string" && name ? all.find((x) => x.name === name) : all.sort((a, b) => b.startedAt - a.startedAt)[0];
    if (!s) throw new Error(typeof name === "string" && name ? `no construction search ${name} in this chat` : "this chat has no construction search");
    return s;
  }

  describe(s: Search): string {
    const scored = s.cands.filter((c) => c.score !== null).length;
    const lines = [`${s.state}, ${s.cands.length} of ${s.budget} programs run, ${scored} scored, ${s.cands.length - scored} failed.${s.error ? ` ${s.error}` : ""}`];
    const top = ranked(s.cands, 3);
    if (top.length) {
      const best = top[0];
      lines.push(`Best: score ${best.score} from program ${best.id}${best.idea ? ` (${best.idea})` : ""}; the program is ${relative(s.root, join(s.dir, "best.py"))}.`);
      if (best.construction) lines.push(`Its construction: ${best.construction.slice(0, 600)}`);
      if (top.length > 1) lines.push(`Next best: ${top.slice(1).map((c) => `program ${c.id}, score ${c.score}`).join("; ")}.`);
    } else lines.push("No program has scored yet.");
    const failed = s.cands.filter((c) => c.score === null).slice(-2);
    if (failed.length) lines.push(`Recent failures: ${failed.map((c) => `program ${c.id}: ${(c.error ?? "").split("\n").filter(Boolean).slice(-1)[0]?.slice(0, 200) ?? ""}`).join("; ")}`);
    return lines.join("\n");
  }

  status(sessionId: string, name?: unknown): string {
    const s = this.mine(sessionId, name);
    return `${s.name}: ${this.describe(s)}`;
  }

  stop(sessionId: string, name: unknown): string {
    const s = this.mine(sessionId, name);
    if (s.state !== "running") return `${s.name} has already ${s.state}`;
    s.state = "stopped";
    s.ctl.abort();
    return `stopping ${s.name}; what it found is kept in ${relative(s.root, s.dir)}`;
  }

  stopAll(): void {
    for (const s of this.searches.values()) if (s.state === "running") s.ctl.abort();
  }
}
