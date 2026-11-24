// The benchmark screen: run a fixed set of formal problems with the current
// settings and read the solve rate, so a change of model, prover model or
// attempt budget is measured instead of guessed. Earlier runs stay listed
// with the settings they used, to compare.

import { ArrowRight, BarChart3, CheckCircle2, CircleDashed, Columns3, Copy, Database, ExternalLink, FileDown, Gauge, GitPullRequest, Loader2, Play, Plus, Square, Trash2, X, XCircle, Zap } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { api, errorText, type BenchModels, type BenchResult, type BenchRun, type BenchSetInfo, type ProviderId, type Settings } from "../api";
import { PROVIDERS } from "../../core/model/providers";
import { Button, EmptyState, Field, timeAgo, Toggle } from "../components/ui";
import { formatUsd } from "../../core/model/metered";
import { BENCH_BASICS, METHOD_LABELS, type BenchMethod, FAILURES, failureBreakdown, harnessLabel, headToHead, rateRange, runMetrics, solvedWithin, summarize, timelineOf } from "../../core/bench/bench";
import { COMMUNITY_REPO } from "../../core/community";

type Props = { settings: Settings; onGo: (page: "settings" | "setup") => void };

const SIZES = [10, 20, 50, 100];

const pct = (x: number) => `${(x * 100).toFixed(x > 0 && x < 0.1 ? 1 : 0)}%`;
const secs = (ms: number) => (ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60_000)} min`);

export function BenchmarkPage({ settings, onGo }: Props) {
  const [sets, setSets] = useState<BenchSetInfo[]>([]);
  const [setId, setSetId] = useState("minif2f-test");
  const [size, setSize] = useState(20);
  const [budget, setBudget] = useState(5);
  const [method, setMethod] = useState<BenchMethod>("single");
  const [runs, setRuns] = useState<BenchRun[]>([]);
  const [live, setLive] = useState<BenchRun | null>(null);
  const [status, setStatus] = useState<{ id: string; message: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState("");
  // The models each run uses: the ones in Settings to start with; several compare on the same problems.
  const [models, setModels] = useState<BenchModels[]>(() => [{ provider: settings.provider, model: settings.models[settings.provider] ?? "", proverProvider: settings.proverProvider, proverModel: settings.proverModel }]);
  /** Runs started together and not finished yet, in order. */
  const [queued, setQueued] = useState<string[]>([]);
  const [compare, setCompare] = useState<string[]>([]);
  const [metrics, setMetrics] = useState<string | null>(null);
  const [replReady, setReplReady] = useState<boolean | null>(null);
  const [lemmaPool, setLemmaPool] = useState(true);
  /** Where each shared run's pull request stands, from GitHub. */
  const [prs, setPrs] = useState<Record<string, string>>({});

  const refresh = () => {
    void api.benchList().then((l) => (setRuns(l), setLive((cur) => cur ?? l.find((r) => r.status === "running") ?? null)));
    void api.benchPrs().then(setPrs).catch(() => undefined);
  };
  useEffect(() => {
    void api.benchSets().then(setSets);
    void api.health().then((h) => setReplReady(!!h?.hasRepl)).catch(() => setReplReady(null));
    refresh();
    return api.onBenchEvent((e) => {
      if (e.type === "started") setLive({ ...e.run, results: [...e.run.results] });
      else if (e.type === "status") setStatus({ id: e.id, message: e.message });
      else if (e.type === "result") setLive((r) => (r ? { ...r, results: [...r.results, e.result] } : r));
      else if (e.type === "finished") {
        setLive(null);
        setStatus(null);
        setQueued((q) => q.filter((id) => id !== e.run.id));
        refresh();
      }
    });
  }, []);

  const start = async () => {
    setError("");
    try {
      const started = await api.benchStart(setId, size, budget, method, models.filter((m) => m.model.trim()), { lemmaPool });
      setQueued(started.map((r) => r.id));
      setLive(started[0]);
    } catch (e) {
      setError(errorText(e));
    }
  };

  const total = sets.find((s) => s.id === setId)?.size ?? 244;
  const model = models.some((m) => m.model.trim());
  const config = [
    `${settings.maxAttempts} attempts`,
    `${settings.parallelAttempts} at once`,
    settings.leanAutomation ? "automation on" : "automation off",
    ...(settings.easierFirst ? ["easier versions first"] : []),
  ];
  const past = runs.filter((r) => r.id !== live?.id);
  const best = past.filter((r) => r.set === setId && summarize(r).tried > 0).reduce<BenchRun | null>((b, r) => (!b || summarize(r).rate > summarize(b).rate ? r : b), null);

  return (
    <div className="page bench">
      <div className="page-head">
        <h1>Benchmark</h1>
        <p className="muted">
          Measure how strong Mack is with your settings: it tries a fixed set of competition problems formalized in Lean, and counts only proofs the strict verifier accepts. Change the model, prover model or attempts in Settings, run again on the same problems, and compare.
        </p>
      </div>

      {!live && (
        <section className="settings-group">
          <h2>New run</h2>
          <div className="grid-2">
            <Field label="Problem set" hint={sets.find((s) => s.id === setId)?.blurb}>
              <select className="input" value={setId} onChange={(e) => setSetId(e.target.value)}>
                {sets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label} ({s.size})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Problems" hint="The same number always picks the same problems, and a smaller run is part of a larger one, so results compare.">
              <select className="input" value={size} onChange={(e) => setSize(Number(e.target.value))}>
                {[...SIZES.filter((n) => n < total), total].map((n) => (
                  <option key={n} value={n}>
                    {n === total ? `All ${total}` : n}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Method"
              hint={
                method === "search" || method === "ultramath"
                  ? "Open Math Harness's own method, as Mack ports it: none of Mack's additions (automation, lemma suggestions, decompose, prover models) are used, so it is the baseline Mack's methods are measured against. Its limits are in Settings → Prover."
                  : method === "steps"
                    ? "Mack's step-by-step search: the proof is built one tactic at a time on Lean's live proof states, keeping only the steps Lean accepts and trying Lean's automation on every state. Each model call proposes several next steps; the attempt budget is the number of calls. Needs the Lean REPL."
                    : "Mack's methods. Decompose tries each problem directly, then splits it into lemmas proved at once: slower and dearer, and stronger on hard problems."
              }
            >
              <select className="input" value={method} onChange={(e) => setMethod(e.target.value as BenchMethod)}>
                {(Object.keys(METHOD_LABELS) as BenchMethod[]).map((m) => (
                  <option key={m} value={m}>
                    {METHOD_LABELS[m]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Budget for the run (USD, 0 = no limit)" hint="When it is spent, the problems left are skipped. Your global spending limit applies as well.">
              <input className="input" type="number" min={0} step={1} value={budget} onChange={(e) => setBudget(Math.max(0, Number(e.target.value) || 0))} />
            </Field>
            <Field label="Other settings used" hint={<button className="link" onClick={() => onGo("settings")}>Change them in Settings → Prover</button>}>
              <div className="bench-config muted small">{config.join(" · ")}</div>
            </Field>
          </div>
          <ModelsEditor models={models} setModels={setModels} />
          {(method === "single" || method === "decompose") && (
            <label className="row gap-sm small" title="Each run keeps its own pool: runs compared on the same problems never share lemmas.">
              <input type="checkbox" checked={lemmaPool} onChange={(e) => setLemmaPool(e.target.checked)} />
              Share proved lemmas across the run: helper lemmas from problems already solved are offered to the ones after them.
            </label>
          )}
          {!settings.remoteLean?.host && (replReady === false || !settings.useRepl) && (
            <div className="bench-warning">
              <b>The Lean REPL is {settings.useRepl ? "not built" : "turned off"}, so every Lean check reloads Mathlib.</b> A run then takes several times longer (minutes per problem before the model is even asked).{" "}
              {settings.useRepl ? "Build it in Settings → Setup → Lean (Repair or update)." : "Turn it on in Settings → Prover."}
            </div>
          )}
          <div className="row gap-sm">
            <Button variant="primary" icon={Play} onClick={() => void start()} disabled={!model}>
              {models.filter((m) => m.model.trim()).length > 1 ? `Compare ${models.filter((m) => m.model.trim()).length} models on ${size} problems` : `Run ${size} problems`}
            </Button>
            {!model && (
              <Button icon={ArrowRight} onClick={() => onGo("setup")}>
                Choose a model in Setup
              </Button>
            )}
          </div>
          {error && <p className="bad small">{error}</p>}
        </section>
      )}

      {live && <LiveRun run={live} status={status} open={open} setOpen={setOpen} queued={Math.max(0, queued.length - 1)} />}

      {metrics && runs.find((r) => r.id === metrics) && <MetricsDialog run={runs.find((r) => r.id === metrics)!} onClose={() => setMetrics(null)} />}

      {compare.length >= 2 && <Compare runs={compare.map((id) => runs.find((r) => r.id === id)).filter((r): r is BenchRun => !!r)} onClose={() => setCompare([])} />}

      <details className="bench-basics" open={runs.length === 0}>
        <summary>How to read these results</summary>
        <dl>
          {BENCH_BASICS.map((b) => (
            <div key={b.term}>
              <dt>{b.term}</dt>
              <dd>{b.text}</dd>
            </div>
          ))}
        </dl>
      </details>

      <section className="wt-section">
        <div className="row gap-sm wt-head">
          <h2>Earlier runs</h2>
          {past.some((r) => r.sharedPr) && (
            <span className="muted small">
              <GitPullRequest size={13} /> {past.filter((r) => r.sharedPr).length} shared, {past.filter((r) => prs[r.id] === "merged").length} merged, {past.filter((r) => prs[r.id] === "open").length} open
            </span>
          )}
          {past.length > 1 && (
            <span className="muted small">
              <Columns3 size={13} /> Tick runs to compare them{compare.length ? ` (${compare.length} ticked)` : ""}.
            </span>
          )}
        </div>
        {past.length === 0 ? (
          <EmptyState icon={Gauge} title="No runs yet">
            Start with 20 problems: with a cheap model it takes a while and costs little, and it gives the number every later change is compared with.
          </EmptyState>
        ) : (
          <div className="run-list">
            {past.map((r) => {
              const sum = summarize(r);
              return (
                <div key={r.id}>
                  <div className="run-row bench-row" role="button" tabIndex={0} onClick={() => setOpen(open === r.id ? null : r.id)}>
                    <input
                      type="checkbox"
                      aria-label="Compare this run"
                      checked={compare.includes(r.id)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setCompare((c) => (e.target.checked ? [...c, r.id] : c.filter((x) => x !== r.id)))}
                    />
                    <span className="run-thm">
                      {sum.solved}/{sum.tried} solved · {pct(sum.rate)}
                      {r.id === best?.id && <span className="accent small"> best</span>}
                      {r.group && <span className="muted small"> · comparison</span>}
                    </span>
                    <span className="muted small">
                      {r.config.model.split("/").pop()}
                      {r.config.prover ? ` + ${r.config.prover.split(",").map((m) => m.trim().split("/").pop()).join(", ")}` : ""} · {r.config.method && r.config.method !== "single" ? `${r.config.method} · ` : ""}{r.config.maxAttempts} attempts, {r.config.parallel} at once{r.config.automation ? "" : ", no automation"}
                    </span>
                    <span className="run-meta muted small">
                      {r.sharedPr && (
                        <button
                          className={`bench-pr pr-${prs[r.id] ?? "unknown"}`}
                          title={`Shared ${new Date(r.sharedPr.at).toLocaleString()}${r.sharedPr.logs ? ", with every attempt" : ""}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            void api.openExternal(r.sharedPr!.url);
                          }}
                        >
                          <GitPullRequest size={11} /> #{r.sharedPr.number}
                          {prs[r.id] && prs[r.id] !== "unknown" ? ` ${prs[r.id]}` : ""}
                        </button>
                      )}
                      {(r.harness || r.env) && <span className="bench-harness" title={r.harness ? `Procedures: ${r.harness.procedures.join(", ")}` : ""}>{harnessLabel(r.harness, r.env?.app)}</span>}
                      {formatUsd(sum.usd)} · {secs(sum.ms)} · {timeAgo(r.startedAt)}
                      {r.status === "stopped" ? " · stopped" : ""}
                      <button
                        className="icon-btn"
                        title="This run's metrics"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMetrics(r.id);
                        }}
                      >
                        <BarChart3 size={13} />
                      </button>
                      <button
                        className="icon-btn"
                        title="Delete this run"
                        onClick={(e) => {
                          e.stopPropagation();
                          void api.benchDelete(r.id).then(refresh);
                        }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </span>
                  </div>
                  {open === r.id && (
                    <div className="bench-detail">
                      <Breakdown results={r.results} />
                      <Share run={r} prState={prs[r.id]} onShared={refresh} />
                      <Results results={r.results} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function LiveRun({ run, status, open, setOpen, queued }: { run: BenchRun; status: { id: string; message: string } | null; open: string | null; setOpen: (id: string | null) => void; queued: number }) {
  const sum = summarize(run);
  const done = run.results.length;
  return (
    <section className="settings-group">
      <div className="row gap-sm bench-live-head">
        <h2>
          Running: {done} of {run.sample.length}
          {run.label ? <span className="muted"> · {run.label}</span> : null}
        </h2>
        {queued > 0 && <span className="muted small">then {queued} more model{queued === 1 ? "" : "s"} on the same problems</span>}
        <span className="muted small">
          {sum.solved} solved ({pct(sum.rate)}) · {formatUsd(sum.usd)} spent{run.budget ? ` of ${formatUsd(run.budget)}` : ""}
        </span>
        <Button size="sm" icon={Square} onClick={() => void api.benchStop()} title="Stop after the current problem's attempts end; the rest are marked skipped">
          Stop
        </Button>
      </div>
      <div className="bench-bar">
        <div style={{ width: `${(done / run.sample.length) * 100}%` }} />
      </div>
      {status && done < run.sample.length && (
        <p className="muted small bench-status">
          <Loader2 size={13} className="spin" /> <span className="mono">{status.id}</span>: {status.message}
        </p>
      )}
      <Breakdown results={run.results} />
      <Results results={run.results} open={open} setOpen={setOpen} />
    </section>
  );
}

function Results({ results, open, setOpen }: { results: BenchResult[]; open?: string | null; setOpen?: (id: string | null) => void }) {
  const [mine, setMine] = useState<string | null>(null);
  const shown = open !== undefined ? open : mine;
  const toggle = setOpen ?? setMine;
  if (!results.length) return null;
  return (
    <div className="bench-results">
      {results.map((r) => (
        <div key={r.id}>
          <button className="bench-result" onClick={() => toggle(shown === r.id ? null : r.id)} disabled={!r.proof && !r.message && !r.lastError && !r.log?.length}>
            {r.outcome === "solved" ? r.attempts === 0 ? <Zap size={14} className="ok" /> : <CheckCircle2 size={14} className="ok" /> : r.outcome === "skipped" ? <CircleDashed size={14} className="muted" /> : <XCircle size={14} className="bad" />}
            <span className="mono">{r.id}</span>
            <span className="muted small">
              {r.outcome === "solved" ? (r.attempts === 0 ? "closed by Lean's automation" : `solved in ${r.attempts} attempt${r.attempts === 1 ? "" : "s"}`) : r.outcome === "skipped" ? `skipped: ${r.message ?? ""}` : r.outcome === "error" ? "error" : `not solved in ${r.attempts} attempts`}
              {r.failure && <span className="bench-reason"> · {FAILURES[r.failure].label}</span>}
            </span>
            <span className="muted small">{r.outcome === "skipped" ? "" : `${secs(r.ms)} · ${formatUsd(r.usd)}`}</span>
          </button>
          {shown === r.id && (r.proof || r.message || r.lastError || r.log?.length) && (
            <div className="bench-why">
              {r.log && r.log.length > 0 && <AttemptTimeline result={r} />}
              {r.proof ? (
                <>
                  <p className="small">The verified proof</p>
                  <pre className="bench-proof">{r.proof}</pre>
                </>
              ) : r.log && r.log.length > 0 ? (
                r.message ? <p className="muted small">{r.message}</p> : null
              ) : (
                <>
                  {r.outcomes && <p className="muted small">Attempts ended: {Object.entries(r.outcomes).map(([k, v]) => `${k} ${v}`).join(", ")}</p>}
                  {r.log && r.log.length > 0 && <p className="muted small">By reason: {kindMix(r)}</p>}
                  {r.lastError && (
                    <>
                      <p className="small">Lean&apos;s last feedback</p>
                      <pre className="bench-proof">{r.lastError}</pre>
                    </>
                  )}
                  {r.lastCandidate && (
                    <>
                      <p className="small">Last attempt</p>
                      <pre className="bench-proof">{r.lastCandidate}</pre>
                    </>
                  )}
                  {!r.lastError && r.message && <pre className="bench-proof">{r.message}</pre>}
                </>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** Unsolved problems by reason, with what would help each. */
function Breakdown({ results }: { results: BenchResult[] }) {
  const rows = failureBreakdown(results);
  if (!rows.length) return null;
  const most = rows[0].count;
  return (
    <div className="bench-breakdown">
      <p className="small">Why problems were not solved</p>
      {rows.map((b) => (
        <div key={b.kind} className="bench-why-row" title={`${FAILURES[b.kind].fix}\n${b.ids.join(", ")}`}>
          <span>{FAILURES[b.kind].label}</span>
          <span className="bench-why-bar">
            <span style={{ width: `${(b.count / most) * 100}%` }} />
          </span>
          <span className="muted small">{b.count}</span>
        </div>
      ))}
    </div>
  );
}

/** Save a run's report or attempts, copy the report, or share the run as a pull request on the Mack repo, with every step shown. */
function Share({ run, prState, onShared }: { run: BenchRun; prState?: string; onShared: () => void }) {
  const id = run.id;
  const [note, setNote] = useState("");
  const [logs, setLogs] = useState(true);
  type Stage = { kind: "idle" } | { kind: "confirm" } | { kind: "sharing"; since: number } | { kind: "done"; url: string; number: number } | { kind: "error"; message: string };
  const [stage, setStage] = useState<Stage>(run.sharedPr ? { kind: "done", url: run.sharedPr.url, number: run.sharedPr.number } : { kind: "idle" });
  const [, tick] = useState(0);
  useEffect(() => {
    if (stage.kind !== "sharing") return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [stage.kind]);
  const act = async (f: () => Promise<string>) => {
    try {
      setNote(await f());
    } catch (e) {
      setNote(errorText(e));
    }
  };
  const share = () => {
    setStage({ kind: "sharing", since: Date.now() });
    void api.benchShare(id, logs).then(
      (r) => {
        setStage({ kind: "done", url: r.url, number: r.number });
        onShared();
      },
      (e) => setStage({ kind: "error", message: errorText(e) }),
    );
  };
  return (
    <div className="bench-share">
      <span className="muted small">Share this run to review where Mack loses problems: the report has the settings, the reasons, and each unsolved problem's attempts and Lean feedback. Save or copy it, or open a pull request with it on the Mack repo.</span>
      <Button size="sm" icon={FileDown} onClick={() => void act(async () => ((await api.benchExport(id)) ? "Saved." : ""))}>
        Save report
      </Button>
      <Button
        size="sm"
        icon={Copy}
        onClick={() =>
          void act(async () => {
            await navigator.clipboard.writeText(await api.benchReport(id));
            return "Copied: paste it into a chat.";
          })
        }
      >
        Copy report
      </Button>
      <Button size="sm" icon={Database} onClick={() => void act(async () => ((await api.benchDataset(id)) ? "Saved." : ""))} title="Every attempt as JSON Lines: the model, how it ended, why, Lean's feedback and the candidate">
        Save attempts dataset
      </Button>
      {(stage.kind === "idle" || stage.kind === "error") && (
        <Button size="sm" icon={GitPullRequest} onClick={() => setStage({ kind: "confirm" })}>
          Share as a PR
        </Button>
      )}
      {note && <span className="muted small">{note}</span>}
      {stage.kind === "confirm" && (
        <div className="bench-confirm">
          <p className="small">
            This opens a <b>public</b> pull request on {COMMUNITY_REPO.owner}/{COMMUNITY_REPO.repo} under your GitHub account, with this run&apos;s report and data: the settings and model names, each problem&apos;s result, and the unsolved problems&apos; attempts and Lean feedback. No keys or project files are included.
          </p>
          <Toggle
            checked={logs}
            onChange={setLogs}
            label="Include every attempt (attempts.jsonl): each attempt's model, outcome, reason, Lean feedback, the model's thinking and the attempt itself, so the run can be analysed fully"
          />
          <div className="row gap-sm">
            <Button size="sm" variant="primary" icon={GitPullRequest} onClick={share}>
              Open the pull request
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setStage({ kind: "idle" })}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {stage.kind === "sharing" && (
        <div className="bench-status-box">
          <Loader2 size={15} className="spin" />
          <span>
            Opening the pull request on GitHub… {Math.round((Date.now() - stage.since) / 1000)}s. The first time, GitHub makes your fork of the repository, which can take up to a minute.
          </span>
        </div>
      )}
      {stage.kind === "done" && (
        <div className="bench-status-box ok-box">
          <CheckCircle2 size={15} className="ok" />
          <span>
            Shared as{" "}
            <button className="link" onClick={() => void api.openExternal(stage.url)}>
              pull request #{stage.number} <ExternalLink size={12} />
            </button>
            {prState && prState !== "unknown" ? ` · ${prState}` : ""}. It appears on the benchmark website once merged.
          </span>
        </div>
      )}
      {stage.kind === "error" && (
        <div className="bench-status-box bad-box">
          <XCircle size={15} className="bad" />
          <span>
            The pull request was not opened: {stage.message}
          </span>
        </div>
      )}
    </div>
  );
}

/** Every attempt of one problem by reason, most common first: what the single label summarizes. */
function kindMix(r: BenchResult): string {
  const counts = new Map<string, number>();
  for (const a of r.log ?? []) {
    const label = a.kind === "verified" ? "verified" : FAILURES[a.kind].label.toLowerCase();
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v}`)
    .join(", ");
}

/** The models a run uses, one row each: several rows compare them on the same problems, one after another. */
function ModelsEditor({ models, setModels }: { models: BenchModels[]; setModels: (m: BenchModels[]) => void }) {
  const set = (i: number, patch: Partial<BenchModels>) => setModels(models.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  return (
    <div className="bench-models">
      <p className="small">
        <b>Models</b> <span className="muted">· the main model plans and, without a prover model, writes the attempts. Add rows to compare models: each runs the same problems with the same settings and budget, one after another.</span>
      </p>
      {models.map((m, i) => (
        <div key={i} className="bench-model-row">
          <select className="input" value={m.provider} onChange={(e) => set(i, { provider: e.target.value as ProviderId, proverProvider: e.target.value as ProviderId })} aria-label="Provider">
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <input className="input" placeholder="main model id" value={m.model} onChange={(e) => set(i, { model: e.target.value })} aria-label="Main model" />
          <input className="input" placeholder="prover models (optional, comma-separated)" value={m.proverModel} onChange={(e) => set(i, { proverModel: e.target.value })} aria-label="Prover models" />
          {models.length > 1 && (
            <button className="icon-btn" title="Remove this model" onClick={() => setModels(models.filter((_, j) => j !== i))}>
              <X size={14} />
            </button>
          )}
        </div>
      ))}
      {models.length < 6 && (
        <button className="link small" onClick={() => setModels([...models, { ...models[models.length - 1], model: "", proverModel: "" }])}>
          <Plus size={13} /> Add a model to compare
        </button>
      )}
    </div>
  );
}

/** Ticked runs side by side: their numbers, and which problems each solved, so models compare problem by problem. */
function Compare({ runs, onClose }: { runs: BenchRun[]; onClose: () => void }) {
  if (runs.length < 2) return null;
  const sets = new Set(runs.map((r) => r.set));
  const name = (r: BenchRun) => r.label ?? `${r.config.model.split("/").pop()}${r.config.prover ? ` + ${r.config.prover.split(",").map((m) => m.trim().split("/").pop()).join(", ")}` : ""}`;
  const problems = [...new Set(runs.flatMap((r) => r.sample))];
  const solved = (r: BenchRun, id: string) => r.results.find((x) => x.id === id)?.outcome;
  const rows = problems.map((id) => ({ id, by: runs.map((r) => solved(r, id)) }));
  const tried = rows.filter((row) => row.by.some((o) => o && o !== "skipped"));
  const all = tried.filter((row) => row.by.every((o) => o === "solved")).length;
  const none = tried.filter((row) => row.by.every((o) => o !== "solved")).length;
  const only = tried.filter((row) => row.by.filter((o) => o === "solved").length === 1).length;
  return (
    <section className="settings-group bench-compare">
      <div className="row gap-sm bench-live-head">
        <h2>{runs.length === 2 ? "Head to head" : `Comparing ${runs.length} runs`}</h2>
        {runs.length > 2 && (
          <span className="muted small">
            {tried.length} problems: {all} solved by every run, {none} by none, {only} by only one
          </span>
        )}
        <button className="icon-btn" title="Close the comparison" onClick={onClose}>
          <X size={14} />
        </button>
      </div>
      {sets.size > 1 && <p className="bad small">These runs are on different problem sets, so their rates do not compare.</p>}
      {new Set(runs.map((r) => harnessLabel(r.harness, r.env?.app))).size > 1 && (
        <p className="bad small">These runs used different harness versions ({[...new Set(runs.map((r) => harnessLabel(r.harness, r.env?.app) || "unknown"))].join(", ")}), so differences may come from Mack, not only the models.</p>
      )}
      {runs.length === 2 && <HeadToHead a={runs[0]} b={runs[1]} name={name} />}
      <div className="bench-table">
        <table>
          <thead>
            <tr>
              <th>Models</th>
              <th>Method</th>
              <th>Solved</th>
              <th>Rate</th>
              <th>Cost</th>
              <th>Per solve</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => {
              const s = summarize(r);
              return (
                <tr key={r.id}>
                  <td className="mono">{name(r)}</td>
                  <td>{METHOD_LABELS[r.config.method ?? "single"]}</td>
                  <td>
                    {s.solved}/{s.tried}
                  </td>
                  <td>
                    <span className="bench-rate">
                      {pct(s.rate)}
                      <span className="bench-why-bar">
                        <span style={{ width: `${s.rate * 100}%`, background: "var(--accent)", opacity: 1 }} />
                      </span>
                    </span>
                  </td>
                  <td>{formatUsd(s.usd)}</td>
                  <td>{s.solved ? formatUsd(s.usd / s.solved) : "–"}</td>
                  <td>{secs(s.ms)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="small">Problem by problem</p>
      <div className="bench-table">
        <table>
          <thead>
            <tr>
              <th>Problem</th>
              {runs.map((r, i) => (
                <th key={r.id} title={name(r)}>
                  {i + 1}. {name(r).slice(0, 24)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tried.map((row) => {
              const n = row.by.filter((o) => o === "solved").length;
              return (
                <tr key={row.id} className={n === 1 ? "bench-only" : ""}>
                  <td className="mono">{row.id}</td>
                  {row.by.map((o, i) => (
                    <td key={i}>{o === "solved" ? <CheckCircle2 size={14} className="ok" /> : o === "skipped" || !o ? <CircleDashed size={14} className="muted" /> : <XCircle size={14} className="bad" />}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted small">Highlighted rows were solved by only one run: what that model or method adds over the others.</p>
    </section>
  );
}

const num = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${Math.round(n)}`);

/** A run's numbers in a popup: the headline, how the attempts went, each model's share, and where it ran. */
function MetricsDialog({ run, onClose }: { run: BenchRun; onClose: () => void }) {
  const m = runMetrics(run);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  const most = m.kinds[0]?.count ?? 1;
  const c = run.config;
  return (
    <div className="bench-modal-back" onClick={onClose}>
      <div className="bench-modal" role="dialog" aria-label="Run metrics" onClick={(e) => e.stopPropagation()}>
        <div className="row gap-sm bench-live-head">
          <h2>{run.label ?? c.model.split("/").pop()}</h2>
          <span className="muted small">
            {METHOD_LABELS[c.method ?? "single"]} · {run.set} · {new Date(run.startedAt).toLocaleString()}
          </span>
          <button className="icon-btn" title="Close" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div className="bench-stats">
          <Stat label="Solved" value={`${m.solved}/${m.tried}`} sub={`${pct(m.rate)} · 95% range ${pct(rateRange(m.solved, m.tried).low)}–${pct(rateRange(m.solved, m.tried).high)}`} />
          <Stat label="Cost" value={formatUsd(m.usd)} sub={m.perSolve !== null ? `${formatUsd(m.perSolve)} per solve` : "no solve"} />
          <Stat label="Time" value={secs(m.ms)} sub={`${secs(m.msPerProblem)} per problem`} />
          <Stat label="Attempts" value={`${m.attempts}`} sub={m.attemptsPerSolve !== null ? `${m.attemptsPerSolve.toFixed(1)} per solve` : "no solve"} />
          <Stat label="Tokens" value={num(m.promptTokens + m.completionTokens)} sub={`${num(m.promptTokens)} in · ${num(m.completionTokens)} out`} />
          <Stat label="By automation alone" value={`${m.byAutomation}`} sub={m.truncated ? `${m.truncated} replies cut at the token limit` : "no reply cut short"} />
        </div>
        {m.byModel.length > 0 && (
          <>
            <p className="small"><b>Each model</b></p>
            <div className="bench-table">
              <table>
                <thead>
                  <tr>
                    <th>Model</th>
                    <th>Attempts</th>
                    <th>Verified</th>
                    <th>Hit rate</th>
                    <th>Tokens out</th>
                    <th>Avg time</th>
                  </tr>
                </thead>
                <tbody>
                  {m.byModel.map((x) => (
                    <tr key={x.model}>
                      <td className="mono">{x.model.split("/").pop()}</td>
                      <td>{x.attempts}</td>
                      <td>{x.verified}</td>
                      <td>{pct(x.attempts ? x.verified / x.attempts : 0)}</td>
                      <td>{num(x.completionTokens)}</td>
                      <td>{secs(x.attempts ? x.ms / x.attempts : 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {m.solved > 0 && (
          <div className="bench-breakdown">
            <p className="small" title="Like the labs' pass@k, but Mack's attempts revise one another from Lean's errors, where pass@k samples independently.">Solved within k attempts</p>
            {solvedWithin(run).map((w) => (
              <div key={w.k} className="bench-why-row">
                <span>within {w.k} attempt{w.k === 1 ? "" : "s"}</span>
                <span className="bench-why-bar">
                  <span style={{ width: `${m.tried ? (w.solved / m.tried) * 100 : 0}%`, background: "var(--ok)" }} />
                </span>
                <span className="muted small">{w.solved}</span>
              </div>
            ))}
          </div>
        )}
        {m.kinds.length > 0 && (
          <div className="bench-breakdown">
            <p className="small">All attempts by how they ended</p>
            {m.kinds.map((k) => (
              <div key={k.kind} className="bench-why-row">
                <span>{k.kind === "verified" ? "Verified" : FAILURES[k.kind].label}</span>
                <span className="bench-why-bar">
                  <span style={{ width: `${(k.count / most) * 100}%`, ...(k.kind === "verified" ? { background: "var(--ok)" } : {}) }} />
                </span>
                <span className="muted small">{k.count}</span>
              </div>
            ))}
          </div>
        )}
        <Breakdown results={run.results} />
        <p className="muted small">
          Model {c.model}
          {c.prover ? `; prover ${c.prover}` : ""}. {c.maxAttempts} attempts, {c.parallel} at once, starting over after {c.revisions} revisions; automation {c.automation ? "on" : "off"}, premise selection {c.premises ? "on" : "off"}, easier versions first {c.easierFirst ? "on" : "off"}.
          {run.harness ? ` Harness: Mack ${run.harness.mack}, Open Math Harness ${run.harness.openMathHarness}; ${run.harness.procedures.join(", ")}.` : ""}
          {run.env ? ` Mack ${run.env.app} on ${run.env.platform}${run.env.lean ? `, ${run.env.lean}` : ""}; Lean deadline ${secs(run.env.leanDeadlineMs)}, ${run.env.leanProcesses} Lean processes${run.env.remoteLean ? " on a remote machine" : ""}${run.env.repl ? ", REPL on" : ""}.` : ""}
        </p>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="bench-stat">
      <span className="muted small">{label}</span>
      <b>{value}</b>
      <span className="muted small">{sub}</span>
    </div>
  );
}

/** Two runs on the problems both tried: what each solved that the other did not, and what that cost. */
function HeadToHead({ a, b, name }: { a: BenchRun; b: BenchRun; name: (r: BenchRun) => string }) {
  const h = headToHead(a, b);
  const ma = runMetrics(a);
  const mb = runMetrics(b);
  const shared = h.both.length + h.onlyA.length + h.onlyB.length + h.neither.length;
  const lead = h.onlyA.length === h.onlyB.length ? "Even on the shared problems." : `${name(h.onlyA.length > h.onlyB.length ? a : b)} wins by ${Math.abs(h.onlyA.length - h.onlyB.length)}.`;
  const row = (label: string, x: string, y: string, better?: "lower" | "higher", vx?: number | null, vy?: number | null) => {
    const win = better && vx != null && vy != null && vx !== vy ? ((better === "lower" ? vx < vy : vx > vy) ? "a" : "b") : "";
    return (
      <tr>
        <td className="muted">{label}</td>
        <td className={win === "a" ? "ok" : ""}>{x}</td>
        <td className={win === "b" ? "ok" : ""}>{y}</td>
      </tr>
    );
  };
  return (
    <div className="bench-h2h">
      <div className="bench-h2h-score">
        <div>
          <b>{h.onlyA.length}</b>
          <span className="muted small">only {name(a)}</span>
        </div>
        <div>
          <b>{h.both.length}</b>
          <span className="muted small">both</span>
        </div>
        <div>
          <b>{h.onlyB.length}</b>
          <span className="muted small">only {name(b)}</span>
        </div>
        <div>
          <b>{h.neither.length}</b>
          <span className="muted small">neither</span>
        </div>
      </div>
      <p className="small">
        {shared} problems both tried. {lead}
        {h.onlyA.length ? ` Only ${name(a)}: ${h.onlyA.join(", ")}.` : ""}
        {h.onlyB.length ? ` Only ${name(b)}: ${h.onlyB.join(", ")}.` : ""}
      </p>
      <div className="bench-table">
        <table>
          <thead>
            <tr>
              <th />
              <th>{name(a)}</th>
              <th>{name(b)}</th>
            </tr>
          </thead>
          <tbody>
            {row("Solve rate", pct(ma.rate), pct(mb.rate), "higher", ma.rate, mb.rate)}
            {row("Cost", formatUsd(ma.usd), formatUsd(mb.usd), "lower", ma.usd, mb.usd)}
            {row("Cost per solve", ma.perSolve !== null ? formatUsd(ma.perSolve) : "–", mb.perSolve !== null ? formatUsd(mb.perSolve) : "–", "lower", ma.perSolve, mb.perSolve)}
            {row("Attempts per solve", ma.attemptsPerSolve?.toFixed(1) ?? "–", mb.attemptsPerSolve?.toFixed(1) ?? "–", "lower", ma.attemptsPerSolve, mb.attemptsPerSolve)}
            {row("Time per problem", secs(ma.msPerProblem), secs(mb.msPerProblem), "lower", ma.msPerProblem, mb.msPerProblem)}
            {row("Tokens", num(ma.promptTokens + ma.completionTokens), num(mb.promptTokens + mb.completionTokens), "lower", ma.promptTokens + ma.completionTokens || null, mb.promptTokens + mb.completionTokens || null)}
            {row("By automation alone", `${ma.byAutomation}`, `${mb.byAutomation}`)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const clock = (ms: number | null) => (ms === null ? "" : `+${ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60_000)}m${String(Math.round((ms % 60_000) / 1000)).padStart(2, "0")}s`}`);

/** A problem's attempts in order: each row says when, which model, what it cost and how it ended, and opens to what Lean said, what the model thought and what it wrote. */
function AttemptTimeline({ result }: { result: BenchResult }) {
  const rows = timelineOf(result);
  const [open, setOpen] = useState<number | null>(null);
  const [steps, setSteps] = useState(false);
  return (
    <div className="bench-timeline">
      <p className="small">
        <b>{rows.length} attempt{rows.length === 1 ? "" : "s"}</b>
        {rows.some((x) => x.repeats) ? <span className="muted"> · {rows.filter((x) => x.repeats).length} repeated an earlier error</span> : null}
      </p>
      <div className="bench-table">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>When</th>
              <th>Model</th>
              <th>Took</th>
              <th>Tokens</th>
              <th>Ended</th>
              <th>Lean said</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a, i) => (
              <Fragment key={`${a.n}-${i}`}>
                <tr className={`bench-attempt ${open === i ? "open" : ""}`} onClick={() => setOpen(open === i ? null : i)}>
                  <td>{a.n}</td>
                  <td title={a.at ? new Date(a.at).toLocaleString() : ""}>{clock(a.offsetMs) || "–"}</td>
                  <td className="mono">{a.model?.split("/").pop() ?? ""}</td>
                  <td>{secs(a.ms)}</td>
                  <td>
                    {a.promptTokens ? `${Math.round(a.promptTokens / 100) / 10}k → ` : ""}
                    {Math.round(a.tokens / 100) / 10}k{a.truncated ? <span className="bad" title="The reply was cut at the token limit"> cut</span> : null}
                  </td>
                  <td className={a.kind === "verified" ? "ok" : "bad"}>{a.label}</td>
                  <td className="bench-attempt-error">
                    {a.error}
                    {a.repeats ? <span className="muted"> (same as #{a.repeats})</span> : null}
                  </td>
                </tr>
                {open === i && (
                  <tr className="bench-attempt-detail">
                    <td colSpan={7}>
                      {a.detail && (
                        <>
                          <p className="small">Lean&apos;s feedback</p>
                          <pre className="bench-proof">{a.detail}</pre>
                        </>
                      )}
                      {a.thinking && (
                        <details>
                          <summary className="small">The model&apos;s thinking ({a.thinking.length < 1000 ? a.thinking.length : `${Math.round(a.thinking.length / 100) / 10}k`} characters)</summary>
                          <pre className="bench-proof">{a.thinking}</pre>
                        </details>
                      )}
                      {a.prose && (
                        <details>
                          <summary className="small">What it wrote around the proof</summary>
                          <pre className="bench-proof">{a.prose}</pre>
                        </details>
                      )}
                      <p className="small">The attempt</p>
                      <pre className="bench-proof">{a.candidate}</pre>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {result.timeline && result.timeline.length > 0 && (
        <button className="link small" onClick={() => setSteps(!steps)}>
          {steps ? "Hide" : "Show"} everything the agent did on this problem ({result.timeline.length} steps)
        </button>
      )}
      {steps && (
        <ol className="bench-steps small">
          {result.timeline!.map((t, i) => (
            <li key={i}>
              <span className="muted">{clock(t.t)}</span> {t.message}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
