// The benchmark screen: run a fixed set of formal problems with the current
// settings and read the solve rate, so a change of model, prover model or
// attempt budget is measured instead of guessed. Earlier runs stay listed
// with the settings they used, to compare.

import { ArrowRight, CheckCircle2, CircleDashed, Copy, Database, ExternalLink, FileDown, Gauge, GitPullRequest, Loader2, Play, Square, Trash2, XCircle, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { api, errorText, type BenchResult, type BenchRun, type BenchSetInfo, type Settings } from "../api";
import { Button, EmptyState, Field, timeAgo, Toggle } from "../components/ui";
import { formatUsd } from "../../core/model/metered";
import { FAILURES, failureBreakdown, summarize } from "../../core/bench/bench";
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
  const [method, setMethod] = useState<"single" | "decompose">("single");
  const [runs, setRuns] = useState<BenchRun[]>([]);
  const [live, setLive] = useState<BenchRun | null>(null);
  const [status, setStatus] = useState<{ id: string; message: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState("");

  const refresh = () => void api.benchList().then((l) => (setRuns(l), setLive((cur) => cur ?? l.find((r) => r.status === "running") ?? null)));
  useEffect(() => {
    void api.benchSets().then(setSets);
    refresh();
    return api.onBenchEvent((e) => {
      if (e.type === "started") setLive({ ...e.run, results: [...e.run.results] });
      else if (e.type === "status") setStatus({ id: e.id, message: e.message });
      else if (e.type === "result") setLive((r) => (r ? { ...r, results: [...r.results, e.result] } : r));
      else if (e.type === "finished") {
        setLive(null);
        setStatus(null);
        refresh();
      }
    });
  }, []);

  const start = async () => {
    setError("");
    try {
      setLive(await api.benchStart(setId, size, budget, method));
    } catch (e) {
      setError(errorText(e));
    }
  };

  const total = sets.find((s) => s.id === setId)?.size ?? 244;
  const model = settings.models[settings.provider];
  const config = [
    `model ${model?.split("/").pop() ?? "not chosen"}`,
    settings.proverModel.trim() ? `prover ${settings.proverModel.split(",").map((m) => m.trim().split("/").pop()).filter(Boolean).join(", ")}` : "no prover model",
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
            <Field label="Method" hint="Decompose tries each problem directly, then splits it into lemmas proved at once: slower and dearer, and stronger on hard problems. Compare the two on the same problems.">
              <select className="input" value={method} onChange={(e) => setMethod(e.target.value as "single" | "decompose")}>
                <option value="single">Attempts (single)</option>
                <option value="decompose">Decompose into lemmas</option>
              </select>
            </Field>
            <Field label="Budget for the run (USD, 0 = no limit)" hint="When it is spent, the problems left are skipped. Your global spending limit applies as well.">
              <input className="input" type="number" min={0} step={1} value={budget} onChange={(e) => setBudget(Math.max(0, Number(e.target.value) || 0))} />
            </Field>
            <Field label="Settings used" hint={<button className="link" onClick={() => onGo("settings")}>Change them in Settings → Prover</button>}>
              <div className="bench-config muted small">{config.join(" · ")}</div>
            </Field>
          </div>
          <div className="row gap-sm">
            <Button variant="primary" icon={Play} onClick={() => void start()} disabled={!model}>
              Run {size} problems
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

      {live && <LiveRun run={live} status={status} open={open} setOpen={setOpen} />}

      <section className="wt-section">
        <h2>Earlier runs</h2>
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
                    <Gauge size={16} className={r.id === best?.id ? "accent" : "muted"} />
                    <span className="run-thm">
                      {sum.solved}/{sum.tried} solved · {pct(sum.rate)}
                      {r.id === best?.id && <span className="accent small"> best</span>}
                    </span>
                    <span className="muted small">
                      {r.config.model.split("/").pop()}
                      {r.config.prover ? ` + ${r.config.prover.split(",").map((m) => m.trim().split("/").pop()).join(", ")}` : ""} · {r.config.method === "decompose" ? "decompose · " : ""}{r.config.maxAttempts} attempts, {r.config.parallel} at once{r.config.automation ? "" : ", no automation"}
                    </span>
                    <span className="run-meta muted small">
                      {formatUsd(sum.usd)} · {secs(sum.ms)} · {timeAgo(r.startedAt)}
                      {r.status === "stopped" ? " · stopped" : ""}
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
                      <Share id={r.id} />
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

function LiveRun({ run, status, open, setOpen }: { run: BenchRun; status: { id: string; message: string } | null; open: string | null; setOpen: (id: string | null) => void }) {
  const sum = summarize(run);
  const done = run.results.length;
  return (
    <section className="settings-group">
      <div className="row gap-sm bench-live-head">
        <h2>
          Running: {done} of {run.sample.length}
        </h2>
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
          <button className="bench-result" onClick={() => toggle(shown === r.id ? null : r.id)} disabled={!r.proof && !r.message && !r.lastError}>
            {r.outcome === "solved" ? r.attempts === 0 ? <Zap size={14} className="ok" /> : <CheckCircle2 size={14} className="ok" /> : r.outcome === "skipped" ? <CircleDashed size={14} className="muted" /> : <XCircle size={14} className="bad" />}
            <span className="mono">{r.id}</span>
            <span className="muted small">
              {r.outcome === "solved" ? (r.attempts === 0 ? "closed by Lean's automation" : `solved in ${r.attempts} attempt${r.attempts === 1 ? "" : "s"}`) : r.outcome === "skipped" ? `skipped: ${r.message ?? ""}` : r.outcome === "error" ? "error" : `not solved in ${r.attempts} attempts`}
              {r.failure && <span className="bench-reason"> · {FAILURES[r.failure].label}</span>}
            </span>
            <span className="muted small">{r.outcome === "skipped" ? "" : `${secs(r.ms)} · ${formatUsd(r.usd)}`}</span>
          </button>
          {shown === r.id && (r.proof || r.message || r.lastError) && (
            <div className="bench-why">
              {r.proof ? (
                <pre className="bench-proof">{r.proof}</pre>
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

/** Save a run's report, or copy it to paste into a chat. */
function Share({ id }: { id: string }) {
  const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [pr, setPr] = useState("");
  const [logs, setLogs] = useState(true);
  const act = async (f: () => Promise<string>) => {
    try {
      setNote(await f());
    } catch (e) {
      setNote(errorText(e));
    }
  };
  return (
    <div className="bench-share">
      <span className="muted small">Share this run to review where Mack loses problems: the report has the settings, the reasons, and each unsolved problem's last attempt and Lean feedback. Save or copy it, or open a pull request with it on the Mack repo.</span>
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
      <Button size="sm" icon={GitPullRequest} onClick={() => setConfirm(true)} disabled={!!pr}>
        Share as a PR
      </Button>
      {note && <span className="muted small">{note}</span>}
      {pr && (
        <button className="link small" onClick={() => void api.openExternal(pr)}>
          Pull request opened <ExternalLink size={12} />
        </button>
      )}
      {confirm && (
        <div className="bench-confirm">
          <p className="small">
            This opens a <b>public</b> pull request on {COMMUNITY_REPO.owner}/{COMMUNITY_REPO.repo} under your GitHub account, with this run&apos;s report and data: the settings and model names, each problem&apos;s result, and the unsolved problems&apos; last attempts and Lean feedback. No keys or project files are included.
          </p>
          <Toggle
            checked={logs}
            onChange={setLogs}
            label="Include every attempt (attempts.jsonl): each attempt's model, outcome, reason and Lean feedback, and the attempt itself, so the run can be analysed fully, not from its last attempts alone"
          />
          <div className="row gap-sm">
            <Button
              size="sm"
              variant="primary"
              icon={GitPullRequest}
              onClick={() => {
                setConfirm(false);
                setNote("Opening the pull request…");
                void api.benchShare(id, logs).then(
                  (r) => (setPr(r.url), setNote("")),
                  (e) => setNote(errorText(e)),
                );
              }}
            >
              Open the pull request
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
          </div>
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
