// The public benchmark site: a static HTML leaderboard of the runs Mack users
// shared (benchmarks/runs/<folder>/run.json, merged into the Mack repo),
// rebuilt by .github/workflows/benchmarks-site.yml and served on GitHub Pages.
// One page lists every run by problem set, best first; each run has a page
// with its settings, its failures by reason and every problem's result.
// Pure functions of the runs, so the page is the same wherever it is built.

import { attemptKinds, BENCH_BASICS, BENCH_SETS, harnessLabel, METHOD_LABELS, FAILURES, failureBreakdown, publishedScore, RECENT_SET, RECENT_YEARS, runMetrics, solvedWithin, summarize, timelineOf, topErrors, type AttemptLog, type BenchResult, type BenchRun } from "./bench";

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
.hero { padding: 40px 0 18px; }
.hero.compact h1 { font-size: clamp(26px, 4vw, 38px); }
.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; margin: 18px 0 6px; }
.kpi { padding: 12px 14px; border-radius: 12px; background: var(--surface); border: 1px solid var(--border); }
.kpi b { display: block; font-size: 22px; font-variant-numeric: tabular-nums; letter-spacing: -.01em; line-height: 1.2; }
.kpi > span { color: var(--muted); font-size: 12px; }
.kpi > i { font-style: normal; color: var(--muted); font-size: 12px; display: block; }
.tabs { margin-top: 10px; }
.tabs > input { position: absolute; opacity: 0; pointer-events: none; }
.tabs > label { display: inline-block; padding: 7px 14px; margin: 0 6px 10px 0; border-radius: 99px; border: 1px solid var(--border); background: var(--surface); font-size: 13.5px; font-weight: 600; cursor: pointer; color: var(--muted); }
.tabs > label .n { font-weight: 500; opacity: .8; margin-left: 4px; }
.tabs > .panel { display: none; }
.note { color: var(--muted); font-size: 12.5px; margin: 8px 2px 0; }
.dim td { color: var(--muted); }
.dim td a b { font-weight: 600; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; }
.mcard { display: block; padding: 14px 16px; border-radius: 14px; background: var(--surface); border: 1px solid var(--border); color: var(--text); text-decoration: none; transition: transform .15s ease, box-shadow .15s ease; }
.mcard:hover { transform: translateY(-2px); box-shadow: var(--shadow); }
.mcard .name { font-weight: 700; font-size: 15px; word-break: break-word; }
.mcard .big { font-size: 26px; font-weight: 750; font-variant-numeric: tabular-nums; margin: 6px 0 2px; }
.mcard .meta { color: var(--muted); font-size: 12.5px; }
.mcard .bar { display: block; height: 8px; margin: 8px 0 6px; }
.tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(34px, 1fr)); gap: 5px; }
.tile { display: block; aspect-ratio: 1; border-radius: 6px; background: var(--bar); position: relative; }
.tile.ok { background: var(--ok); }
.tile.auto { background: color-mix(in srgb, var(--ok) 55%, var(--surface)); }
.tile.bad { background: var(--bad); opacity: .8; }
.tile:hover { outline: 2px solid var(--text); outline-offset: 1px; }
.legend { display: flex; flex-wrap: wrap; gap: 14px; font-size: 12.5px; color: var(--muted); margin-top: 10px; }
.legend i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 5px; vertical-align: -1px; }
.grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 14px; }
.grid2 .card h3 { margin-top: 0; }
.kv { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px 18px; font-size: 13.5px; }
.kv div span { display: block; color: var(--muted); font-size: 11.5px; text-transform: uppercase; letter-spacing: .04em; }
.kv div b { font-weight: 600; word-break: break-word; }
.status { display: inline-block; padding: 3px 10px; border-radius: 99px; font-size: 12.5px; font-weight: 700; vertical-align: middle; margin-left: 8px; }
.status.ok { background: var(--ok-soft); color: var(--ok); }
.status.auto { background: var(--ok-soft); color: var(--ok); }
.status.bad { background: var(--bad-soft); color: var(--bad); }
.story { font-size: 15px; line-height: 1.6; }
.story p { margin: 4px 0; }
.explain { background: var(--surface-2); border: 1px dashed var(--border); border-radius: 10px; padding: 10px 12px; font-size: 13px; color: var(--muted); margin-top: 10px; }
.explain b { color: var(--text); }
.timebar { display: flex; height: 26px; border-radius: 8px; overflow: hidden; background: var(--bar); margin: 6px 0; }
.timebar > span { display: block; height: 100%; border-right: 2px solid var(--surface); min-width: 3px; }
.timebar .t-auto { background: color-mix(in srgb, var(--ok) 55%, var(--surface)); } .timebar .t-ok { background: var(--ok); } .timebar .t-bad { background: var(--bad); opacity: .75; } .timebar .t-other { background: var(--bar); }
.attempts { display: flex; flex-direction: column; gap: 10px; }
.attempt { border: 1px solid var(--border); border-left: 4px solid var(--bad); border-radius: 12px; background: var(--surface); padding: 10px 14px; }
.attempt.ok { border-left-color: var(--ok); }
.attempt .head { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: baseline; font-size: 13.5px; }
.attempt .head b { font-size: 14px; }
.attempt .err { font-family: ui-monospace, "Cascadia Code", Menlo, monospace; font-size: 12.5px; margin: 6px 0 2px; word-break: break-word; }
.steps-list { margin: 0; padding-left: 0; list-style: none; border-left: 2px solid var(--border); }
.steps-list li { position: relative; padding: 4px 0 8px 16px; font-size: 13.5px; white-space: pre-wrap; }
.steps-list li::before { content: ""; position: absolute; left: -6px; top: 10px; width: 10px; height: 10px; border-radius: 50%; background: var(--accent); }
.steps-list .t { color: var(--muted); font-variant-numeric: tabular-nums; margin-right: 6px; }
pre.code { white-space: pre-wrap; font-size: 12.5px; font-family: ui-monospace, "Cascadia Code", Menlo, monospace; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px; overflow: auto; margin: 0; }
.bullets { margin: 0; padding-left: 18px; color: var(--muted); font-size: 14px; }
.bullets li { margin: 4px 0; }
.bullets b { color: var(--text); }
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
.stat .small { display: block; }
.quick-head { font-size: 15px; margin: 18px 0 4px; }
@keyframes grow { from { width: 0; } to { width: var(--w); } }
.pill { display: inline-block; padding: 2px 9px; border-radius: 99px; font-size: 11.5px; font-weight: 650; background: var(--bar); color: var(--muted); }
.pill.best { background: var(--accent-soft); color: var(--accent-text); }
.pill.omh { background: var(--ok-soft); color: var(--ok); }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin: 16px 0; }
.stat b { display: block; font-size: 24px; font-variant-numeric: tabular-nums; }
.why { display: grid; grid-template-columns: minmax(120px, 200px) 1fr minmax(36px, auto); gap: 12px; align-items: center; margin: 7px 0; font-size: 13.5px; }
.why > span:last-child { white-space: nowrap; text-align: right; }
pre.card { white-space: pre-wrap; font-size: 12.5px; overflow: auto; font-family: ui-monospace, "Cascadia Code", Menlo, monospace; }
details summary { cursor: pointer; color: var(--accent-text); font-size: 13px; }
details pre { white-space: pre-wrap; font-size: 12px; background: var(--bar); padding: 10px; border-radius: 10px; max-height: 320px; overflow: auto; font-family: ui-monospace, "Cascadia Code", Menlo, monospace; }
.basics { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 10px 22px; }
.basics p { margin: 0; color: var(--muted); font-size: 14px; }
.basics b { color: var(--text); }
.crumbs { margin: 22px 0 0; font-size: 13px; }
.empty { text-align: center; padding: 34px 18px; }
.empty > b:first-child { display: block; font-size: 17px; margin-bottom: 6px; }
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
<a href="${root}index.html#models">Models</a>
<a href="${root}index.html#method">Methodology</a>
<a href="${esc(repo)}">GitHub</a>
<a class="btn primary" href="${RELEASES}">Download Mack</a>
</nav>
</div></header>
<main class="wrap-page">
${body}
</main>
<footer class="bottom"><div class="wrap-page">
<span>Runs shared from Mack's Benchmark screen. Solved means Lean accepted the proof.</span>
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

/** A rate's 95% range, as text: `43–82%`. */
const range = (low: number, high: number) => `${Math.round(low * 100)}–${Math.round(high * 100)}%`;

/** A duration as people read it: 45s, 3m 20s, 1h 05m. */
const dur = (ms: number) => {
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${String(sec % 60).padStart(2, "0")}s`;
  return `${Math.floor(sec / 3600)}h ${String(Math.floor((sec % 3600) / 60)).padStart(2, "0")}m`;
};

/** What "solved by automation" means, in two sentences. */
const AUTOMATION = `<b>Solved by automation</b> means Lean's own tactics closed the problem before any model wrote a proof: Mack first tries <code>omega</code>, <code>norm_num</code>, <code>simp</code>, <code>linarith</code>, <code>nlinarith</code>, <code>positivity</code>, <code>aesop</code>, <code>grind</code> and <code>exact?</code> on the statement, all in one Lean run. No proof attempts are spent (at most the short proof plan, when that setting is on), and the proof is checked by the same strict verifier.`;

/** The tactic that closed a problem by automation, read from its proof. */
const closingTactic = (proof?: string) => (proof ? (/:=\s*by\s*\n\s*(.+)\s*$/.exec(proof.trim())?.[1] ?? "").trim() : "");

/** What cannot be checked in a shared run, said once under each table that shows it. */
const SELF_REPORTED = `<p class="note">* As the run reported it: cost, time, tokens and the model served cannot be checked from here. Solves can: CI re-checks every solved proof with Lean before a run is merged.</p>`;

type Row = { r: SharedRun; p: ReturnType<typeof publishedScore>; usd: number };

/** A model setup as a file name: `deepseek-v4-deepseek-prover-v2`. */
export const modelSlug = (r: BenchRun) => models(r).toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "model";

const thinking = (r: BenchRun) => (r.config.effort ? esc(r.config.effort) : '<span class="muted">auto</span>');

const rowsOf = (runs: SharedRun[]): Row[] =>
  runs
    .map((r) => ({ r, p: publishedScore(r), usd: summarize(r).usd }))
    .filter((x) => x.p.of > 0)
    .sort((a, b) => Number(b.p.full) - Number(a.p.full) || b.p.rate - a.p.rate || b.p.of - a.p.of || a.usd - b.usd || b.r.startedAt - a.r.startedAt);

/** One set's runs in one table: runs on the whole set ranked first, quick runs (part of the set) after them, marked and unranked. */
function runTable(rows: Row[], root: string, withModel = true): string {
  let rank = 0;
  const body = rows
    .map(({ r, p, usd: spent }, i) => {
      const ranked = p.full;
      if (ranked) rank++;
      const best = ranked && rank === 1 && rows.filter((x) => x.p.full).length > 1;
      return `<tr class="${ranked ? (rank === 1 ? "first" : "") : "dim"}">
<td class="rank">${ranked ? rank : "–"}</td>
${withModel ? `<td class="wrap"><a href="${root}models/${esc(modelSlug(r))}.html">${esc(models(r))}</a>*</td>` : ""}
<td>${esc(METHOD_LABELS[r.config.method ?? "single"])}${r.config.method === "search" || r.config.method === "ultramath" ? ' <span class="pill omh">OMH</span>' : ""}</td>
<td>${thinking(r)}</td>
<td><a href="${root}runs/${esc(r.folder)}.html"><b>${p.solved}/${p.of}</b></a>${ranked ? "" : ' <span class="pill">quick</span>'}</td>
<td>${rateCell(p.rate, best, i)}</td>
<td class="muted">${range(p.low, p.high)}</td>
<td>${p.solved ? usd(spent / p.solved) : "–"}</td>
<td>${day(r.startedAt)}</td>
<td title="${esc(r.harness?.procedures.join(", ") ?? "")}">${esc(harnessLabel(r.harness, r.appVersion ?? r.env?.app).replace(/^Mack /, ""))}</td>
</tr>`;
    })
    .join("\n");
  return `<div class="scroll"><table>
<thead><tr><th>#</th>${withModel ? "<th>Model*</th>" : ""}<th>Method</th><th>Thinking</th><th>Solved</th><th>Rate</th><th>95% range</th><th>$ / solve*</th><th>Date</th><th>Harness</th></tr></thead>
<tbody>
${body}
</tbody></table></div>`;
}

/** PutnamBench split by year: older problems against the latest competitions, for each run that tried both. */
function contaminationRows(runs: SharedRun[]): string {
  const recentIds = new Set(BENCH_SETS.find((s) => s.id === RECENT_SET)?.problems.map((p) => p.id) ?? []);
  const lines: string[] = [];
  for (const r of runs.filter((x) => x.set === "putnambench")) {
    const older = r.results.filter((x) => !recentIds.has(x.id));
    const recent = r.results.filter((x) => recentIds.has(x.id));
    if (!older.length || !recent.length) continue;
    const solved = (xs: BenchResult[]) => xs.filter((x) => x.outcome === "solved").length;
    lines.push(`<tr><td class="wrap"><a href="runs/${esc(r.folder)}.html">${esc(models(r))}</a></td><td>${solved(older)}/${older.length} (${pct(solved(older) / older.length)})</td><td>${solved(recent)}/${recent.length} (${pct(solved(recent) / recent.length)})</td></tr>`);
  }
  for (const { r, p } of rowsOf(runs.filter((x) => x.set === RECENT_SET))) {
    const older = rowsOf(runs.filter((x) => x.set === "putnambench" && models(x) === models(r)))[0];
    lines.push(`<tr><td class="wrap"><a href="runs/${esc(r.folder)}.html">${esc(models(r))}</a></td><td>${older ? `${older.p.solved}/${older.p.of} (${pct(older.p.rate)}), PutnamBench run` : '<span class="muted">no PutnamBench run</span>'}</td><td>${p.solved}/${p.of} (${pct(p.rate)}, range ${range(p.low, p.high)})</td></tr>`);
  }
  return lines.join("\n");
}

/** Every model setup and its runs, best first. */
function modelGroups(runs: SharedRun[]): { slug: string; name: string; runs: Row[]; best: Row }[] {
  const by = new Map<string, Row[]>();
  for (const row of rowsOf(runs)) by.set(modelSlug(row.r), [...(by.get(modelSlug(row.r)) ?? []), row]);
  return [...by.entries()]
    .map(([slug, rows]) => ({ slug, name: models(rows[0].r), runs: rows, best: rows[0] }))
    .sort((a, b) => Number(b.best.p.full) - Number(a.best.p.full) || b.best.p.rate - a.best.p.rate);
}

const kpi = (value: string, label: string, sub = "") => `<div class="kpi"><b>${value}</b><span>${label}</span>${sub ? `<i>${sub}</i>` : ""}</div>`;

/** Sets as tabs (CSS only: works without JavaScript), each with its leaderboard. */
function setTabs(runs: SharedRun[]): string {
  const sets = BENCH_SETS.filter((set) => runs.some((r) => r.set === set.id));
  if (!sets.length) return "";
  const css = sets.map((_, i) => `#set-${i}:checked ~ .panel-${i} { display: block; } #set-${i}:checked + label { background: var(--text); color: var(--bg); border-color: var(--text); }`).join("\n");
  const inputs = sets.map((set, i) => `<input type="radio" name="set" id="set-${i}"${i === 0 ? " checked" : ""}><label for="set-${i}">${esc(set.label)}<span class="n">${runs.filter((r) => r.set === set.id).length}</span></label>`).join("\n");
  const panels = sets
    .map((set, i) => {
      const rows = rowsOf(runs.filter((r) => r.set === set.id));
      const full = rows.filter((x) => x.p.full).length;
      return `<div class="panel panel-${i}">
${runTable(rows, "")}
<p class="note">${set.problems.length} problems. ${full ? `${full} run${full === 1 ? "" : "s"} on the whole set, ranked.` : `No run on all ${set.problems.length} yet: only whole-set runs are ranked.`} Quick runs (part of the set) are listed, unranked.</p>
</div>`;
    })
    .join("\n");
  return `<style>${css}</style><div class="tabs">${inputs}\n${panels}</div>`;
}

/** The leaderboard: one tab per problem set, the models as cards, and the methodology in short. */
export function indexPage(runs: SharedRun[], repo: string): string {
  const scores = runs.map((r) => publishedScore(r));
  const fullScores = scores.filter((x) => x.full);
  const best = (fullScores.length ? fullScores : scores).reduce((a, x) => Math.max(a, x.rate), 0);
  const solved = scores.reduce((a, x) => a + x.solved, 0);
  const groups = modelGroups(runs);
  const contamination = contaminationRows(runs);
  const counter = (value: number, opts: { dec?: number; suffix?: string } = {}) => `<span data-count="${value}" data-dec="${opts.dec ?? 0}" data-suffix="${opts.suffix ?? ""}">${value.toFixed(opts.dec ?? 0)}${opts.suffix ?? ""}</span>`;
  const cards = groups
    .map(
      (g, i) => `<a class="mcard" href="models/${esc(g.slug)}.html">
<div class="name">${esc(g.name)}</div>
<div class="big">${pct(g.best.p.rate)}</div>
${bar(g.best.p.rate, i)}
<div class="meta">${esc(setLabel(g.best.r.set))} · ${g.best.p.solved}/${g.best.p.of}${g.best.p.full ? "" : " (quick)"} · ${g.runs.length} run${g.runs.length === 1 ? "" : "s"}${g.best.p.solved ? ` · ${usd(g.best.usd / g.best.p.solved)}/solve` : ""}</div>
</a>`,
    )
    .join("\n");
  return page(
    "Mack benchmark",
    `<section class="hero compact">
<h1>Proving competition math <em>in Lean</em></h1>
<p class="lead">Open models on miniF2F and PutnamBench. A problem counts only when Lean's kernel accepts the proof, and CI re-checks every solve.</p>
<div class="cta">
<a class="btn primary" href="${RELEASES}">Download Mack for Windows or Linux</a>
<a class="btn" href="${esc(repo)}">GitHub</a>
</div>
<div class="kpis">
${kpi(counter(runs.length), "runs shared")}
${kpi(counter(groups.length), "model setups")}
${kpi(counter(solved), "proofs, Lean-checked")}
${kpi(counter(best * 100, { dec: 1, suffix: "%" }), "best rate", fullScores.length ? "on a whole set" : "quick runs only so far")}
</div>
</section>
<section id="leaderboard" class="reveal">
<h2>Leaderboard</h2>
${setTabs(runs) || `<div class="card empty"><b>No runs shared yet</b>Download Mack, run the Benchmark and press <b>Share as a PR</b>.<div class="cta" style="justify-content:center"><a class="btn primary" href="${RELEASES}">Download Mack</a></div></div>`}
${runs.length ? SELF_REPORTED : ""}
</section>
${groups.length ? `<section id="models" class="reveal"><h2>Models</h2><div class="cards">${cards}</div></section>` : '<section id="models"></section>'}
<section id="recent" class="reveal">
<h2>Recent problems: the contamination check</h2>
<p class="sub">Putnam ${RECENT_YEARS.join(" and ")} is least likely to be in training data. A model much weaker there than on older problems was probably helped by memory.</p>
${
  contamination
    ? `<div class="scroll"><table><thead><tr><th>Model*</th><th>Older Putnam</th><th>Recent</th></tr></thead><tbody>
${contamination}
</tbody></table></div>`
    : `<p class="note">No runs yet: run <b>${esc(setLabel(RECENT_SET))}</b>, or all of PutnamBench, and share it.</p>`
}
</section>
<section id="method" class="reveal">
<h2>Methodology</h2>
<ul class="bullets">
<li><b>Solved</b> = Lean's strict verifier accepted the proof: statement unchanged, no sorry or extra axiom.</li>
<li><b>Re-checked:</b> CI re-verifies every solved proof with the run's Mathlib before merging; a run must list its whole sample.</li>
<li><b>Ranked</b> only on a whole set; the 95% range shows how much one run can vary.</li>
<li><b>Self-reported</b> (*): cost, time, tokens and the model served.</li>
<li><b>Not pass@k:</b> Mack's attempts learn from Lean's errors; each run shows solves within 1, 4, 16 and 64 attempts.</li>
</ul>
<details style="margin-top:12px"><summary>How to read these results (glossary)</summary>
<div class="card basics" style="margin-top:10px">${BENCH_BASICS.map((b) => `<p><b>${esc(b.term)}.</b> ${esc(b.text)}</p>`).join("\n")}</div>
</details>
</section>`,
    "",
    repo,
  );
}

/** One model setup: every run of it, its best per set, and where it fails. */
export function modelPage(slug: string, runs: SharedRun[], repo: string): string {
  const rows = rowsOf(runs.filter((r) => modelSlug(r) === slug));
  const name = rows.length ? models(rows[0].r) : slug;
  const all = rows.flatMap((x) => x.r.results);
  const solved = all.filter((x) => x.outcome === "solved");
  const spent = rows.reduce((a, x) => a + x.usd, 0);
  const attempts = solved.reduce((a, x) => a + x.attempts, 0);
  const breakdown = failureBreakdown(all);
  const most = breakdown[0]?.count ?? 1;
  const bestBySet = BENCH_SETS.map((set) => rows.find((x) => x.r.set === set.id)).filter((x): x is Row => !!x);
  return page(
    `${name}: Mack benchmark`,
    `<p class="crumbs"><a href="../index.html#models">← Models</a></p>
<section class="hero compact" style="padding:14px 0 4px">
<h1 style="font-size:30px">${esc(name)}</h1>
<p class="muted">${rows.length} run${rows.length === 1 ? "" : "s"} · ${[...new Set(rows.map((x) => setLabel(x.r.set)))].join(", ")}</p>
</section>
<div class="kpis">
${bestBySet.map((x) => kpi(pct(x.p.rate), `best on ${esc(setLabel(x.r.set))}`, `${x.p.solved}/${x.p.of}${x.p.full ? "" : " quick"} · ${range(x.p.low, x.p.high)}`)).join("\n")}
${kpi(`${solved.length}/${all.filter((x) => x.outcome !== "skipped").length}`, "solved, all runs")}
${kpi(solved.length ? usd(spent / solved.length) : "–", "per solve*")}
${kpi(solved.length ? (attempts / solved.length).toFixed(1) : "–", "attempts per solve")}
</div>
<section class="reveal"><h2>Runs</h2>${runTable(rows, "../", false)}</section>
${
  breakdown.length
    ? `<section class="reveal"><h2>Where it fails</h2><div class="card">${breakdown
        .map((b) => `<div class="why" title="${esc(b.ids.join(", "))}"><span>${esc(FAILURES[b.kind].label)}</span>${bar(b.count / most, 0, "badbar")}<span class="muted">${b.count}</span></div>`)
        .join("\n")}</div></section>`
    : ""
}
${SELF_REPORTED}`,
    "../",
    repo,
  );
}

/** One run: its key numbers, every problem at a glance, how attempts ended, its settings, and every result. */
export function runPage(r: SharedRun, repo: string): string {
  const s = summarize(r);
  const p = publishedScore(r);
  const within = solvedWithin(r);
  const m = runMetrics(r);
  const c = r.config;
  const breakdown = failureBreakdown(r.results);
  const most = breakdown[0]?.count ?? 1;
  const tiles = r.results
    .map((x) => {
      const cls = x.outcome === "solved" ? (x.attempts === 0 ? "auto" : "ok") : x.outcome === "skipped" ? "" : "bad";
      const what = x.outcome === "solved" ? (x.attempts === 0 ? "solved by automation" : `solved in ${x.attempts} attempt${x.attempts === 1 ? "" : "s"}`) : x.outcome === "skipped" ? "skipped" : `not solved${x.failure ? `: ${FAILURES[x.failure].label}` : ""}`;
      const title = `${x.id}: ${what}, ${dur(x.ms)}`;
      return hasPage(x) ? `<a class="tile ${cls}" href="${esc(r.folder)}/${esc(x.id)}.html" title="${esc(title)}"></a>` : `<span class="tile ${cls}" title="${esc(title)}"></span>`;
    })
    .join("");
  const rows = r.results
    .map((x) => {
      const why = x.failure ? FAILURES[x.failure].label : "";
      const outcome = x.outcome === "solved" ? `<span class="ok">${x.attempts === 0 ? "solved by automation" : "solved"}</span>` : x.outcome === "skipped" ? '<span class="muted">skipped</span>' : '<span class="bad">not solved</span>';
      const detail =
        x.lastError || x.lastCandidate
          ? `<details><summary>${esc(why || "details")}</summary>${x.lastError ? `<p class="small">Lean's last feedback</p><pre>${esc(x.lastError)}</pre>` : ""}${x.lastCandidate ? `<p class="small">Last attempt</p><pre>${esc(x.lastCandidate)}</pre>` : ""}</details>`
          : esc(why);
      return `<tr><td>${hasPage(x) ? `<a href="${esc(r.folder)}/${esc(x.id)}.html">${esc(x.id)}</a>` : esc(x.id)}</td><td>${outcome}</td><td>${x.attempts}</td><td>${Math.round(x.ms / 1000)}s</td><td>${usd(x.usd)}</td><td class="wrap">${detail}</td></tr>`;
    })
    .join("\n");
  const kv = (label: string, value: string) => `<div><span>${label}</span><b>${value}</b></div>`;
  const byModel = m.byModel.map((x) => ({ ...x, model: x.model === "unknown" ? "Lean automation" : x.model }));
  return page(
    `${models(r)} on ${setLabel(r.set)} ${p.solved}/${p.of}: Mack benchmark`,
    `<p class="crumbs"><a href="../index.html#leaderboard">Leaderboard</a> / <a href="../models/${esc(modelSlug(r))}.html">${esc(models(r))}</a></p>
<section class="hero compact" style="padding:14px 0 4px">
<h1 style="font-size:30px">${esc(models(r))} · ${esc(setLabel(r.set))}</h1>
<p class="muted">${esc(METHOD_LABELS[c.method ?? "single"])} · thinking ${c.effort ? esc(c.effort) : "auto"} · ${day(r.startedAt)}${r.sharedBy ? ` · by ${esc(r.sharedBy)}` : ""}${r.appVersion ? ` · Mack ${esc(r.appVersion)}` : ""}</p>
</section>
<div class="kpis">
${kpi(`${p.solved}/${p.of}`, `solved${p.full ? ", whole set" : `, ${p.of} of the set`}`)}
${kpi(`<span data-count="${(p.rate * 100).toFixed(1)}" data-dec="1" data-suffix="%">${pct(p.rate)}</span>`, "solve rate", `95% range ${range(p.low, p.high)}`)}
${kpi(usd(s.usd), "cost*", p.solved ? `${usd(s.usd / p.solved)} per solve` : "")}
${kpi(`${Math.round(s.ms / 60000)} min`, "time*")}
${m.attempts ? kpi(m.attemptsPerSolve !== null ? m.attemptsPerSolve.toFixed(1) : "–", "attempts per solve", `${s.byAutomation} by automation alone`) : ""}
${m.attempts ? kpi(`${tokens(m.promptTokens)} / ${tokens(m.completionTokens)}`, "tokens in / out*") : ""}
</div>
<section class="reveal"><h2>Problems</h2>
<div class="card"><div class="tiles">${tiles}</div>
<div class="legend"><span><i style="background:var(--ok)"></i>solved by a model</span><span><i style="background:color-mix(in srgb, var(--ok) 55%, var(--surface))"></i>solved by automation</span><span><i style="background:var(--bad)"></i>not solved</span><span><i style="background:var(--bar)"></i>skipped</span><span>Hover for the time; click for the deep dive.</span></div>
${s.byAutomation ? `<div class="explain">${AUTOMATION}</div>` : ""}</div>
</section>
${timeSection(r)}
<section class="reveal grid2">
${
  p.solved
    ? `<div class="card"><h3>Solved within k attempts</h3>${within.map((w, i) => `<div class="why"><span>within ${w.k} attempt${w.k === 1 ? "" : "s"}</span>${bar(p.of ? w.solved / p.of : 0, i, "okbar")}<span class="muted">${w.solved}</span></div>`).join("\n")}<p class="note">Like pass@k, but attempts learn from Lean's errors.</p></div>`
    : ""
}
${attemptsSection(r)}
${
  breakdown.length
    ? `<div class="card"><h3>Why problems were not solved</h3>${breakdown
        .map((b) => `<div class="why" title="${esc(b.ids.join(", "))}"><span>${esc(FAILURES[b.kind].label)}</span>${bar(b.count / most, 0, "badbar")}<span class="muted">${b.count}</span></div>`)
        .join("\n")}</div>`
    : ""
}
</section>
${commonErrors(r)}
${
  byModel.length > 1 || (byModel.length === 1 && byModel[0].model !== "Lean automation")
    ? `<section class="reveal"><h2>Each model</h2>
<div class="scroll"><table>
<thead><tr><th>Model</th><th>Attempts</th><th>Verified</th><th>Hit rate</th><th>Tokens out</th><th>Cut short</th></tr></thead>
<tbody>
${byModel.map((x) => `<tr><td>${esc(short(x.model))}</td><td>${x.attempts}</td><td>${x.verified}</td><td>${pct(x.attempts ? x.verified / x.attempts : 0)}</td><td>${tokens(x.completionTokens)}</td><td>${x.truncated}</td></tr>`).join("\n")}
</tbody></table></div></section>`
    : ""
}
<section class="reveal"><h2>Settings</h2>
<div class="card"><div class="kv">
${kv("Model", esc(c.model))}
${kv("Prover", c.prover ? esc(c.prover) : "none")}
${kv("Thinking", c.effort ? esc(c.effort) : "model default")}
${kv("Method", esc(METHOD_LABELS[c.method ?? "single"]))}
${kv("Attempts", `${c.maxAttempts}, ${c.parallel} at once`)}
${kv("Restart after", `${c.revisions} revisions`)}
${kv("Automation", c.automation ? "on" : "off")}
${kv("Premise selection", c.premises ? "on" : "off")}
${kv("Easier versions first", c.easierFirst ? "on" : "off")}
${kv("Lemma pool", c.lemmaPool ? "on" : "off")}
${r.harness ? kv("Harness", `Mack ${esc(r.harness.mack)} · OMH ${esc(r.harness.openMathHarness)}`) : ""}
${r.env?.mathlib ? kv("Mathlib", `<code>${esc(r.env.mathlib.slice(0, 12))}</code>`) : ""}
${r.env?.lean ? kv("Lean", esc(r.env.lean)) : ""}
${r.env?.platform ? kv("Machine*", esc(r.env.platform)) : ""}
</div>
${r.harness ? `<p class="note">Harness Mack ${esc(r.harness.mack)}, Open Math Harness <b>${esc(r.harness.openMathHarness)}</b>; procedures: ${esc(r.harness.procedures.join(", "))}.</p>` : ""}
</div></section>
<section class="reveal"><details><summary>All ${r.results.length} results as a table</summary>
<div class="scroll" style="margin-top:10px"><table>
<thead><tr><th>Problem</th><th>Outcome</th><th>Attempts</th><th>Time</th><th>Cost</th><th>Why</th></tr></thead>
<tbody>
${rows}
</tbody></table></div></details>
</section>
${SELF_REPORTED}
<p class="small"><a href="${esc(repo)}/blob/main/benchmarks/runs/${esc(r.folder)}/REPORT.md">Full report</a> · <a href="${esc(repo)}/blob/main/benchmarks/runs/${esc(r.folder)}/run.json">run.json</a>${r.attemptsLogged ? ` · <a href="${esc(repo)}/blob/main/benchmarks/runs/${esc(r.folder)}/attempts.jsonl">attempts.jsonl</a> (every attempt)` : ""}</p>`,
    "../",
    repo,
  );
}

/** How long problems took: median, slowest, and the slowest few as bars. */
function timeSection(r: SharedRun): string {
  const tried = r.results.filter((x) => x.outcome !== "skipped" && x.ms > 0);
  if (!tried.length) return "";
  const times = tried.map((x) => x.ms).sort((a, b) => a - b);
  const q = (f: number) => times[Math.min(times.length - 1, Math.floor(f * (times.length - 1)))];
  const solved = tried.filter((x) => x.outcome === "solved");
  const slowest = [...tried].sort((a, b) => b.ms - a.ms).slice(0, 8);
  const max = slowest[0].ms || 1;
  const avg = (xs: BenchResult[]) => (xs.length ? xs.reduce((a, x) => a + x.ms, 0) / xs.length : 0);
  return `<section class="reveal"><h2>Time per problem</h2>
<div class="kpis">
${kpi(dur(q(0.5)), "median")}
${kpi(dur(q(0.9)), "90th percentile")}
${kpi(dur(times[times.length - 1]), "slowest")}
${solved.length ? kpi(dur(avg(solved)), "average when solved") : ""}
${tried.length > solved.length ? kpi(dur(avg(tried.filter((x) => x.outcome !== "solved"))), "average when not solved") : ""}
</div>
<div class="card"><h3>Slowest problems</h3>${slowest
    .map((x, i) => `<div class="why"><span>${hasPage(x) ? `<a href="${esc(r.folder)}/${esc(x.id)}.html">${esc(x.id)}</a>` : esc(x.id)}</span>${bar(x.ms / max, i, x.outcome === "solved" ? "okbar" : "badbar")}<span class="muted">${dur(x.ms)}</span></div>`)
    .join("\n")}<p class="note">Time is wall-clock per problem*: model calls, Lean checks and automation together.</p></div>
</section>`;
}

/** Every attempt of a run by how it ended, as a card; empty without a log. */
function attemptsSection(r: SharedRun): string {
  const kinds = attemptKinds(r);
  if (!kinds.length) return "";
  const total = kinds.reduce((a, k) => a + k.count, 0);
  const most = kinds[0].count;
  return `<div class="card"><h3>All ${total} attempts by how they ended</h3>${kinds
    .map((k) => `<div class="why"><span>${esc(k.kind === "verified" ? "Verified" : FAILURES[k.kind].label)}</span>${bar(k.count / most, 0, k.kind === "verified" ? "okbar" : "badbar")}<span class="muted">${k.count}</span></div>`)
    .join("\n")}</div>`;
}

/** The Lean errors that cost the most attempts; empty without a log. */
function commonErrors(r: SharedRun): string {
  const errs = topErrors(r, 10);
  if (!errs.length) return "";
  return `<section class="reveal"><h2>Commonest Lean errors</h2>
<div class="scroll"><table>
<thead><tr><th>Error</th><th>Attempts</th><th>Problems</th></tr></thead>
<tbody>
${errs.map((e) => `<tr><td class="wrap">${esc(e.error)}</td><td>${e.count}</td><td>${e.problems}</td></tr>`).join("\n")}
</tbody></table></div></section>`;
}

const clock = (ms: number | null) => (ms === null ? "" : `+${ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60_000)}m${String(Math.round((ms % 60_000) / 1000)).padStart(2, "0")}s`}`);

/** One problem of a run: its statement, then every attempt in order, each opening to Lean's feedback, the model's thinking and the attempt. */
export function problemPage(r: SharedRun, x: BenchResult, source: string | undefined, repo: string): string {
  const rows = timelineOf(x);
  const auto = x.outcome === "solved" && x.attempts === 0;
  const status = x.outcome === "solved" ? (auto ? '<span class="status auto">Solved by automation</span>' : '<span class="status ok">Solved</span>') : x.outcome === "skipped" ? '<span class="status">Skipped</span>' : '<span class="status bad">Not solved</span>';
  const autoRows = rows.filter((row) => row.n === 0);
  const autoMs = autoRows.reduce((a, row) => a + row.ms, 0);
  const modelMs = rows.filter((row) => row.n > 0).reduce((a, row) => a + row.ms, 0);
  const otherMs = Math.max(0, x.ms - modelMs - autoMs);
  const tokIn = rows.reduce((a, row) => a + (row.promptTokens ?? 0), 0);
  const tokOut = rows.reduce((a, row) => a + (row.tokens ?? 0), 0);
  const verified = rows.find((row) => row.kind === "verified");
  const failedRows = rows.filter((row) => row.kind !== "verified" && row.n > 0);
  const reasons = new Map<string, number>();
  for (const row of failedRows) reasons.set(row.label, (reasons.get(row.label) ?? 0) + 1);
  const reasonText = [...reasons.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n}× ${k.toLowerCase()}`).join(", ");
  const repeated = rows.filter((a) => a.repeats).length;

  // How it went, in a few sentences.
  const story: string[] = [];
  if (auto) {
    const tactic = closingTactic(x.proof);
    story.push(`Lean's automation proved it on its own${tactic ? `, with <code>${esc(tactic)}</code>` : ""}, before any model wrote a proof: no proof attempts spent, ${dur(x.ms)} in all${autoMs ? `, ${dur(autoMs)} of it the automation` : ""}.`);
  } else if (x.outcome === "solved") {
    story.push(`Solved on attempt ${verified?.n ?? x.attempts} of ${x.attempts}${verified?.model ? ` by <b>${esc(short(verified.model))}</b>` : ""}, in ${dur(x.ms)}.`);
    if (failedRows.length) story.push(`Before that, ${failedRows.length} attempt${failedRows.length === 1 ? "" : "s"} failed: ${esc(reasonText)}. Each failure's Lean errors went back to the model for the next try.`);
    else story.push("The first proof the model wrote was accepted.");
  } else if (x.outcome === "skipped") {
    story.push(`Not tried: ${esc(x.message ?? "the run stopped or its budget ran out")}.`);
  } else {
    story.push(`Not solved after ${x.attempts} attempt${x.attempts === 1 ? "" : "s"} and ${dur(x.ms)}${x.failure ? `; mostly <b>${esc(FAILURES[x.failure].label.toLowerCase())}</b>` : ""}.`);
    if (reasonText) story.push(`How the attempts ended: ${esc(reasonText)}.`);
    if (x.failure) story.push(`<span class="muted">What would help: ${esc(FAILURES[x.failure].fix)}.</span>`);
  }
  if (repeated) story.push(`<span class="muted">${repeated} attempt${repeated === 1 ? "" : "s"} repeated an error an earlier attempt had already hit.</span>`);

  // Where the time went: each attempt, then everything else (automation, Lean set-up, planning).
  const total = Math.max(x.ms, modelMs + autoMs) || 1;
  const timebar =
    x.ms > 0
      ? `<div class="timebar">${rows.map((row) => `<span class="${row.n === 0 ? "t-auto" : row.kind === "verified" ? "t-ok" : "t-bad"}" style="width:${((row.ms / total) * 100).toFixed(2)}%" title="${row.n === 0 ? "Lean's automation" : `Attempt ${row.n}`}: ${esc(row.label)}, ${dur(row.ms)}"></span>`).join("")}${otherMs ? `<span class="t-other" style="width:${((otherMs / total) * 100).toFixed(2)}%" title="Automation, Lean set-up and planning: ${dur(otherMs)}"></span>` : ""}</div>
<div class="legend">${autoMs ? `<span><i style="background:color-mix(in srgb, var(--ok) 55%, var(--surface))"></i>Lean's automation (${dur(autoMs)})</span>` : ""}${modelMs ? `<span><i style="background:var(--ok)"></i>verified attempt</span><span><i style="background:var(--bad)"></i>failed attempt</span>` : ""}<span><i style="background:var(--bar)"></i>Lean set-up and planning (${dur(otherMs)})</span></div>`
      : "";

  const attempts = rows
    .map(
      (a) => `<div class="attempt ${a.kind === "verified" ? "ok" : ""}">
<div class="head"><b>${a.n === 0 ? "Lean's automation" : `Attempt ${a.n}`}</b><span class="${a.kind === "verified" ? "ok" : "bad"}">${esc(a.label)}</span><span class="muted">${esc(short(a.model ?? ""))}</span><span class="muted">${dur(a.ms)}${a.offsetMs !== null ? ` · at ${clock(a.offsetMs)}` : ""}</span><span class="muted">${a.promptTokens ? `${tokens(a.promptTokens)} → ` : ""}${tokens(a.tokens)} tokens${a.truncated ? ' <span class="bad">cut short</span>' : ""}</span></div>
${a.error ? `<div class="err">${esc(a.error)}${a.repeats ? ` <span class="muted">(same as attempt ${a.repeats})</span>` : ""}</div>` : ""}
<details><summary>Lean's feedback, the model's thinking and the attempt</summary>
${a.detail ? `<p class="small">Lean's feedback</p><pre>${esc(a.detail)}</pre>` : ""}
${a.thinking ? `<p class="small">The model's thinking</p><pre>${esc(a.thinking)}</pre>` : ""}
${a.prose ? `<p class="small">What it wrote around the proof</p><pre>${esc(a.prose)}</pre>` : ""}
<p class="small">The attempt</p><pre>${esc(a.candidate)}</pre>
</details>
</div>`,
    )
    .join("\n");

  return page(
    `${x.id}: Mack benchmark`,
    `<p class="crumbs"><a href="../../index.html#leaderboard">Leaderboard</a> / <a href="../../models/${esc(modelSlug(r))}.html">${esc(models(r))}</a> / <a href="../${esc(r.folder)}.html">${esc(setLabel(r.set))}, ${day(r.startedAt)}</a></p>
<h1 style="font-size:28px;margin:14px 0 4px">${esc(x.id)} ${status}</h1>
<div class="kpis">
${kpi(dur(x.ms), "time*")}
${kpi(String(x.attempts), "model attempts", auto ? "none needed" : verified ? `verified on #${verified.n}` : "")}
${kpi(usd(x.usd), "cost*")}
${rows.length ? kpi(`${tokens(tokIn)} / ${tokens(tokOut)}`, "tokens in / out*") : ""}
${modelMs ? kpi(dur(modelMs), "in model attempts", `${dur(x.ms - modelMs)} other`) : autoMs ? kpi(dur(autoMs), "in automation", `${dur(otherMs)} set-up and planning`) : ""}
</div>
<section><h2>How it went</h2>
<div class="card story">${story.map((t) => `<p>${t}</p>`).join("")}
${auto ? `<div class="explain">${AUTOMATION}</div>` : ""}
${timebar}</div></section>
${source ? `<section><h2>The problem</h2><pre class="code">${esc(source.trim())}</pre></section>` : ""}
${rows.length ? `<section><h2>Attempts</h2><div class="attempts">${attempts}</div></section>` : ""}
${
  x.timeline?.length
    ? `<section><h2>Every step</h2><div class="card"><ol class="steps-list">${x.timeline.map((t) => `<li><span class="t">${clock(t.t)}</span>${esc(t.message)}</li>`).join("")}</ol></div></section>`
    : ""
}
${x.proof ? `<section><h2>The verified proof</h2><pre class="code">${esc(x.proof)}</pre><p class="note">Accepted by Mack's strict verifier and re-checked with Lean in CI.</p></section>` : ""}
${SELF_REPORTED}
<p class="small"><a href="${esc(repo)}/blob/main/benchmarks/runs/${esc(r.folder)}/attempts.jsonl">attempts.jsonl</a></p>`,
    "../../",
    repo,
  );
}

/** Whether a problem has a deep-dive page: it has attempts, steps or a proof to show. */
const hasPage = (x: BenchResult) => !!(x.log?.length || x.timeline?.length || x.proof);

/** Every page of the site, by path. */
export function buildSite(runs: SharedRun[], repo: string): Record<string, string> {
  const files: Record<string, string> = { "index.html": indexPage(runs, repo) };
  for (const slug of new Set(runs.map((r) => modelSlug(r)))) files[`models/${slug}.html`] = modelPage(slug, runs, repo);
  for (const r of runs) {
    files[`runs/${r.folder}.html`] = runPage(r, repo);
    const set = BENCH_SETS.find((s) => s.id === r.set);
    for (const x of r.results) if (hasPage(x)) files[`runs/${r.folder}/${x.id}.html`] = problemPage(r, x, set?.problems.find((p) => p.id === x.id)?.source, repo);
  }
  return files;
}
