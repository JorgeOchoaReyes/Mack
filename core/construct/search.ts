// Construction search: for a question whose answer is an object (a
// configuration, a counterexample, a better bound) rather than a proof. The
// method follows FunSearch and AlphaEvolve: the model writes a Python program
// whose `construct()` builds a candidate; an evaluator the person (or the
// chat's agent) wrote scores it; the best programs found so far go back to the
// model, which improves on them. Only the evaluator decides a score, never the
// model, and a high score is evidence about the object, not a proof of anything.
//
// Every candidate is model-written Python running as the person, so starting a
// search is a protected chat tool: the person approves it knowing that.

import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { killTree } from "../lean/toolchain";
import type { ChatMessage, ModelProvider } from "../model/provider";

export type Candidate = {
  id: number;
  /** The program's own account of its idea, from its first comment line. */
  idea: string;
  program: string;
  /** The evaluator's score; higher is better. Null when the candidate failed. */
  score: number | null;
  /** Why it failed, when it did. */
  error?: string;
  /** The construction as Python printed it, cut short. */
  construction?: string;
  ms: number;
};

export type ConstructEvent = { type: "status"; message: string } | { type: "candidate"; candidate: Candidate; best: Candidate | null };

export type ConstructOptions = {
  /** What to construct and what "better" means, in words. */
  task: string;
  /** The evaluator's source, shown to the model; it defines `evaluate(construction) -> float`. */
  evaluatorSource: string;
  /** The evaluator file the runner imports. */
  evaluatorPath: string;
  /** Where the search keeps its programs and log. */
  dir: string;
  provider: ModelProvider;
  model: string;
  /** Model calls: one program each. */
  budget: number;
  /** How many of the best programs the model sees. */
  keep: number;
  /** Seconds one candidate may run, construction and evaluation together. */
  timeoutMs: number;
  /** The Python executable. */
  python: string;
  signal?: AbortSignal;
  onEvent: (e: ConstructEvent) => void;
};

/**
 * The runner, in two separate processes so a candidate cannot reach its own score:
 * `build <program> <out>` writes the construction as a Python literal, and
 * `score <evaluator> <out>` reads it back with `ast.literal_eval` and scores it.
 */
export const RUNNER = `import ast, importlib.util, json, math, sys, traceback

def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def report(value):
    print("MACK_RESULT " + json.dumps(value))

try:
    step, source, data = sys.argv[1], sys.argv[2], sys.argv[3]
    if step == "build":
        text = repr(load(source, "candidate").construct())
        ast.literal_eval(text)
        with open(data, "w", encoding="utf-8") as f:
            f.write(text)
        report({"built": len(text)})
    else:
        with open(data, encoding="utf-8") as f:
            text = f.read()
        score = load(source, "evaluator").evaluate(ast.literal_eval(text))
        if score is None or isinstance(score, bool):
            raise ValueError("evaluate returned no score (None means the construction is invalid)")
        score = float(score)
        if math.isnan(score) or math.isinf(score):
            raise ValueError("evaluate returned %r" % score)
        report({"score": score, "construction": text[:2000]})
except Exception:
    report({"error": traceback.format_exc()[-1500:]})
`;

const SYSTEM = `You are searching for a mathematical construction by writing Python programs.
Each program defines \`construct()\`, which takes no arguments and returns the construction: a value made only of numbers, strings, booleans, None, lists, tuples, sets and dicts, since it is passed to the evaluator as a Python literal. The evaluator, shown below, scores it in a separate process: higher is better, and an invalid construction scores nothing.
Reply with one complete Python program in a single \`\`\`python code block. Its first line is a comment saying the idea in one sentence.
The program may compute, search and use randomness, but must finish within the time limit. Use only the standard library unless the evaluator imports something else.
Never read or write files, use the network, or start processes: the program's only job is to return the construction.`;

/** The last ```python block of a reply, or undefined. */
export function extractPython(reply: string): string | undefined {
  const cleaned = reply.replace(/<think>[\s\S]*?<\/think>/g, "");
  const blocks = [...cleaned.matchAll(/```(?:python|py)\s*\n([\s\S]*?)```/g)].map((m) => m[1]);
  return blocks.length ? blocks[blocks.length - 1].trimEnd() + "\n" : undefined;
}

/** The runner's report, from the last `MACK_RESULT` line of its output. */
export function readResult(output: string): { score: number; construction: string } | { built: number } | { error: string } {
  const line = output
    .split(/\r?\n/)
    .reverse()
    .find((l) => l.startsWith("MACK_RESULT "));
  if (!line) return { error: output.trim().slice(-1500) || "the program printed no result" };
  try {
    const r = JSON.parse(line.slice("MACK_RESULT ".length)) as { score?: number; construction?: string; built?: number; error?: string };
    if (typeof r.score === "number" && Number.isFinite(r.score)) return { score: r.score, construction: r.construction ?? "" };
    if (typeof r.built === "number") return { built: r.built };
    return { error: r.error ?? "no score" };
  } catch {
    return { error: "the result line could not be read" };
  }
}

/** The best candidates first; failures never rank. */
export function ranked(cands: Candidate[], keep: number): Candidate[] {
  return cands
    .filter((c): c is Candidate & { score: number } => c.score !== null)
    .sort((a, b) => b.score - a.score || a.id - b.id)
    .slice(0, keep);
}

/** The model's prompt for the next program: the task, the evaluator, the best so far and what failed lately. */
export function nextPrompt(o: { task: string; evaluatorSource: string; best: Candidate[]; failures: Candidate[]; explore: boolean; timeoutS: number }): string {
  const parts = [`The task:\n${o.task.trim()}`, `The evaluator (do not change it; your construction is scored by it):\n\`\`\`python\n${o.evaluatorSource.trimEnd()}\n\`\`\``, `Time limit: ${o.timeoutS} seconds per program.`];
  if (o.best.length) {
    parts.push(
      `The best programs so far, best first:\n${o.best.map((c) => `Score ${c.score} (program ${c.id}):\n\`\`\`python\n${c.program.trimEnd()}\n\`\`\``).join("\n\n")}`,
    );
  } else parts.push("No program has scored yet.");
  if (o.failures.length) parts.push(`Recent programs that failed, and why:\n${o.failures.map((c) => `program ${c.id}: ${(c.error ?? "").split("\n").slice(-3).join(" ").slice(0, 300)}`).join("\n")}`);
  parts.push(
    o.explore || !o.best.length
      ? "Write a program that tries a genuinely different idea from those above."
      : "Write a program that improves on the best one: change what limits its score, keep what works.",
  );
  return parts.join("\n\n");
}

function runStep(python: string, dir: string, args: string[], timeoutMs: number, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve) => {
    let out = "";
    const child = spawn(python, [join(dir, "runner.py"), ...args], { cwd: dir, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const keep = (d: Buffer) => {
      out = (out + d.toString("utf8")).slice(-20_000);
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    const timer = setTimeout(() => {
      out += `\nstopped after the ${Math.round(timeoutMs / 1000)} s limit`;
      killTree(child);
    }, timeoutMs);
    const abort = () => killTree(child);
    signal?.addEventListener("abort", abort, { once: true });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve(`${out}\n${e.message}`);
    });
    child.on("close", () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      resolve(out);
    });
  });
}

/** Build a candidate's construction in one process, then score it in another. */
async function runCandidate(python: string, dir: string, file: string, evaluatorPath: string, timeoutMs: number, signal?: AbortSignal) {
  const data = file.replace(/\.py$/, ".construction.txt");
  const t0 = Date.now();
  const built = readResult(await runStep(python, dir, ["build", file, data], timeoutMs, signal));
  if (!("built" in built)) return "error" in built ? built : { error: "the program reported a score itself" };
  const left = Math.max(5_000, timeoutMs - (Date.now() - t0));
  const scored = readResult(await runStep(python, dir, ["score", evaluatorPath, data], left, signal));
  return "built" in scored ? { error: "the evaluator printed no score" } : scored;
}

/** The Python executable that answers on this computer, or undefined. */
export async function findPython(candidates = process.platform === "win32" ? ["python", "py", "python3"] : ["python3", "python"]): Promise<string | undefined> {
  for (const exe of candidates) {
    const ok = await new Promise<boolean>((resolve) => {
      const child = spawn(exe, ["--version"], { windowsHide: true, stdio: "ignore" });
      child.on("error", () => resolve(false));
      child.on("close", (code) => resolve(code === 0));
    });
    if (ok) return exe;
  }
  return undefined;
}

/** Run a search to the end of its budget (or a stop); returns every candidate, in order. */
export async function constructionSearch(o: ConstructOptions): Promise<Candidate[]> {
  mkdirSync(o.dir, { recursive: true });
  writeFileSync(join(o.dir, "runner.py"), RUNNER, "utf8");
  const cands: Candidate[] = [];
  for (let id = 1; id <= o.budget; id++) {
    if (o.signal?.aborted) break;
    // A candidate runs as the person and could rewrite the evaluator; a changed evaluator ends the search.
    if (readFileSync(o.evaluatorPath, "utf8") !== o.evaluatorSource) throw new Error(`the evaluator ${o.evaluatorPath} changed during the search; its scores can no longer be trusted`);
    const best = ranked(cands, o.keep);
    const failures = cands.filter((c) => c.score === null).slice(-3);
    // Every third program explores a new idea, so the search does not only polish one approach.
    const explore = id % 3 === 0;
    o.onEvent({ type: "status", message: `Program ${id} of ${o.budget}: the model is writing it…` });
    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM },
      { role: "user", content: nextPrompt({ task: o.task, evaluatorSource: o.evaluatorSource, best, failures, explore, timeoutS: Math.round(o.timeoutMs / 1000) }) },
    ];
    let reply: string;
    try {
      reply = (await o.provider.chat({ model: o.model, messages, maxTokens: 8192, temperature: explore ? 1 : 0.7, signal: o.signal })).content;
    } catch (e) {
      if (o.signal?.aborted) break;
      throw e;
    }
    const program = extractPython(reply);
    const started = Date.now();
    let cand: Candidate;
    if (!program) cand = { id, idea: "", program: reply.slice(0, 4000), score: null, error: "the reply held no ```python block", ms: 0 };
    else {
      const file = join(o.dir, `program-${String(id).padStart(4, "0")}.py`);
      writeFileSync(file, program, "utf8");
      o.onEvent({ type: "status", message: `Program ${id} of ${o.budget}: running and scoring it…` });
      const r = await runCandidate(o.python, o.dir, file, o.evaluatorPath, o.timeoutMs, o.signal);
      const idea = (/^\s*#\s*(.+)$/m.exec(program)?.[1] ?? "").slice(0, 200);
      cand = "score" in r ? { id, idea, program, score: r.score, construction: r.construction, ms: Date.now() - started } : { id, idea, program, score: null, error: r.error, ms: Date.now() - started };
    }
    cands.push(cand);
    appendFileSync(join(o.dir, "log.jsonl"), JSON.stringify({ ...cand, program: undefined }) + "\n");
    const top = ranked(cands, 1)[0] ?? null;
    if (top && top.id === cand.id) {
      writeFileSync(join(o.dir, "best.py"), top.program, "utf8");
      writeFileSync(join(o.dir, "best.json"), JSON.stringify({ id: top.id, score: top.score, idea: top.idea, construction: top.construction }, null, 2), "utf8");
    }
    o.onEvent({ type: "candidate", candidate: cand, best: top });
  }
  return cands;
}
