// The public benchmark site: a static HTML leaderboard of the runs Mack users
// shared (benchmarks/runs/<folder>/run.json, merged into the Mack repo),
// rebuilt by .github/workflows/benchmarks-site.yml and served on GitHub Pages.
// One page lists every run by problem set, best first; each run has a page
// with its settings, its failures by reason and every problem's result.
// Pure functions of the runs, so the page is the same wherever it is built.

import { attemptKinds, BENCH_SETS, FAILURES, failureBreakdown, runMetrics, summarize, topErrors, type AttemptLog, type BenchRun } from "./bench";

/** A run as shared: its folder in the repo, who shared it and from which Mack. */
export type SharedRun = BenchRun & { folder: string; sharedBy?: string; appVersion?: string; attemptsLogged?: boolean };

/** Put a shared run's attempts.jsonl back on its problems, so the site can count every attempt. */
export function withAttempts(run: SharedRun, jsonl: string): SharedRun {
  const by = new Map<string, AttemptLog[]>();
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    try {
      const a = JSON.parse(line) as AttemptLog & { problem: string };
      by.set(a.problem, [...(by.get(a.problem) ?? []), a]);
    } catch {
      // A torn line is skipped.
    }
  }
  return { ...run, results: run.results.map((r) => (by.has(r.id) ? { ...r, log: by.get(r.id) } : r)) };
}

const esc = (s: unknown) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const usd = (x: number) => `$${x < 0.1 ? x.toFixed(3) : x.toFixed(2)}`;
const day = (t: number) => new Date(t).toISOString().slice(0, 10);
const short = (m: string) => m.split("/").pop() ?? m;
const tokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${n}`);
const models = (r: BenchRun) => `${short(r.config.model)}${r.config.prover ? ` + ${r.config.prover.split(",").map((m) => short(m.trim())).join(", ")}` : ""}`;
const setLabel = (id: string) => BENCH_SETS.find((s) => s.id === id)?.label ?? id;

const CSS = `
:root { --bg:#f7f7f4; --surface:#fff; --text:#1a1a12; --muted:#6b6b62; --border:#e3e3dd; --accent:#e6bd00; --accent-text:#806800; --ok:#15803d; --bad:#dc2626; --bar:#f1f1ed; }
@media (prefers-color-scheme: dark) { :root { --bg:#111110; --surface:#1a1a18; --text:#ececE6; --muted:#a2a298; --border:#2c2c28; --accent:#ffe100; --accent-text:#ffe54d; --ok:#4ade80; --bad:#f87171; --bar:#262622; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 1040px; margin: 0 auto; padding: 32px 16px 64px; }
h1 { font-size: 28px; margin: 0 0 6px; } h2 { font-size: 19px; margin: 32px 0 10px; } h3 { font-size: 15px; margin: 20px 0 8px; }
a { color: var(--accent-text); } p { margin: 6px 0; }
.muted { color: var(--muted); } .small { font-size: 13px; } .ok { color: var(--ok); } .bad { color: var(--bad); }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 16px; }
.scroll { overflow-x: auto; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); }
table { border-collapse: collapse; width: 100%; font-size: 14px; }
th, td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--border); white-space: nowrap; vertical-align: top; }
th { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); font-weight: 600; }
tr:last-child td { border-bottom: 0; }
td.wrap { white-space: normal; }
.rate { display: flex; align-items: center; gap: 8px; min-width: 150px; }
.bar { flex: 1; height: 7px; background: var(--bar); border-radius: 4px; overflow: hidden; }
.bar > span { display: block; height: 100%; background: var(--accent); }
.bar.badbar > span { background: var(--bad); opacity: .7; }
.best { font-size: 11px; font-weight: 700; color: var(--accent-text); margin-left: 6px; }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin: 16px 0; }
.stat b { display: block; font-size: 22px; }
.why { display: grid; grid-template-columns: minmax(140px, 240px) 1fr 36px; gap: 10px; align-items: center; margin: 6px 0; font-size: 14px; }
details pre { white-space: pre-wrap; font-size: 12px; background: var(--bar); padding: 8px; border-radius: 8px; max-height: 300px; overflow: auto; }
footer { margin-top: 40px; font-size: 13px; color: var(--muted); }
`;

function page(title: string, body: string, root: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head>
<body><main>
${body}
<footer>Built from the runs Mack users shared with the Benchmark screen's "Share as a PR". A problem counts as solved only when Mack's strict verifier accepts the proof in Lean. <a href="${root}index.html">All runs</a></footer>
</main></body>
</html>
`;
}

function rateCell(rate: number, best = false): string {
  return `<div class="rate"><span>${pct(rate)}</span><span class="bar"><span style="width:${(rate * 100).toFixed(1)}%"></span></span>${best ? '<span class="best">BEST</span>' : ""}</div>`;
}

/** The leaderboard: every run, by problem set, best solve rate first (then cheaper first). */
export function indexPage(runs: SharedRun[], repo: string): string {
  const sets = [...new Set(runs.map((r) => r.set))].sort((a, b) => BENCH_SETS.findIndex((s) => s.id === a) - BENCH_SETS.findIndex((s) => s.id === b));
  const sections = sets.map((set) => {
    const rows = runs
      .filter((r) => r.set === set)
      .map((r) => ({ r, s: summarize(r) }))
      .filter((x) => x.s.tried > 0)
      .sort((a, b) => b.s.rate - a.s.rate || a.s.usd - b.s.usd || b.r.startedAt - a.r.startedAt);
    const body = rows
      .map(
        ({ r, s }, i) => `<tr>
<td>${i + 1}</td>
<td><a href="runs/${esc(r.folder)}.html">${s.solved}/${s.tried}</a></td>
<td>${rateCell(s.rate, i === 0 && rows.length > 1)}</td>
<td>${esc(r.config.method ?? "single")}</td>
<td class="wrap">${esc(models(r))}</td>
<td>${r.config.maxAttempts} × ${r.config.parallel}</td>
<td>${usd(s.usd)}</td>
<td>${s.solved ? usd(s.usd / s.solved) : "–"}</td>
<td>${day(r.startedAt)}</td>
<td>${r.sharedBy ? `<a href="https://github.com/${esc(r.sharedBy)}">${esc(r.sharedBy)}</a>` : ""}</td>
</tr>`,
      )
      .join("\n");
    const byModel = new Map<string, { runs: number; best: number; solved: number; tried: number; usd: number }>();
    for (const { r, s } of rows) {
      const key = models(r);
      const m = byModel.get(key) ?? { runs: 0, best: 0, solved: 0, tried: 0, usd: 0 };
      m.runs++;
      m.best = Math.max(m.best, s.rate);
      m.solved += s.solved;
      m.tried += s.tried;
      m.usd += s.usd;
      byModel.set(key, m);
    }
    const modelRows = [...byModel.entries()].sort((a, b) => b[1].best - a[1].best || b[1].solved / (b[1].tried || 1) - a[1].solved / (a[1].tried || 1));
    const modelTable = modelRows.length > 1
      ? `<h3>By model</h3>
<div class="scroll"><table>
<thead><tr><th>Models</th><th>Runs</th><th>Best rate</th><th>Over all runs</th><th>Per solve</th></tr></thead>
<tbody>
${modelRows.map(([k, m]) => `<tr><td class="wrap">${esc(k)}</td><td>${m.runs}</td><td>${rateCell(m.best)}</td><td>${m.solved}/${m.tried}</td><td>${m.solved ? usd(m.usd / m.solved) : "–"}</td></tr>`).join("\n")}
</tbody></table></div>`
      : "";
    return `<h2>${esc(setLabel(set))} <span class="muted small">${rows.length} run${rows.length === 1 ? "" : "s"}</span></h2>
<div class="scroll"><table>
<thead><tr><th>#</th><th>Solved</th><th>Rate</th><th>Method</th><th>Models</th><th>Attempts</th><th>Cost</th><th>Per solve</th><th>Date</th><th>By</th></tr></thead>
<tbody>
${body}
</tbody></table></div>
${modelTable}`;
  });
  return page(
    "Mack benchmark",
    `<h1>Mack benchmark</h1>
<p class="muted">How many competition problems Mack proves in Lean, run by its users on their own models and settings: miniF2F (244 competition problems) and PutnamBench (Putnam problems since 1962). Runs on the same set and size use the same problems, so they compare. Each run's page shows why its unsolved problems failed.</p>
<p class="small"><a href="${esc(repo)}">Mack on GitHub</a> · <a href="${esc(repo)}/tree/main/benchmarks/runs">the runs' data</a></p>
${sections.join("\n") || '<p class="card">No runs shared yet. Run one from Mack\'s Benchmark screen and press "Share as a PR".</p>'}`,
    "",
  );
}

/** One run: its settings, its numbers, its failures by reason, and every problem's result. */
export function runPage(r: SharedRun, repo: string): string {
  const s = summarize(r);
  const m = runMetrics(r);
  const c = r.config;
  const breakdown = failureBreakdown(r.results);
  const most = breakdown[0]?.count ?? 1;
  const rows = r.results
    .map((x) => {
      const why = x.failure ? FAILURES[x.failure].label : "";
      const outcome = x.outcome === "solved" ? `<span class="ok">${x.attempts === 0 ? "solved by automation" : "solved"}</span>` : x.outcome === "skipped" ? '<span class="muted">skipped</span>' : '<span class="bad">not solved</span>';
      const detail =
        x.lastError || x.lastCandidate
          ? `<details><summary>${esc(why || "details")}</summary>${x.lastError ? `<p class="small">Lean's last feedback</p><pre>${esc(x.lastError)}</pre>` : ""}${x.lastCandidate ? `<p class="small">Last attempt</p><pre>${esc(x.lastCandidate)}</pre>` : ""}</details>`
          : esc(why);
      return `<tr><td>${esc(x.id)}</td><td>${outcome}</td><td>${x.attempts}</td><td>${Math.round(x.ms / 1000)}s</td><td>${usd(x.usd)}</td><td class="wrap">${detail}</td></tr>`;
    })
    .join("\n");
  return page(
    `${setLabel(r.set)} ${s.solved}/${s.tried}: Mack benchmark`,
    `<p class="small"><a href="../index.html">← All runs</a></p>
<h1>${esc(setLabel(r.set))}: ${s.solved}/${s.tried} solved</h1>
<p class="muted">${esc(c.method ?? "single")} · ${esc(models(r))} · ${day(r.startedAt)}${r.sharedBy ? ` · shared by ${esc(r.sharedBy)}` : ""}${r.appVersion ? ` · Mack ${esc(r.appVersion)}` : ""}</p>
<div class="stats">
<div class="card stat"><span class="muted small">Solve rate</span><b>${pct(s.rate)}</b></div>
<div class="card stat"><span class="muted small">Cost</span><b>${usd(s.usd)}</b></div>
<div class="card stat"><span class="muted small">Time</span><b>${Math.round(s.ms / 60000)} min</b></div>
<div class="card stat"><span class="muted small">By automation alone</span><b>${s.byAutomation}</b></div>
${
  m.attempts
    ? `<div class="card stat"><span class="muted small">Attempts per solve</span><b>${m.attemptsPerSolve !== null ? m.attemptsPerSolve.toFixed(1) : "–"}</b></div>
<div class="card stat"><span class="muted small">Tokens in / out</span><b>${tokens(m.promptTokens)} / ${tokens(m.completionTokens)}</b></div>`
    : ""
}
</div>
${
  m.byModel.length > 1 || (m.byModel.length === 1 && m.byModel[0].model !== "unknown")
    ? `<h2>Each model</h2>
<div class="scroll"><table>
<thead><tr><th>Model</th><th>Attempts</th><th>Verified</th><th>Hit rate</th><th>Tokens out</th><th>Replies cut short</th></tr></thead>
<tbody>
${m.byModel.map((x) => `<tr><td>${esc(short(x.model))}</td><td>${x.attempts}</td><td>${x.verified}</td><td>${pct(x.attempts ? x.verified / x.attempts : 0)}</td><td>${tokens(x.completionTokens)}</td><td>${x.truncated}</td></tr>`).join("\n")}
</tbody></table></div>`
    : ""
}
<div class="card small">
Model <b>${esc(c.model)}</b>${c.prover ? `; prover <b>${esc(c.prover)}</b>` : "; no prover model"}. ${c.maxAttempts} attempts, ${c.parallel} at once, starting over after ${c.revisions} revisions. Automation ${c.automation ? "on" : "off"}; premise selection ${c.premises ? "on" : "off"}; easier versions first ${c.easierFirst ? "on" : "off"}.
</div>
<h2>Why problems were not solved</h2>
${
  breakdown.length
    ? `<div class="card">${breakdown
        .map((b) => `<div class="why" title="${esc(b.ids.join(", "))}"><span>${esc(FAILURES[b.kind].label)}</span><span class="bar badbar"><span style="width:${((b.count / most) * 100).toFixed(1)}%"></span></span><span class="muted">${b.count}</span></div>`)
        .join("\n")}</div>`
    : '<p class="muted">Every problem tried was solved.</p>'
}
${attemptsSection(r)}
<h2>Results</h2>
<div class="scroll"><table>
<thead><tr><th>Problem</th><th>Outcome</th><th>Attempts</th><th>Time</th><th>Cost</th><th>Why</th></tr></thead>
<tbody>
${rows}
</tbody></table></div>
<p class="small"><a href="${esc(repo)}/blob/main/benchmarks/runs/${esc(r.folder)}/REPORT.md">Full report</a> · <a href="${esc(repo)}/blob/main/benchmarks/runs/${esc(r.folder)}/run.json">run.json</a>${r.attemptsLogged ? ` · <a href="${esc(repo)}/blob/main/benchmarks/runs/${esc(r.folder)}/attempts.jsonl">attempts.jsonl</a> (every attempt)` : ""}</p>`,
    "../",
  );
}

/** Every attempt of a run by how it ended, and the Lean errors that cost the most attempts; empty without a log. */
function attemptsSection(r: SharedRun): string {
  const kinds = attemptKinds(r);
  if (!kinds.length) return "";
  const total = kinds.reduce((a, k) => a + k.count, 0);
  const most = kinds[0].count;
  const errs = topErrors(r, 12);
  return `<h2>All ${total} attempts by how they ended</h2>
<div class="card">${kinds
    .map(
      (k) =>
        `<div class="why"><span>${esc(k.kind === "verified" ? "Verified" : FAILURES[k.kind].label)}</span><span class="bar${k.kind === "verified" ? "" : " badbar"}"><span style="width:${((k.count / most) * 100).toFixed(1)}%"></span></span><span class="muted">${k.count}</span></div>`,
    )
    .join("\n")}</div>
${
  errs.length
    ? `<h3>Commonest Lean errors</h3>
<div class="scroll"><table>
<thead><tr><th>Error</th><th>Attempts</th><th>Problems</th></tr></thead>
<tbody>
${errs.map((e) => `<tr><td class="wrap">${esc(e.error)}</td><td>${e.count}</td><td>${e.problems}</td></tr>`).join("\n")}
</tbody></table></div>`
    : ""
}`;
}

/** Every page of the site, by path. */
export function buildSite(runs: SharedRun[], repo: string): Record<string, string> {
  const files: Record<string, string> = { "index.html": indexPage(runs, repo) };
  for (const r of runs) files[`runs/${r.folder}.html`] = runPage(r, repo);
  return files;
}
