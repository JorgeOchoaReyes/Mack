// One benchmark problem, run with a run's settings and method: shared by the
// app (electron/main.ts) and the headless runner the cloud uses
// (scripts/run-bench.ts). Nothing here touches Electron; what differs between
// the two (where keys and the Lean REPL come from, where scratch files go) is
// the host.

import { checkFromRun, type LeanCheck } from "../core/lean/check";
import type { ReplPool } from "../core/lean/repl";
import type { Analysis } from "../core/lean/sketch";
import { leanRunner } from "../core/lean/runner";
import type { ProviderId } from "../core/model/providers";
import { prove, type ProveEvent } from "../core/prove";
import type { Lemma } from "../core/prepare";
import { search } from "../core/search/search";
import { ultramath } from "../core/ultramath/swarm";
import { metered, priceFor, type Meter } from "../core/model/metered";
import { withEffort, type ModelProvider } from "../core/model/provider";
import { decompose } from "../core/decompose";
import { stepSearch } from "../core/stepsearch";
import { helperLemmas, relevantLemmas } from "../core/bench/pool";
import { easierVersions } from "../core/variants";
import { attemptKind, classifyFailure, LOG_LIMITS, splitReply, type AttemptLog, type AttemptNote, type BenchResult, type BenchRun } from "../core/bench/bench";
import type { Settings } from "./main";

/** What a benchmark run needs from where it runs. */
export type BenchHost = {
  /** A model provider for one provider id (and model, for its price), with its key. */
  makeProvider(s: Settings, id: ProviderId, model?: string): ModelProvider;
  /** The quick check on the Lean REPL, sized for `size` attempts at once; none without the REPL. Also sets how many fresh Lean runs may go at once. */
  quickCheck(s: Settings, size: number): ((src: string) => Promise<LeanCheck>) | undefined;
  /** The REPL pool `quickCheck` started, for step-by-step search. */
  replPool(): ReplPool | undefined;
  /** Upstream's sketch analysis on the REPL, for the search tree. */
  sketchFor(frozen: string): ((file: string) => Promise<Analysis>) | undefined;
  mathlibHints(names: string[]): Promise<string>;
  mathlibRenames(names: string[]): Promise<Record<string, string>>;
  premisesFor(s: Settings, frozen: string): Promise<string>;
  /** Earlier proofs of similar statements, as examples; benchmarks never use them. */
  examples(problem: string): string;
  /** A scratch folder path for a search's workspace. */
  scratch(...parts: string[]): string;
};

/** The prover models named in Settings (comma-separated), each priced into the same meter as the run's main model; empty when none is set. */
export const proverModels = (s: Settings) =>
  s.proverModel
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);

function proversFor(host: BenchHost, s: Settings, meter: Meter, hooks: { onCharge?: (m: Meter) => void; onCap?: (why: string) => void }): { provider: ModelProvider; model: string }[] {
  return proverModels(s).map((model) => ({ provider: metered(withEffort(host.makeProvider(s, s.proverProvider, model), s.proofEffort), priceFor(s.prices, model, s.assumedPrice).price, meter, hooks), model }));
}

export const parallelOf = (s: Settings) => Math.max(1, Math.min(32, Math.floor(s.parallelAttempts) || 1));

/**
 * A single or decompose proof run of `problem` with the settings' attempts, prover models, automation and
 * reuse of earlier proofs; with `easierFirst`, easier versions are proved first and offered as lemmas.
 * Shared by proof runs and the benchmark.
 */
export async function attemptProof(
  host: BenchHost,
  s: Settings,
  mode: "single" | "decompose",
  problem: string,
  o: {
    provider: ModelProvider;
    model: string;
    meter: Meter;
    hooks: { onCharge?: (m: Meter) => void; onCap?: (why: string) => void };
    run: ReturnType<typeof leanRunner>;
    prepare?: { checkStatement: boolean; idea: boolean };
    lemmas?: Lemma[];
    signal: AbortSignal;
    onEvent: (e: ProveEvent) => void;
  },
): Promise<void> {
  const parallel = parallelOf(s);
  const base = {
    provider: o.provider,
    model: o.model,
    run: o.run,
    check: host.quickCheck(s, parallel),
    parallel,
    lookup: host.mathlibHints,
    rename: host.mathlibRenames,
    provers: proversFor(host, s, o.meter, o.hooks),
    revisions: s.revisionsPerChain,
    automation: s.leanAutomation,
    premises: s.premiseSelection ? (frozen: string) => host.premisesFor(s, frozen) : undefined,
    signal: o.signal,
  };
  let lemmas = o.lemmas ?? [];
  if (s.easierFirst) {
    const check = base.check ?? (async (src: string) => checkFromRun(await o.run(src)));
    const easier = await easierVersions({
      frozen: problem,
      provider: o.provider,
      model: o.model,
      check,
      signal: o.signal,
      onStatus: (message) => o.onEvent({ type: "status", message }),
      prove: async (v) => {
        let proof: string | null = null;
        await prove({ ...base, frozen: v, maxAttempts: Math.max(2, Math.min(8, Math.floor(s.maxAttempts / 4))), onEvent: (e) => e.type === "solved" && (proof = e.proof) });
        return proof;
      },
    });
    lemmas = [...easier, ...lemmas];
  }
  const options = {
    ...base,
    frozen: problem,
    maxAttempts: s.maxAttempts,
    prepare: o.prepare,
    lemmas,
    examples: s.reuseProofs ? host.examples(problem) : "",
    onEvent: o.onEvent,
  };
  if (mode === "decompose") await decompose({ ...options, maxDepth: s.decomposeDepth, lemmaAttempts: s.decomposeAttempts, rounds: s.decomposeRounds });
  else await prove(options);
}

export async function benchOne(host: BenchHost, s: Settings, p: { id: string; source: string }, bench: BenchRun, signal: AbortSignal, status: (m: string) => void, pool: Lemma[] = []): Promise<BenchResult> {
  const t0 = Date.now();
  const model = s.models[s.provider];
  const left = bench.budget > 0 ? bench.budget - bench.results.reduce((a, r) => a + r.usd, 0) : 0;
  const meter: Meter = { spent: 0, limit: Math.max(0, left), estimated: false };
  const ctl = new AbortController();
  const hooks = { onCap: () => ctl.abort() };
  const provider = metered(withEffort(host.makeProvider(s, s.provider), s.proofEffort), priceFor(s.prices, model, s.assumedPrice).price, meter, hooks);
  // A stop kills this problem's Lean runs at once, as well as its model calls.
  const run = leanRunner({ workspace: s.leanWorkspace, timeoutMs: s.timeoutMs, signal: AbortSignal.any([signal, ctl.signal]) });
  let attempts = 0;
  let proof: string | undefined;
  let message = "";
  // How each attempt ended, to say afterwards why the problem was not solved.
  const notes: AttemptNote[] = [];
  let lastCandidate = "";
  const log: AttemptLog[] = [];
  const timeline: { t: number; message: string }[] = [];
  // The run's own steps, once each and in order: everything the agent did besides its attempts.
  const trace = (message: string) => {
    if (timeline.length < LOG_LIMITS.timeline && timeline[timeline.length - 1]?.message !== message) timeline.push({ t: Date.now() - t0, message: message.slice(0, LOG_LIMITS.step) });
  };
  // Every method's attempts land in one log: a Mack attempt, a search node, or a swarm member's turn.
  const onEvent = (ev: ProveEvent) => {
      if (ev.type === "attempt") {
        if (log.length < LOG_LIMITS.attempts) {
          const { thinking, prose } = splitReply(ev.reply ?? "", ev.reasoning);
          log.push({
            n: ev.n,
            outcome: ev.outcome,
            kind: ev.outcome === "verified" ? "verified" : attemptKind(ev),
            ...(ev.model ? { model: ev.model } : {}),
            ...(ev.at ? { at: new Date(ev.at).toISOString() } : {}),
            ms: ev.ms,
            tokens: ev.tokens,
            ...(ev.promptTokens ? { promptTokens: ev.promptTokens } : {}),
            ...(ev.truncated ? { truncated: true } : {}),
            detail: ev.detail.slice(0, LOG_LIMITS.detail),
            candidate: ev.candidate.slice(0, LOG_LIMITS.candidate),
            ...(thinking ? { thinking: thinking.slice(0, LOG_LIMITS.thinking) } : {}),
            ...(prose ? { prose: prose.slice(0, LOG_LIMITS.prose) } : {}),
          });
        }
      }
      if (ev.type === "attempt" && ev.n > 0) {
        attempts++;
        if (ev.outcome !== "verified") {
          notes.push({ outcome: ev.outcome, detail: ev.detail });
          lastCandidate = ev.candidate;
        }
      }
      if (ev.type === "solved") proof = ev.proof;
      if (ev.type === "failed") message = ev.message;
      if (ev.type === "status") {
        status(ev.message);
        trace(ev.message);
      }
      if (ev.type === "idea") trace(`The plan in words, which every attempt was given:\n${ev.text}`);
      if (ev.type === "statementCheck") trace(`Statement check: ${JSON.stringify(ev.check).slice(0, 400)}`);
  };
  const both = AbortSignal.any([signal, ctl.signal]);
  const method = bench.config.method ?? "single";
  const check = () => (async (src: string) => checkFromRun(await run(src)));
  if (method === "search") {
    await search({
      frozen: p.source,
      provider,
      model,
      run,
      check: host.quickCheck(s, Math.min(2, s.search.w)) ?? check(),
      prepare: { checkStatement: false, idea: s.proofIdea },
      lookup: host.mathlibHints,
      limits: s.search,
      analysis: s.searchAnalysis,
      sketch: host.sketchFor(p.source),
      worker: s.searchWorker,
      workspace: host.scratch("bench-workspaces", bench.id, p.id),
      signal: both,
      onEvent: (ev) => {
        if (ev.type === "node") {
          const n = ev.node;
          const outcome = n.status === "invalid" ? "refused" : n.status === "complete" ? "rejected" : n.status;
          onEvent({ type: "attempt", n: n.id + 1, candidate: n.file, outcome, detail: n.detail, ms: ev.ms, tokens: ev.tokens, model, at: Date.now() - ev.ms });
          trace(`Node ${n.id + 1}${n.parent !== null ? ` (from node ${n.parent + 1})` : ""}, round ${n.round}: ${n.status}, score ${n.score.toFixed(2)}${n.approach ? `. Approach: ${n.approach}` : ""}`);
        } else if (ev.type === "round") trace(`Round ${ev.round}: continuing node${ev.batch.length === 1 ? "" : "s"} ${ev.batch.map((b) => b + 1).join(", ")}`);
        else if (ev.type === "solved" || ev.type === "failed" || ev.type === "status" || ev.type === "idea" || ev.type === "statementCheck") onEvent(ev);
      },
    });
  } else if (method === "steps") {
    host.quickCheck(s, 2);
    const pool = host.replPool();
    if (!pool) onEvent({ type: "failed", message: "Step by step needs the Lean REPL, and it is not running." });
    else
      await stepSearch({
        frozen: p.source,
        provider,
        model,
        session: pool.session,
        run,
        maxCalls: s.maxAttempts,
        automation: s.leanAutomation,
        notes: s.premiseSelection ? await host.premisesFor(s, p.source).catch(() => "") : "",
        signal: both,
        onEvent,
      });
  } else if (method === "ultramath") {
    let turn = 0;
    await ultramath({
      problem: p.source,
      provider,
      model,
      run,
      check: host.quickCheck(s, 2) ?? check(),
      limits: s.ultramath,
      signal: both,
      onEvent: (ev) => {
        if (ev.type === "turn") {
          // A member's turn is the swarm's attempt: what its Lean check said, when it ran one, judges it.
          const said = ev.check ?? "";
          const outcome = !said ? "no verdict" : /error/i.test(said) ? "errors" : /sorry/i.test(said) ? "sorries" : "rejected";
          onEvent({ type: "attempt", n: ++turn, candidate: ev.summary, outcome, detail: said || "(the member ran no Lean check this turn)", ms: 0, tokens: ev.tokens, model: `${model} · member ${ev.member}`, at: Date.now() });
          trace(`Member ${ev.member}, round ${ev.round}: ${ev.summary}`);
        } else if (ev.type === "direction") trace(`A member registered a direction: ${JSON.stringify(ev.direction).slice(0, 600)}`);
        else if (ev.type === "refused") trace(`Member ${ev.member}'s direction was refused (${ev.reason}): ${ev.text}`);
        else if (ev.type === "post") trace(`Board post: ${JSON.stringify(ev.post).slice(0, 800)}`);
        else if (ev.type === "report") trace(`Member ${ev.member} reported (${ev.accepted ? "accepted" : "not accepted"}: ${ev.reason}): ${ev.report}`);
        else if (ev.type === "solved" || ev.type === "failed" || ev.type === "status") onEvent(ev);
      },
    });
  } else {
    // Lemmas this run proved on earlier problems, the ones related to this statement.
    const offered = bench.config.lemmaPool ? relevantLemmas(pool, p.source) : [];
    if (offered.length) trace(`Offered ${offered.length} lemma${offered.length === 1 ? "" : "s"} proved earlier in this run: ${offered.map((l) => /^(?:private\s+)?(?:theorem|lemma)\s+(\S+)/.exec(l.source)?.[1] ?? "?").join(", ")}`);
    // Never the person's own past proofs as examples: they are private, so no one else could reproduce the run.
    await attemptProof(host, { ...s, reuseProofs: false }, method, p.source, {
      lemmas: offered,
      provider,
      model,
      meter,
      hooks,
      run,
      // Benchmark statements are known to be right; the random tester would only spend time.
      prepare: { checkStatement: false, idea: s.proofIdea },
      signal: both,
      onEvent,
    });
  }
  if (proof && bench.config.lemmaPool) pool.push(...helperLemmas(proof, p.source, p.id));
  if (proof) return { id: p.id, outcome: "solved", attempts, ms: Date.now() - t0, usd: meter.spent, proof, log, timeline };
  const outcomes: Record<string, number> = {};
  for (const n of notes) outcomes[n.outcome] = (outcomes[n.outcome] ?? 0) + 1;
  const failure = classifyFailure(notes, message);
  return {
    id: p.id,
    outcome: "failed",
    attempts,
    ms: Date.now() - t0,
    usd: meter.spent,
    message,
    failure,
    outcomes,
    ...(notes.length ? { lastError: notes[notes.length - 1].detail.slice(0, 2000), lastCandidate: lastCandidate.slice(0, 4000) } : {}),
    log,
    timeline,
  };
}
