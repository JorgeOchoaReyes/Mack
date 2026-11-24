// The public benchmark site: a static HTML leaderboard of the runs Mack users
// shared (benchmarks/runs/<folder>/run.json, merged into the Mack repo),
// rebuilt by .github/workflows/benchmarks-site.yml and served on GitHub Pages.
// One page lists every run by problem set, best first; each run has a page
// with its settings, its failures by reason and every problem's result.
// Pure functions of the runs, so the page is the same wherever it is built.

import { attemptKinds, BENCH_BASICS, BENCH_SETS, harnessLabel, METHOD_LABELS, FAILURES, failureBreakdown, runMetrics, summarize, timelineOf, topErrors, type AttemptLog, type BenchResult, type BenchRun } from "./bench";

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

/** Mack's mark: the app icon, inline so the site needs no other file. */
const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"> <defs> <linearGradient id="bolt" x1="0" y1="0" x2="0" y2="1"> <stop offset="0" stop-color="#FFF04D"/> <stop offset="1" stop-color="#FFD000"/> </linearGradient> <filter id="glow" x="-40%" y="-40%" width="180%" height="180%"> <feGaussianBlur stdDeviation="14" result="b"/> <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge> </filter> </defs> <rect width="512" height="512" rx="116" fill="#121000"/> <rect x="10" y="10" width="492" height="492" rx="106" fill="none" stroke="#FFE100" stroke-opacity="0.35" stroke-width="6"/> <path filter="url(#glow)" fill="url(#bolt)" d="M298 58 L126 292 H236 L206 454 L388 204 H272 Z"/> </svg>`;

const CSS = `
:root { --bg:#f6f6f2; --surface:#ffffff; --surface-2:#fafaf6; --text:#17170f; --muted:#66665d; --border:#e4e4dd; --accent:#ffd000; --accent-2:#fff04d; --accent-text:#7a6200; --accent-soft:#fff7cc; --ok:#15803d; --ok-soft:#e7f5ec; --bad:#dc2626; --bad-soft:#fdecec; --bar:#efefe9; --shadow:0 1px 2px rgba(20,20,10,.05),0 8px 24px rgba(20,20,10,.06); }
@media (prefers-color-scheme: dark) { :root { --bg:#0e0e0c; --surface:#181815; --surface-2:#1e1e1a; --text:#efefe8; --muted:#a3a398; --border:#2b2b26; --accent:#ffe100; --accent-2:#fff04d; --accent-text:#ffe54d; --accent-soft:#2a2500; --ok:#4ade80; --ok-soft:#10261a; --bad:#f87171; --bad-soft:#2a1414; --bar:#262621; --shadow:0 1px 2px rgba(0,0,0,.3),0 8px 24px rgba(0,0,0,.3); } }
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; -webkit-font-smoothing: antialiased; }
a { color: var(--accent-text); text-decoration-thickness: 1px; text-underline-offset: 3px; }
p { margin: 6px 0; }
.wrap-page { max-width: 1080px; margin: 0 auto; padding: 0 16px; }
header.top { position: sticky; top: 0; z-index: 10; backdrop-filter: saturate(1.4) blur(10px); -webkit-backdrop-filter: saturate(1.4) blur(10px); background: color-mix(in srgb, var(--bg) 82%, transparent); border-bottom: 1px solid var(--border); }
header.top .wrap-page { display: flex; align-items: center; gap: 18px; height: 58px; }
.brand { display: flex; align-items: center; gap: 9px; font-weight: 750; font-size: 17px; color: var(--text); text-decoration: none; }
.brand svg { width: 30px; height: 30px; }
nav.links { display: flex; gap: 16px; margin-left: auto; align-items: center; font-size: 14px; }
nav.links a { color: var(--muted); text-decoration: none; }
nav.links a:hover { color: var(--text); }
.btn { display: inline-flex; align-items: center; gap: 8px; padding: 9px 16px; border-radius: 10px; font-weight: 650; font-size: 14px; text-decoration: none; border: 1px solid var(--border); background: var(--surface); color: var(--text); transition: transform .15s ease, box-shadow .15s ease; }
.btn:hover { transform: translateY(-1px); box-shadow: var(--shadow); }
.btn.primary { background: linear-gradient(180deg, var(--accent-2), var(--accent)); border-color: transparent; color: #17150a; }
nav.links .btn { color: #17150a; }
.hero { padding: 56px 0 28px; }
.hero h1 { font-size: clamp(30px, 5vw, 48px); line-height: 1.1; margin: 0 0 14px; letter-spacing: -.02em; }
.hero h1 em { font-style: normal; background: linear-gradient(transparent 62%, var(--accent-soft) 62%); }
.hero .lead { font-size: 17px; color: var(--muted); max-width: 720px; }
.cta { display: flex; flex-wrap: wrap; gap: 10px; margin: 22px 0 8px; }
.counters { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin: 30px 0 8px; }
.counter { padding: 16px; border-radius: 14px; background: var(--surface); border: 1px solid var(--border); box-shadow: var(--shadow); }
.counter b { display: block; font-size: 28px; font-variant-numeric: tabular-nums; letter-spacing: -.01em; }
.counter span { color: var(--muted); font-size: 13px; }
section { padding: 26px 0; }
h2 { font-size: 22px; margin: 0 0 6px; letter-spacing: -.01em; }
h2 .muted { font-weight: 500; font-size: 14px; }
h3 { font-size: 15px; margin: 22px 0 8px; }
.sub { color: var(--muted); margin: 0 0 14px; }
.muted { color: var(--muted); } .small { font-size: 13px; } .ok { color: var(--ok); } .bad { color: var(--bad); }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 16px 18px; box-shadow: var(--shadow); }
.steps { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
.step { position: relative; padding: 18px; border-radius: 14px; background: var(--surface); border: 1px solid var(--border); box-shadow: var(--shadow); }
.step .n { display: inline-grid; place-items: center; width: 28px; height: 28px; border-radius: 8px; background: var(--accent-soft); color: var(--accent-text); font-weight: 750; font-size: 14px; margin-bottom: 8px; }
.step b { display: block; margin-bottom: 4px; }
.step p { color: var(--muted); font-size: 14px; margin: 0; }
.scroll { overflow-x: auto; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); box-shadow: var(--shadow); }
table { border-collapse: collapse; width: 100%; font-size: 14px; }
th, td { text-align: left; padding: 10px 14px; border-bottom: 1px solid var(--border); white-space: nowrap; vertical-align: top; }
th { font-size: 11.5px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); font-weight: 650; background: var(--surface-2); }
tbody tr { transition: background .15s ease; }
tbody tr:hover { background: var(--surface-2); }
tr:last-child td { border-bottom: 0; }
td.wrap { white-space: normal; min-width: 180px; }
.rank { font-weight: 750; color: var(--muted); }
tr.first .rank { color: var(--accent-text); }
.rate { display: flex; align-items: center; gap: 10px; min-width: 170px; font-variant-numeric: tabular-nums; }
.bar { flex: 1; height: 8px; background: var(--bar); border-radius: 99px; overflow: hidden; min-width: 60px; }
.bar > span { display: block; height: 100%; width: var(--w); border-radius: 99px; background: linear-gradient(90deg, var(--accent), var(--accent-2)); animation: grow 1s cubic-bezier(.2,.8,.2,1) both; animation-delay: calc(var(--i, 0) * 70ms + 150ms); }
.bar.badbar > span { background: var(--bad); opacity: .75; }
.bar.okbar > span { background: var(--ok); }
@keyframes grow { from { width: 0; } to { width: var(--w); } }
.pill { display: inline-block; padding: 2px 9px; border-radius: 99px; font-size: 11.5px; font-weight: 650; background: var(--bar); color: var(--muted); }
.pill.best { background: var(--accent-soft); color: var(--accent-text); }
.pill.omh { background: var(--ok-soft); color: var(--ok); }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin: 16px 0; }
.stat b { display: block; font-size: 24px; font-variant-numeric: tabular-nums; }
.why { display: grid; grid-template-columns: minmax(140px, 240px) 1fr 36px; gap: 12px; align-items: center; margin: 8px 0; font-size: 14px; }
pre.card { white-space: pre-wrap; font-size: 12.5px; overflow: auto; font-family: ui-monospace, "Cascadia Code", Menlo, monospace; }
details summary { cursor: pointer; color: var(--accent-text); font-size: 13px; }
details pre { white-space: pre-wrap; font-size: 12px; background: var(--bar); padding: 10px; border-radius: 10px; max-height: 320px; overflow: auto; font-family: ui-monospace, "Cascadia Code", Menlo, monospace; }
.basics { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 10px 22px; }
.basics p { margin: 0; color: var(--muted); font-size: 14px; }
.basics b { color: var(--text); }
.crumbs { margin: 22px 0 0; font-size: 13px; }
.empty { text-align: center; padding: 34px 18px; }
.empty b { display: block; font-size: 17px; margin-bottom: 6px; }
footer.bottom { margin-top: 30px; border-top: 1px solid var(--border); padding: 26px 0 44px; font-size: 13px; color: var(--muted); }
footer.bottom .wrap-page { display: flex; flex-wrap: wrap; gap: 10px 22px; justify-content: space-between; }
/* Sections rise into place as they scroll into view (only when JavaScript runs; without it everything is simply shown). */
.js .reveal { opacity: 0; transform: translateY(14px); transition: opacity .6s ease, transform .6s cubic-bezier(.2,.8,.2,1); }
.js .reveal.in { opacity: 1; transform: none; }
@media (prefers-reduced-motion: reduce) { .bar > span { animation: none; } .js .reveal { opacity: 1; transform: none; transition: none; } .btn { transition: none; } html { scroll-behavior: auto; } }
@media (max-width: 640px) { nav.links a:not(.btn) { display: none; } .hero { padding-top: 34px; } }
`;

/** Counters count up and sections rise in as they come into view; nothing depends on it. */
const SCRIPT = `
document.documentElement.classList.add("js");
const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
const io = "IntersectionObserver" in window ? new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { threshold: 0.08 }) : null;
document.querySelectorAll(".reveal").forEach((el) => (io && !still ? io.observe(el) : el.classList.add("in")));
document.querySelectorAll("[data-count]").forEach((el) => {
  const to = Number(el.dataset.count), dec = Number(el.dataset.dec || 0), suf = el.dataset.suffix || "";
  if (still || !isFinite(to)) return;
  const t0 = performance.now();
  const step = (t) => { const k = Math.min(1, (t - t0) / 1100), v = to * (1 - Math.pow(1 - k, 3)); el.textContent = v.toFixed(dec) + suf; if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
});
`;

const RELEASES = "https://github.com/JorgeOchoaReyes/Mack/releases/latest";

function page(title: string, body: string, root: string, repo = "https://github.com/JorgeOchoaReyes/Mack"): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="How many competition problems Mack proves in Lean: runs shared by its users, every attempt and Lean's verdict.">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(LOGO)}">
<style>${CSS}</style>
</head>
<body>
<header class="top"><div class="wrap-page">
<a class="brand" href="${root}index.html">${LOGO}<span>Mack benchmark</span></a>
<nav class="links">
<a href="${root}index.html#leaderboard">Leaderboard</a>
<a href="${root}index.html#how">How it works</a>
<a href="${root}index.html#read">Reading results</a>
<a href="${esc(repo)}">GitHub</a>
<a class="btn primary" href="${RELEASES}">Download Mack</a>
</nav>
</div></header>
<main class="wrap-page">
${body}
</main>
<footer class="bottom"><div class="wrap-page">
<span>Built from the runs Mack users shared with the Benchmark screen's "Share as a PR". A problem counts as solved only when Mack's strict verifier accepts the proof in Lean.</span>
<span><a href="${RELEASES}">Download Mack</a> · <a href="${esc(repo)}">GitHub</a> · <a href="${esc(repo)}#contributing">Contribute</a> · problems from miniF2F (MIT) and PutnamBench (Apache-2.0)</span>
</div></footer>
<script>${SCRIPT}</script>
</body>
</html>
`;
}

/** An animated bar: `fraction` of the way, `i` its place in a list for a staggered start. */
const bar = (fraction: number, i = 0, cls = "") => `<span class="bar${cls ? ` ${cls}` : ""}"><span style="--w:${(Math.max(0, Math.min(1, fraction)) * 100).toFixed(1)}%;--i:${i}"></span></span>`;

function rateCell(rate: number, best = false, i = 0): string {
  return `<div class="rate"><span>${pct(rate)}</span>${bar(rate, i)}${best ? '<span class="pill best">BEST</span>' : ""}</div>`;
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
        ({ r, s }, i) => `<tr class="${i === 0 ? "first" : ""}">
<td class="rank">${i + 1}</td>
<td><a href="runs/${esc(r.folder)}.html"><b>${s.solved}/${s.tried}</b></a></td>
<td>${rateCell(s.rate, i === 0 && rows.length > 1, i)}</td>
<td class="wrap">${esc(models(r))}</td>
<td>${esc(METHOD_LABELS[r.config.method ?? "single"])}${r.config.method === "search" || r.config.method === "ultramath" ? ' <span class="pill omh">OMH</span>' : ""}</td>
<td>${r.config.maxAttempts} × ${r.config.parallel}</td>
<td>${usd(s.usd)}</td>
<td>${s.solved ? usd(s.usd / s.solved) : "–"}</td>
<td>${day(r.startedAt)}</td>
<td title="${esc(r.harness?.procedures.join(", ") ?? "")}">${esc(harnessLabel(r.harness, r.appVersion ?? r.env?.app).replace(/^Mack /, ""))}</td>
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
    const modelTable =
      modelRows.length > 1
        ? `<h3>By model</h3>
<div class="scroll"><table>
<thead><tr><th>Models</th><th>Runs</th><th>Best rate</th><th>Over all runs</th><th>Per solve</th></tr></thead>
<tbody>
${modelRows.map(([k, m], i) => `<tr><td class="wrap">${esc(k)}</td><td>${m.runs}</td><td>${rateCell(m.best, false, i)}</td><td>${m.solved}/${m.tried}</td><td>${m.solved ? usd(m.usd / m.solved) : "–"}</td></tr>`).join("\n")}
</tbody></table></div>`
        : "";
    return `<div class="reveal">
<h3 style="font-size:18px">${esc(setLabel(set))} <span class="muted small">${rows.length} run${rows.length === 1 ? "" : "s"}</span></h3>
<div class="scroll"><table>
<thead><tr><th>#</th><th>Solved</th><th>Rate</th><th>Models</th><th>Method</th><th>Attempts</th><th>Cost</th><th>Per solve</th><th>Date</th><th>Harness</th><th>By</th></tr></thead>
<tbody>
${body}
</tbody></table></div>
${modelTable}
</div>`;
  });
  const all = runs.map((r) => summarize(r));
  const best = all.length ? Math.max(...all.map((x) => x.rate)) : 0;
  const solved = all.reduce((a, x) => a + x.solved, 0);
  const modelsCount = new Set(runs.map((r) => models(r))).size;
  const counter = (value: number, label: string, opts: { dec?: number; suffix?: string } = {}) =>
    `<div class="counter"><b data-count="${value}" data-dec="${opts.dec ?? 0}" data-suffix="${opts.suffix ?? ""}">${value.toFixed(opts.dec ?? 0)}${opts.suffix ?? ""}</b><span>${label}</span></div>`;
  return page(
    "Mack benchmark",
    `<section class="hero">
<h1>How well do models prove math <em>in Lean</em>?</h1>
<p class="lead">Mack runs open models on competition problems formalized in Lean 4, and counts a problem as solved only when Lean's kernel accepts the proof. These are the runs its users shared: every attempt, every Lean error, every model's thinking, so the numbers can be checked, not just trusted.</p>
<div class="cta">
<a class="btn primary" href="${RELEASES}">Download Mack for Windows</a>
<a class="btn" href="#how">How it works</a>
<a class="btn" href="${esc(repo)}">Source on GitHub</a>
</div>
<div class="counters">
${counter(runs.length, "runs shared")}
${counter(modelsCount, "model setups")}
${counter(solved, "problems proved, Lean-checked")}
${counter(best * 100, "best solve rate", { dec: 1, suffix: "%" })}
</div>
</section>
<section id="leaderboard" class="reveal">
<h2>Leaderboard</h2>
<p class="sub">Best solve rate first. Runs of the same size on the same set use the same problems, so they compare; open a run for its failures, every attempt, and each problem's trace.</p>
${sections.join("\n") || `<div class="card empty"><b>No runs shared yet</b>Be the first: download Mack, run the benchmark, and press <b>Share as a PR</b>. Once merged, your run appears here.<div class="cta" style="justify-content:center"><a class="btn primary" href="${RELEASES}">Download Mack</a></div></div>`}
</section>
<section id="how" class="reveal">
<h2>How it works</h2>
<p class="sub">From a statement to a verified proof, and from your computer to this page.</p>
<div class="steps">
<div class="step"><span class="n">1</span><b>Pick problems</b><p>miniF2F (244 competition problems) or PutnamBench (Putnam since 1962), already stated in Lean 4. The same size always picks the same problems.</p></div>
<div class="step"><span class="n">2</span><b>Models attempt proofs</b><p>Your models write Lean proofs; Lean's errors go back to them. Mack's methods (Attempts, Decompose) or Open Math Harness's own (Search tree, Ultramath).</p></div>
<div class="step"><span class="n">3</span><b>Lean decides</b><p>The strict verifier checks the statement is unchanged, no sorry or extra axiom is used, and Lean's kernel accepts the proof. Nothing else counts.</p></div>
<div class="step"><span class="n">4</span><b>Share and compare</b><p>Press Share as a PR in Mack: the run, every attempt and its trace go to the Mack repo, are checked in CI, and appear here once merged.</p></div>
</div>
</section>
<section id="read" class="reveal">
<h2>Reading the results</h2>
<div class="card basics">${BENCH_BASICS.map((b) => `<p><b>${esc(b.term)}.</b> ${esc(b.text)}</p>`).join("\n")}</div>
<p class="small muted" style="margin-top:10px">How to read these results: each term above is the same one the app and every report use.</p>
</section>`,
    "",
    repo,
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
      return `<tr><td>${x.log?.length ? `<a href="${esc(r.folder)}/${esc(x.id)}.html">${esc(x.id)}</a>` : esc(x.id)}</td><td>${outcome}</td><td>${x.attempts}</td><td>${Math.round(x.ms / 1000)}s</td><td>${usd(x.usd)}</td><td class="wrap">${detail}</td></tr>`;
    })
    .join("\n");
  return page(
    `${setLabel(r.set)} ${s.solved}/${s.tried}: Mack benchmark`,
    `<p class="crumbs"><a href="../index.html#leaderboard">← Leaderboard</a></p>
<section class="hero" style="padding:18px 0 6px">
<h1 style="font-size:32px">${esc(setLabel(r.set))}: ${s.solved}/${s.tried} solved</h1>
<p class="muted">${esc(METHOD_LABELS[c.method ?? "single"])} · ${esc(models(r))} · ${day(r.startedAt)}${r.sharedBy ? ` · shared by ${esc(r.sharedBy)}` : ""}${r.appVersion ? ` · Mack ${esc(r.appVersion)}` : ""}</p>
</section>
<div class="stats">
<div class="card stat"><span class="muted small">Solve rate</span><b data-count="${(s.rate * 100).toFixed(1)}" data-dec="1" data-suffix="%">${pct(s.rate)}</b></div>
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
${r.harness ? `Harness <b>Mack ${esc(r.harness.mack)}</b>, Open Math Harness <b>${esc(r.harness.openMathHarness)}</b>; ${esc(r.harness.procedures.join(", "))}.<br>` : ""}Model <b>${esc(c.model)}</b>${c.prover ? `; prover <b>${esc(c.prover)}</b>` : "; no prover model"}. ${c.maxAttempts} attempts, ${c.parallel} at once, starting over after ${c.revisions} revisions. Automation ${c.automation ? "on" : "off"}; premise selection ${c.premises ? "on" : "off"}; easier versions first ${c.easierFirst ? "on" : "off"}.
</div>
<section class="reveal"><h2>Why problems were not solved</h2>
${
  breakdown.length
    ? `<div class="card">${breakdown
        .map((b) => `<div class="why" title="${esc(b.ids.join(", "))}"><span>${esc(FAILURES[b.kind].label)}</span>${bar(b.count / most, 0, "badbar")}<span class="muted">${b.count}</span></div>`)
        .join("\n")}</div>`
    : '<p class="muted">Every problem tried was solved.</p>'
}</section>
<section class="reveal">${attemptsSection(r)}</section>
<section class="reveal"><h2>Results</h2>
<div class="scroll"><table>
<thead><tr><th>Problem</th><th>Outcome</th><th>Attempts</th><th>Time</th><th>Cost</th><th>Why</th></tr></thead>
<tbody>
${rows}
</tbody></table></div>
</section>
<p class="small"><a href="${esc(repo)}/blob/main/benchmarks/runs/${esc(r.folder)}/REPORT.md">Full report</a> · <a href="${esc(repo)}/blob/main/benchmarks/runs/${esc(r.folder)}/run.json">run.json</a>${r.attemptsLogged ? ` · <a href="${esc(repo)}/blob/main/benchmarks/runs/${esc(r.folder)}/attempts.jsonl">attempts.jsonl</a> (every attempt)` : ""}</p>`,
    "../",
    repo,
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
        `<div class="why"><span>${esc(k.kind === "verified" ? "Verified" : FAILURES[k.kind].label)}</span>${bar(k.count / most, 0, k.kind === "verified" ? "okbar" : "badbar")}<span class="muted">${k.count}</span></div>`,
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

const clock = (ms: number | null) => (ms === null ? "" : `+${ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60_000)}m${String(Math.round((ms % 60_000) / 1000)).padStart(2, "0")}s`}`);

/** One problem of a run: its statement, then every attempt in order, each opening to Lean's feedback, the model's thinking and the attempt. */
export function problemPage(r: SharedRun, x: BenchResult, source: string | undefined, repo: string): string {
  const rows = timelineOf(x);
  const body = rows
    .map(
      (a) => `<tr>
<td>${a.n}</td>
<td title="${esc(a.at ?? "")}">${esc(a.at ? a.at.slice(11, 19) : "")} <span class="muted">${clock(a.offsetMs)}</span></td>
<td>${esc(short(a.model ?? ""))}</td>
<td>${Math.round(a.ms / 1000)}s</td>
<td>${a.promptTokens ? `${tokens(a.promptTokens)} → ` : ""}${tokens(a.tokens)}${a.truncated ? ' <span class="bad">cut</span>' : ""}</td>
<td class="${a.kind === "verified" ? "ok" : "bad"}">${esc(a.label)}</td>
<td class="wrap">${esc(a.error)}${a.repeats ? ` <span class="muted">(same as #${a.repeats})</span>` : ""}
<details><summary>details</summary>
${a.detail ? `<p class="small">Lean's feedback</p><pre>${esc(a.detail)}</pre>` : ""}
${a.thinking ? `<p class="small">The model's thinking</p><pre>${esc(a.thinking)}</pre>` : ""}
${a.prose ? `<p class="small">What it wrote around the proof</p><pre>${esc(a.prose)}</pre>` : ""}
<p class="small">The attempt</p><pre>${esc(a.candidate)}</pre>
</details></td>
</tr>`,
    )
    .join("\n");
  const repeated = rows.filter((a) => a.repeats).length;
  return page(
    `${x.id}: Mack benchmark`,
    `<p class="crumbs"><a href="../../index.html#leaderboard">Leaderboard</a> / <a href="../${esc(r.folder)}.html">${esc(setLabel(r.set))}: ${esc(models(r))}, ${day(r.startedAt)}</a></p>
<h1 style="font-size:30px;margin:14px 0 6px">${esc(x.id)}</h1>
<p class="muted">${x.outcome === "solved" ? '<span class="ok">solved</span>' : '<span class="bad">not solved</span>'} in ${x.attempts} attempt${x.attempts === 1 ? "" : "s"}, ${Math.round(x.ms / 1000)}s, ${usd(x.usd)}${x.failure ? ` · ${esc(FAILURES[x.failure].label)}` : ""}${repeated ? ` · ${repeated} attempt${repeated === 1 ? "" : "s"} repeated an earlier error` : ""}</p>
${source ? `<details><summary>The statement</summary><pre>${esc(source.trim())}</pre></details>` : ""}
<h2>Attempts</h2>
<div class="scroll"><table>
<thead><tr><th>#</th><th>When</th><th>Model</th><th>Took</th><th>Tokens</th><th>Ended</th><th>Lean said</th></tr></thead>
<tbody>
${body}
</tbody></table></div>
${
  x.timeline?.length
    ? `<h2>What the run did</h2><div class="card small"><ol>${x.timeline.map((t) => `<li style="white-space:pre-wrap"><span class="muted">${clock(t.t)}</span> ${esc(t.message)}</li>`).join("")}</ol></div>`
    : ""
}
${x.proof ? `<h2>The verified proof</h2><pre class="card">${esc(x.proof)}</pre>` : ""}
<p class="small"><a href="${esc(repo)}/blob/main/benchmarks/runs/${esc(r.folder)}/attempts.jsonl">attempts.jsonl</a></p>`,
    "../../",
    repo,
  );
}

/** Every page of the site, by path. */
export function buildSite(runs: SharedRun[], repo: string): Record<string, string> {
  const files: Record<string, string> = { "index.html": indexPage(runs, repo) };
  for (const r of runs) {
    files[`runs/${r.folder}.html`] = runPage(r, repo);
    const set = BENCH_SETS.find((s) => s.id === r.set);
    for (const x of r.results) if (x.log?.length) files[`runs/${r.folder}/${x.id}.html`] = problemPage(r, x, set?.problems.find((p) => p.id === x.id)?.source, repo);
  }
  return files;
}
