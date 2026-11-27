// `node dist-electron/scripts/run-bench.js --set minif2f-test --problems 20 --provider openrouter --model … [options]`
// A benchmark run without the app: the official runs (.github/workflows/benchmark-run.yml)
// use it on a fixed cloud machine. It runs the same code as the Benchmark screen
// (electron/bench-run.ts), with the API key from the provider's environment
// variable (FIREWORKS_API_KEY, OPENROUTER_API_KEY, …). When every problem has a
// result it writes the run as a share would (benchmarks/runs/<folder>/), ready
// for a pull request; a run cut short by a stop or its budget is never written
// there. Progress goes to stdout; with $GITHUB_OUTPUT set, it also writes
// `complete`, `folder` and `title` there.

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { BENCH_SHARE_DIR, benchSet, benchShare, benchSlug, harnessOf, pickSample, ranToEnd, runBench, summarize, type BenchMethod, type BenchRun } from "../core/bench/bench";
import { hasRepl, replPool, splitHeader, type ReplPool } from "../core/lean/repl";
import { analyzeSketch } from "../core/lean/sketch";
import { setLeanSlots, splitBudget } from "../core/lean/runner";
import { lakeVersion } from "../core/lean/toolchain";
import { describePremises, MathlibIndex, mathlibRev, mathlibSource, nameHints, premises, renameFor } from "../core/lean/mathlib-index";
import { extractStatement } from "../core/lean/rules";
import { OpenAICompatibleProvider } from "../core/model/openai-compatible";
import { PROVIDERS, providerInfo, type ProviderId } from "../core/model/providers";
import { ASSUMED_PRICE } from "../core/model/metered";
import { PROOF_EFFORTS, type ProofEffort } from "../core/model/provider";
import { DEFAULT_LIMITS } from "../core/search/tree";
import { DEFAULT_ULTRAMATH } from "../core/ultramath/swarm";
import { UPSTREAM } from "../core/upstream";
import type { Lemma } from "../core/prepare";
import { benchOne, parallelOf, proverModels, type BenchHost } from "../electron/bench-run";
import type { Settings } from "../electron/main";

const METHODS: BenchMethod[] = ["single", "decompose", "steps", "search", "ultramath"];

function args(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(argv[i]);
    if (!m) throw new Error(`unexpected argument ${argv[i]}`);
    out[m[1]] = m[2] ?? (argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true");
  }
  return out;
}

const a = args(process.argv.slice(2));
const fail = (message: string): never => {
  console.error(message);
  process.exit(2);
};
const num = (key: string, fallback: number) => (a[key] === undefined || a[key] === "" ? fallback : Number(a[key]) || fallback);
const isProvider = (id: string): id is ProviderId => PROVIDERS.some((p) => p.id === id);

const set = benchSet(a.set ?? "") ?? fail(`--set must be one of the problem sets (minif2f-test, putnambench, putnam-recent), not "${a.set ?? ""}"`);
const method = (METHODS.find((m) => m === (a.method || "single")) ?? fail(`--method must be one of ${METHODS.join(", ")}`)) as BenchMethod;
const provider = isProvider(a.provider ?? "") ? (a.provider as ProviderId) : fail(`--provider must be one of ${PROVIDERS.map((p) => p.id).join(", ")}`);
const model = (a.model ?? "").trim() || fail("--model is required");
const proverProvider = a["prover-provider"] && isProvider(a["prover-provider"]) ? (a["prover-provider"] as ProviderId) : provider;
const effort = (a.effort && (PROOF_EFFORTS as string[]).includes(a.effort) ? a.effort : "default") as ProofEffort;
const workspace = a.workspace || fail("--workspace (a Lean project with Mathlib) is required");
const scratchRoot = a.scratch || join(os.tmpdir(), "mack-bench");

const keyOf = (id: ProviderId) => process.env[providerInfo(id).keyEnv] ?? "";
for (const id of new Set([provider, ...(a.prover ? [proverProvider] : [])])) if (providerInfo(id).keyRequired && !keyOf(id)) fail(`${providerInfo(id).keyEnv} is not set: the ${providerInfo(id).label} API key.`);

const s: Settings = {
  provider,
  models: { fireworks: "", openrouter: "", cheaperinference: "", litellm: "", custom: "", [provider]: model },
  customBaseUrl: a["base-url"] ?? "",
  litellmBaseUrl: a["base-url"] ?? "",
  leanWorkspace: workspace,
  timeoutMs: num("lean-deadline", 600) * 1000,
  maxAttempts: num("attempts", 8),
  mode: "single",
  search: DEFAULT_LIMITS,
  ultramath: DEFAULT_ULTRAMATH,
  useRepl: true,
  searchWorker: "fixed",
  searchAnalysis: true,
  runConcurrency: 1,
  checkStatement: false,
  proofIdea: a["proof-idea"] !== "false",
  parallelAttempts: num("parallel", 1),
  approvals: {},
  visionModels: [],
  chatEffort: "medium",
  proofEffort: effort,
  suggestions: false,
  autopilotNewChats: false,
  maxLeanProcesses: num("lean-processes", 2),
  proverProvider,
  proverModel: a.prover ?? "",
  revisionsPerChain: num("revisions", 4),
  leanAutomation: a.automation !== "false",
  reuseProofs: false,
  decomposeDepth: 2,
  decomposeAttempts: 16,
  decomposeRounds: 2,
  easierFirst: a["easier-first"] === "true",
  premiseSelection: a.premises !== "false",
  remoteLean: { host: "", workspace: "", repl: false, processes: 1 },
  globalLimit: 0,
  globalPeriod: "total",
  maxCostPerSession: 0,
  prices: {},
  assumedPrice: ASSUMED_PRICE,
  autoUpdate: false,
  upstreamCheck: false,
  upstreamDismissed: "",
  activeProject: "",
  proveFolder: "",
};

// Mathlib's index (premises and name repair), built once per run in the scratch folder.
const index = mathlibSource(workspace) ? new MathlibIndex(workspace, join(scratchRoot, "mathlib-index.json")) : undefined;
let pool: ReplPool | undefined;

const host: BenchHost = {
  makeProvider: (st, id) => {
    const info = providerInfo(id);
    return new OpenAICompatibleProvider(info.label, info.baseUrl ?? st[info.endpointSetting ?? "customBaseUrl"], keyOf(id), {
      extraHeaders: { ...info.headers, ...(id === "openrouter" ? { "HTTP-Referer": "https://github.com/JorgeOchoaReyes/Mack", "X-Title": "Mack" } : {}) },
      reasoning: id === "openrouter" ? "openrouter" : "openai",
      prices: info.prices,
    });
  },
  quickCheck: (st, size) => {
    // As in the app: every Lean process holds Mathlib, so REPLs and fresh runs share one budget.
    const { repls, fresh } = splitBudget(Math.max(1, st.maxLeanProcesses), size);
    setLeanSlots(fresh);
    if (!repls || !st.useRepl || !hasRepl(workspace)) return undefined;
    pool ??= replPool({ workspace, size: repls, timeoutMs: st.timeoutMs });
    return pool.check;
  },
  replPool: () => pool,
  sketchFor: (frozen) => (pool ? (file) => pool!.session(splitHeader(file).header, (session) => analyzeSketch(session, frozen, file)) : undefined),
  mathlibHints: async (names) => (index && names.length ? nameHints(await index.load(), names) : ""),
  mathlibRenames: async (names) => {
    if (!index || !names.length) return {};
    const decls = await index.load();
    return Object.fromEntries(names.map((n) => [n, renameFor(decls, n)] as const).filter((x): x is [string, string] => !!x[1]));
  },
  premisesFor: async (_st, frozen) => (index ? describePremises(premises(await index.load(), extractStatement(frozen) ?? frozen)) : ""),
  examples: () => "",
  scratch: (...parts) => join(scratchRoot, ...parts),
};

void (async () => {
  mkdirSync(scratchRoot, { recursive: true });
  const appVersion = (JSON.parse(readFileSync(join(__dirname, "..", "..", "package.json"), "utf8")) as { version: string }).version;
  const sample = pickSample(set, num("problems", 20));
  const run: BenchRun = {
    id: `${Date.now()}`,
    set: set.id,
    startedAt: Date.now(),
    finishedAt: 0,
    status: "running",
    config: {
      provider,
      model,
      ...(proverModels(s).length ? { prover: proverModels(s).join(", "), proverProvider } : {}),
      maxAttempts: s.maxAttempts,
      parallel: parallelOf(s),
      automation: s.leanAutomation,
      revisions: s.revisionsPerChain,
      method,
      easierFirst: s.easierFirst,
      premises: s.premiseSelection,
      ...(effort !== "default" ? { effort } : {}),
      ...((method === "single" || method === "decompose") && a["lemma-pool"] !== "false" ? { lemmaPool: true } : {}),
    },
    sample,
    results: [],
    budget: Math.max(0, num("budget", 0)),
    label: model.split("/").pop(),
    env: {
      app: appVersion,
      platform: `${a.platform || `${process.platform} ${os.release()}`}, ${Math.round(os.totalmem() / 1024 ** 3)} GB, ${os.cpus().length} CPUs`,
      lean: (await lakeVersion(workspace).catch(() => null)) ?? undefined,
      mathlib: mathlibRev(workspace),
      leanDeadlineMs: s.timeoutMs,
      leanProcesses: s.maxLeanProcesses,
      repl: hasRepl(workspace),
      remoteLean: false,
      proofIdea: s.proofIdea,
    },
    ...(a.official ? { official: { runner: a.platform || "GitHub Actions", url: a.official } } : {}),
  };
  run.harness = harnessOf(run.config, appVersion, UPSTREAM.baseline);

  const ctl = new AbortController();
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => ctl.abort());
  const lemmaPool: Lemma[] = [];
  let done = 0;
  await runBench({
    run,
    set,
    signal: ctl.signal,
    onEvent: (ev) => {
      if (ev.type === "status") console.log(`  ${ev.id}: ${ev.message.split("\n")[0].slice(0, 160)}`);
      if (ev.type === "result") console.log(`[${++done}/${sample.length}] ${ev.result.outcome.padEnd(7)} ${ev.result.id} (${ev.result.attempts} attempts, ${Math.round(ev.result.ms / 1000)}s, $${ev.result.usd.toFixed(3)})`);
    },
    proveOne: (p, signal) => benchOne(host, s, p, run, signal, () => undefined, lemmaPool),
  });
  pool?.stop();

  const sum = summarize(run);
  console.log(`\n${sum.solved}/${sum.tried} solved (${(sum.rate * 100).toFixed(1)}%), $${sum.usd.toFixed(2)}, ${Math.round(sum.ms / 60000)} min`);
  mkdirSync(scratchRoot, { recursive: true });
  writeFileSync(join(scratchRoot, "run.json"), JSON.stringify(run, null, 2));
  // A run where Lean or the model never worked measured nothing: never shared, and the job fails so it is seen.
  const broken = run.results.length > 0 && run.results.every((r) => r.outcome !== "solved" && (r.failure === "harness" || r.failure === "model" || r.outcome === "error"));
  if (broken) {
    console.error("Every problem failed because Lean or the model could not run: check the workspace and the API key. Nothing written.");
    process.exit(1);
  }
  const complete = ranToEnd(run);
  let folder = "";
  let title = "";
  if (complete) {
    folder = benchSlug(run);
    const share = benchShare(run, set, appVersion, "", { logs: true });
    title = share.title;
    const dir = join(BENCH_SHARE_DIR, folder);
    mkdirSync(dir, { recursive: true });
    for (const [name, content] of Object.entries(share.files)) writeFileSync(join(dir, name), content);
    writeFileSync(join(scratchRoot, "pr-body.md"), share.body);
    console.log(`Written to ${dir}`);
  } else console.log("Not complete (stopped, or a problem was skipped): nothing written for a pull request.");
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `complete=${complete}\nfolder=${folder}\ntitle=${title.replace(/\n/g, " ")}\n`);
  process.exit(0);
})().catch((e: Error) => {
  console.error(e.stack ?? e.message);
  process.exit(1);
});
