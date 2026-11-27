// The public benchmark site: a static HTML leaderboard of the runs Mack users
// shared (benchmarks/runs/<folder>/run.json, merged into the Mack repo),
// rebuilt by .github/workflows/benchmarks-site.yml and served on GitHub Pages.
// One page lists every run by problem set, best first; each run has a page
// with its settings, its failures by reason and every problem's result.
// Pure functions of the runs, so the page is the same wherever it is built.

import { attemptKinds, BENCH_BASICS, BENCH_SETS, LOG_LIMITS, WITHIN, harnessLabel, METHOD_LABELS, FAILURES, failureBreakdown, publishedScore, RECENT_SET, RECENT_YEARS, runMetrics, solvedWithin, summarize, timelineOf, topErrors, type AttemptLog, type BenchResult, type BenchRun } from "./bench";

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
.facts { display: flex; flex-wrap: wrap; gap: 6px 22px; margin: 14px 0 0; color: var(--muted); font-size: 14px; }
.facts b { color: var(--text); font-size: 17px; font-variant-numeric: tabular-nums; margin-right: 4px; }
.cell-sub { display: block; color: var(--muted); font-size: 11.5px; margin-top: 1px; }
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
.tip { position: relative; display: inline-grid; place-items: center; width: 15px; height: 15px; margin-left: 5px; border-radius: 50%; border: 1px solid var(--border); color: var(--muted); font: 600 10px/1 ui-sans-serif, system-ui, sans-serif; cursor: help; vertical-align: 2px; text-transform: none; letter-spacing: 0; }
.tip::after { content: attr(data-tip); position: absolute; left: 50%; bottom: calc(100% + 8px); transform: translateX(-50%); width: max-content; max-width: 260px; padding: 7px 10px; border-radius: 8px; background: var(--text); color: var(--bg); font: 500 12.5px/1.45 ui-sans-serif, system-ui, sans-serif; white-space: normal; text-align: left; pointer-events: none; z-index: 20; display: none; }
.tip:hover::after, .tip:focus::after { display: block; }
th .tip::after { bottom: auto; top: calc(100% + 8px); }
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
.rate { display: flex; align-items: center; gap: 10px; min-width: 150px; font-variant-numeric: tabular-nums; }
.bar { flex: 1; height: 8px; background: var(--bar); border-radius: 99px; overflow: hidden; min-width: 60px; }
.bar > span { display: block; height: 100%; width: var(--w); border-radius: 99px; background: linear-gradient(90deg, var(--accent), var(--accent-2)); animation: grow 1s cubic-bezier(.2,.8,.2,1) both; animation-delay: calc(var(--i, 0) * 70ms + 150ms); }
.bar.badbar > span { background: var(--bad); opacity: .75; }
.bar.okbar > span { background: var(--ok); }
.stat .small { display: block; }
.size-head { font-size: 15px; margin: 18px 0 8px; }
.panel > .size-head:first-child { margin-top: 4px; }
@keyframes grow { from { width: 0; } to { width: var(--w); } }
.pill { display: inline-block; padding: 2px 9px; border-radius: 99px; font-size: 11.5px; font-weight: 650; background: var(--bar); color: var(--muted); }
.pill.best { background: var(--accent-soft); color: var(--accent-text); }
.pill.omh { background: var(--ok-soft); color: var(--ok); }
.pill.official { background: var(--accent); color: #17150a; text-decoration: none; vertical-align: middle; }
h1 .pill.official { font-size: 13px; }
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
.toc { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 14px; }
.toc .pill { text-decoration: none; }
.toc .pill:hover { background: var(--accent-soft); color: var(--accent-text); }
section[id] { scroll-margin-top: 70px; }
code { font-family: ui-monospace, "Cascadia Code", Menlo, monospace; font-size: .92em; }
.empty { text-align: center; padding: 34px 18px; }
.empty > b:first-child { display: block; font-size: 17px; margin-bottom: 6px; }
footer.bottom { margin-top: 30px; border-top: 1px solid var(--border); padding: 26px 0 44px; font-size: 13px; color: var(--muted); }
footer.bottom .wrap-page { display: flex; flex-wrap: wrap; gap: 10px 22px; justify-content: space-between; }
/* Sections rise into place as they scroll into view (only when JavaScript runs; without it everything is simply shown). */
.js .reveal { opacity: 0; transform: translateY(14px); transition: opacity .6s ease, transform .6s cubic-bezier(.2,.8,.2,1); }
.js .reveal.in { opacity: 1; transform: none; }
@media (prefers-reduced-motion: reduce) { .bar > span { animation: none; } .js .reveal { opacity: 1; transform: none; transition: none; } .btn { transition: none; } html { scroll-behavior: auto; } }
@media (max-width: 640px) { nav.links a:not(.btn) { display: none; } th.opt, td.opt { display: none; } th, td { padding: 10px 10px; } td.wrap { min-width: 0; } .rate { min-width: 0; } .rate .bar { display: none; } .hero { padding-top: 34px; } table.stack thead { display: none; } table.stack tr { display: block; padding: 10px 14px; border-bottom: 1px solid var(--border); } table.stack tr:last-child { border-bottom: 0; } table.stack td { display: block; padding: 2px 0; border: 0; white-space: normal; min-width: 0; } }
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
<a href="${root}methodology.html">Methodology</a>
<a href="${esc(repo)}">GitHub</a>
<a class="btn primary" href="${RELEASES}">Download Mack</a>
</nav>
</div></header>
<main class="wrap-page">
${body}
</main>
<footer class="bottom"><div class="wrap-page">
<span>Runs shared from Mack's Benchmark screen. Solved means Lean accepted the proof.</span>
<span>Problems from miniF2F (MIT) and PutnamBench (Apache-2.0) · <a href="${esc(repo)}#contributing">Contribute</a></span>
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

/** A small (i) that explains a term in one line, on hover, focus or tap. */
const tip = (text: string) => `<span class="tip" tabindex="0" role="note" aria-label="${esc(text)}" data-tip="${esc(text)}">i</span>`;

/** The one-line explanations, the same wherever a term appears. */
const TIPS = {
  automation: "Lean's own tactics (omega, simp, linarith, grind…) closed it before any model wrote a proof. Free, and checked like any proof.",
  range: "95% confidence interval. With few problems it is wide; two runs differ only when their ranges barely overlap.",
  quick: "Runs of the same size face the same problems, so they are ranked against each other. A sample can be easier or harder than the whole set.",
  whole: "Every problem of the set: the number to compare with published results.",
  within: "Problems solved within k model attempts. Like pass@k, but attempts learn from Lean's errors.",
  reported: "Self-reported by the run; cannot be checked. Solves can: CI re-checks every proof with Lean.",
  thinking: "How deeply the model was asked to reason (reasoning effort). auto = the model's default.",
  perSolve: "The run's whole cost divided by problems solved.",
  time: "Wall-clock per problem: model calls, Lean checks and automation together.",
  verified: "Accepted by Mack's strict verifier and re-checked with Lean in CI.",
  contamination: "Recent Putnam problems are least likely to be in training data. Much weaker there suggests memorization helped elsewhere.",
  official: "Run by Mack's own workflow on a fixed cloud machine (GitHub Actions, 4 CPUs, 16 GB), so its time and cost compare across official runs.",
  harness: "Under each method: the Mack version and Open Math Harness commit it ran. Hover for the procedures used.",
} as const;

/** A duration as people read it: 45s, 3m 20s, 1h 05m. */
const dur = (ms: number) => {
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${String(sec % 60).padStart(2, "0")}s`;
  return `${Math.floor(sec / 3600)}h ${String(Math.floor((sec % 3600) / 60)).padStart(2, "0")}m`;
};

/** The tactic that closed a problem by automation, read from its proof. */
const closingTactic = (proof?: string) => (proof ? (/:=\s*by\s*\n\s*(.+)\s*$/.exec(proof.trim())?.[1] ?? "").trim() : "");

/** What cannot be checked in a shared run, said once under each table that shows it. */
const SELF_REPORTED = `<p class="note">* self-reported ${tip(TIPS.reported)}</p>`;

type Row = { r: SharedRun; p: ReturnType<typeof publishedScore>; usd: number };

/** The Official badge, linking the workflow run that made it. */
const officialPill = (r: BenchRun) => (r.official ? ` <a class="pill official" href="${esc(r.official.url)}">Official</a>${tip(TIPS.official)}` : "");

/** A model setup as a file name: `deepseek-v4-deepseek-prover-v2`. */
export const modelSlug = (r: BenchRun) => models(r).toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "model";

const thinking = (r: BenchRun) => (r.config.effort ? esc(r.config.effort) : '<span class="muted">auto</span>');

const rowsOf = (runs: SharedRun[]): Row[] =>
  runs
    .map((r) => ({ r, p: publishedScore(r), usd: summarize(r).usd }))
    .filter((x) => x.p.of > 0)
    .sort((a, b) => Number(b.p.full) - Number(a.p.full) || b.p.rate - a.p.rate || b.p.of - a.p.of || a.usd - b.usd || b.r.startedAt - a.r.startedAt);

/**
 * Runs in one table. `ranked`: the rows all ran the same problems (one set,
 * one sample size), so they are numbered best first; otherwise (a model's
 * runs across sets and sizes) they are listed without ranks.
 */
function runTable(rows: Row[], root: string, withModel = true, ranked = true): string {
  const body = rows
    .map(({ r, p, usd: spent }, i) => {
      const best = ranked && i === 0 && rows.length > 1;
      return `<tr class="${ranked && i === 0 ? "first" : ""}">
${ranked ? `<td class="rank">${i + 1}</td>` : ""}
${withModel ? `<td class="wrap"><a href="${root}models/${esc(modelSlug(r))}.html">${esc(models(r))}</a>*${officialPill(r)}</td>` : `<td>${esc(setLabel(r.set))}${officialPill(r)}</td>`}
<td class="opt" title="${esc(r.harness?.procedures.join(", ") ?? "")}">${esc(METHOD_LABELS[r.config.method ?? "single"].replace(/ \(.*\)$/, ""))}${r.config.method === "search" || r.config.method === "ultramath" ? ' <span class="pill omh">OMH</span>' : ""}<span class="cell-sub">${esc(harnessLabel(r.harness, r.appVersion ?? r.env?.app))}</span></td>
<td class="opt">${thinking(r)}</td>
<td><a href="${root}runs/${esc(r.folder)}.html"><b>${p.solved}/${p.of}</b></a></td>
<td>${rateCell(p.rate, best, i)}<span class="cell-sub">${range(p.low, p.high)}</span></td>
<td class="opt">${p.solved ? usd(spent / p.solved) : "–"}</td>
<td class="opt">${day(r.startedAt)}</td>
</tr>`;
    })
    .join("\n");
  return `<div class="scroll"><table>
<thead><tr>${ranked ? "<th>#</th>" : ""}${withModel ? "<th>Model*</th>" : "<th>Set</th>"}<th class="opt">Method${tip(TIPS.harness)}</th><th class="opt">Thinking${tip(TIPS.thinking)}</th><th>Solved</th><th>Rate · 95% range${tip(TIPS.range)}</th><th class="opt">$ / solve*${tip(TIPS.perSolve)}</th><th class="opt">Date</th></tr></thead>
<tbody>
${body}
</tbody></table></div>`;
}

/** A set's runs grouped by sample size, largest first (the whole set leads): each size its own ranked table, since runs of one size face the same problems. */
function sizeTables(set: (typeof BENCH_SETS)[number], rows: Row[]): string {
  const sizes = [...new Set(rows.map((x) => x.p.of))].sort((a, b) => b - a);
  return sizes
    .map((n) => {
      const group = rows.filter((x) => x.p.of === n);
      const title = n === set.problems.length ? `Whole set · ${n} problems` : `${n} problems`;
      return `<h3 class="size-head">${title} <span class="muted">· ${group.length} run${group.length === 1 ? "" : "s"}</span>${tip(n === set.problems.length ? TIPS.whole : TIPS.quick)}</h3>
${runTable(group, "")}`;
    })
    .join("\n");
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
      return `<div class="panel panel-${i}">
${sizeTables(set, rows)}
${rows.some((x) => x.p.full) ? "" : `<p class="note">No run on the whole set (${set.problems.length} problems) yet.</p>`}
</div>`;
    })
    .join("\n");
  return `<style>${css}</style><div class="tabs">${inputs}\n${panels}</div>`;
}

/** The home page: the leaderboard (a tab per set, a table per sample size), the models when there are several, and the contamination check when it has data. */
export function indexPage(runs: SharedRun[], repo: string): string {
  const scores = runs.map((r) => publishedScore(r));
  const solved = scores.reduce((a, x) => a + x.solved, 0);
  const groups = modelGroups(runs);
  const contamination = contaminationRows(runs);
  const cards = groups
    .map(
      (g, i) => `<a class="mcard" href="models/${esc(g.slug)}.html">
<div class="name">${esc(g.name)}</div>
<div class="big">${pct(g.best.p.rate)}</div>
${bar(g.best.p.rate, i)}
<div class="meta">${esc(setLabel(g.best.r.set))} · ${g.best.p.solved}/${g.best.p.of} · ${g.runs.length} run${g.runs.length === 1 ? "" : "s"}${g.best.p.solved ? ` · ${usd(g.best.usd / g.best.p.solved)}/solve` : ""}</div>
</a>`,
    )
    .join("\n");
  return page(
    "Mack benchmark",
    `<section class="hero compact">
<h1>Proving competition math <em>in Lean</em></h1>
<p class="lead">Open models on miniF2F and PutnamBench, run with Mack. Only proofs Lean verifies count.</p>
<p class="facts"><span><b>${runs.length}</b> run${runs.length === 1 ? "" : "s"}</span><span><b>${groups.length}</b> model setup${groups.length === 1 ? "" : "s"}</span><span><b>${solved}</b> Lean-checked proof${solved === 1 ? "" : "s"}</span></p>
</section>
<section id="leaderboard">
<h2>Leaderboard</h2>
${setTabs(runs) || `<div class="card empty"><b>No runs shared yet</b>Run the Benchmark in Mack and press <b>Share as a PR</b>.</div>`}
<p class="note">${runs.length ? `* self-reported ${tip(TIPS.reported)} · ` : ""}<a href="methodology.html">How runs are made and scored</a></p>
</section>
${groups.length > 1 ? `<section id="models" class="reveal"><h2>Models</h2><div class="cards">${cards}</div></section>` : ""}
${
  contamination
    ? `<section id="recent" class="reveal">
<h2>Recent problems ${tip(TIPS.contamination)}</h2>
<div class="scroll"><table><thead><tr><th>Model*</th><th>Older Putnam</th><th>Recent</th></tr></thead><tbody>
${contamination}
</tbody></table></div>
</section>`
    : ""
}`,
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
    `<p class="crumbs"><a href="../index.html#leaderboard">← Leaderboard</a></p>
<section class="hero compact" style="padding:14px 0 4px">
<h1 style="font-size:30px">${esc(name)}</h1>
<p class="muted">${rows.length} run${rows.length === 1 ? "" : "s"} · ${[...new Set(rows.map((x) => setLabel(x.r.set)))].join(", ")}</p>
</section>
<div class="kpis">
${bestBySet.map((x) => kpi(pct(x.p.rate), `best on ${esc(setLabel(x.r.set))}`, `${x.p.solved}/${x.p.of} · ${range(x.p.low, x.p.high)}`)).join("\n")}
${kpi(`${solved.length}/${all.filter((x) => x.outcome !== "skipped").length}`, "solved, all runs")}
${kpi(solved.length ? usd(spent / solved.length) : "–", "per solve*")}
${kpi(solved.length ? (attempts / solved.length).toFixed(1) : "–", "attempts per solve")}
</div>
<section class="reveal"><h2>Runs</h2>${runTable(rows, "../", false, false)}</section>
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
<h1 style="font-size:30px">${esc(models(r))} · ${esc(setLabel(r.set))}${officialPill(r)}</h1>
<p class="muted">${esc(METHOD_LABELS[c.method ?? "single"])} · thinking ${c.effort ? esc(c.effort) : "auto"} · ${day(r.startedAt)}${r.sharedBy ? ` · by ${esc(r.sharedBy)}` : ""}${r.appVersion ? ` · Mack ${esc(r.appVersion)}` : ""}</p>
</section>
<div class="kpis">
${kpi(`${p.solved}/${p.of}`, `solved${p.full ? ", whole set" : `, ${p.of} of the set`}`)}
${kpi(`<span data-count="${(p.rate * 100).toFixed(1)}" data-dec="1" data-suffix="%">${pct(p.rate)}</span>`, `solve rate${tip(TIPS.range)}`, `95% range ${range(p.low, p.high)}`)}
${kpi(usd(s.usd), "cost*", p.solved ? `${usd(s.usd / p.solved)} per solve` : "")}
${kpi(`${Math.round(s.ms / 60000)} min`, "time*")}
${m.attempts ? kpi(m.attemptsPerSolve !== null ? m.attemptsPerSolve.toFixed(1) : "–", "attempts per solve", `${s.byAutomation} by automation alone`) : ""}
${m.attempts ? kpi(`${tokens(m.promptTokens)} / ${tokens(m.completionTokens)}`, "tokens in / out*") : ""}
</div>
<section class="reveal"><h2>Problems</h2>
<div class="card"><div class="tiles">${tiles}</div>
<div class="legend"><span><i style="background:var(--ok)"></i>solved by a model</span><span><i style="background:color-mix(in srgb, var(--ok) 55%, var(--surface))"></i>solved by automation${tip(TIPS.automation)}</span><span><i style="background:var(--bad)"></i>not solved</span><span><i style="background:var(--bar)"></i>skipped</span><span>Click a square for its deep dive.</span></div></div>
</section>
${timeSection(r)}
<section class="reveal grid2">
${
  p.solved
    ? `<div class="card"><h3>Solved within k attempts${tip(TIPS.within)}</h3>${within.map((w, i) => `<div class="why"><span>within ${w.k} attempt${w.k === 1 ? "" : "s"}</span>${bar(p.of ? w.solved / p.of : 0, i, "okbar")}<span class="muted">${w.solved}</span></div>`).join("\n")}</div>`
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
${r.harness ? `<p class="note">Open Math Harness <b>${esc(r.harness.openMathHarness)}</b> · ${esc(r.harness.procedures.join(", "))}</p>` : ""}
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
  return `<section class="reveal"><h2>Time per problem${tip(TIPS.time)}</h2>
<div class="kpis">
${kpi(dur(q(0.5)), "median")}
${kpi(dur(q(0.9)), "90th percentile")}
${kpi(dur(times[times.length - 1]), "slowest")}
${solved.length ? kpi(dur(avg(solved)), "average when solved") : ""}
${tried.length > solved.length ? kpi(dur(avg(tried.filter((x) => x.outcome !== "solved"))), "average when not solved") : ""}
</div>
<div class="card"><h3>Slowest problems</h3>${slowest
    .map((x, i) => `<div class="why"><span>${hasPage(x) ? `<a href="${esc(r.folder)}/${esc(x.id)}.html">${esc(x.id)}</a>` : esc(x.id)}</span>${bar(x.ms / max, i, x.outcome === "solved" ? "okbar" : "badbar")}<span class="muted">${dur(x.ms)}</span></div>`)
    .join("\n")}</div>
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
  const status = x.outcome === "solved" ? (auto ? `<span class="status auto">Solved by automation</span>${tip(TIPS.automation)}` : '<span class="status ok">Solved</span>') : x.outcome === "skipped" ? '<span class="status">Skipped</span>' : '<span class="status bad">Not solved</span>';
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
    story.push(`Closed by Lean's automation${tactic ? ` (<code>${esc(tactic)}</code>)` : ""} before any model wrote a proof.`);
  } else if (x.outcome === "solved") {
    story.push(`Solved on attempt ${verified?.n ?? x.attempts}${verified?.model ? ` by <b>${esc(short(verified.model))}</b>` : ""}.`);
    if (failedRows.length) story.push(`Earlier attempts failed: ${esc(reasonText)}.`);
    else story.push("The first proof was accepted.");
  } else if (x.outcome === "skipped") {
    story.push(`Not tried: ${esc(x.message ?? "the run stopped or its budget ran out")}.`);
  } else {
    story.push(`Not solved in ${x.attempts} attempt${x.attempts === 1 ? "" : "s"}${reasonText ? `: ${esc(reasonText)}` : ""}.${x.failure ? tip(`What would help: ${FAILURES[x.failure].fix}.`) : ""}`);
  }
  if (repeated) story.push(`<span class="muted">${repeated} repeated an earlier error.</span>`);

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
${timebar}</div></section>
${source ? `<section><h2>The problem</h2><pre class="code">${esc(source.trim())}</pre></section>` : ""}
${rows.length ? `<section><h2>Attempts</h2><div class="attempts">${attempts}</div></section>` : ""}
${
  x.timeline?.length
    ? `<section><h2>Every step</h2><div class="card"><ol class="steps-list">${x.timeline.map((t) => `<li><span class="t">${clock(t.t)}</span>${esc(t.message)}</li>`).join("")}</ol></div></section>`
    : ""
}
${x.proof ? `<section><h2>The verified proof${tip(TIPS.verified)}</h2><pre class="code">${esc(x.proof)}</pre></section>` : ""}
${SELF_REPORTED}
<p class="small"><a href="${esc(repo)}/blob/main/benchmarks/runs/${esc(r.folder)}/attempts.jsonl">attempts.jsonl</a></p>`,
    "../../",
    repo,
  );
}

/** Whether a problem has a deep-dive page: it has attempts, steps or a proof to show. */
/** The methods, how each works, and where it comes from: the methodology page's table. */
const METHODS: { label: string; from: string; how: string }[] = [
  { label: METHOD_LABELS.single, from: "Mack", how: "The model writes a whole Lean proof; Lean checks it; the errors go back and the model revises. Several chains can run at once, and a chain starts over from a clean conversation after a set number of revisions." },
  { label: METHOD_LABELS.decompose, from: "Mack", how: "Attempts first. If they fail, a planning model splits the statement into lemmas; each lemma is proved like a problem of its own (and split again, to a set depth), then the pieces are put back together and the whole proof is verified." },
  { label: METHOD_LABELS.steps, from: "Mack", how: "The proof is built one tactic at a time on Lean's live proof states (the REPL). Only steps Lean accepts are kept; the most promising state (fewest, smallest goals) is extended next." },
  { label: METHOD_LABELS.search, from: "Open Math Harness", how: "A tree of partial proofs. Workers continue chosen nodes; the harness scores each child with Lean (scoring v3: only steps Lean closes count) and picks the next nodes. Limits: workers per round, rounds, fan-out, calls per worker, a model-call budget." },
  { label: METHOD_LABELS.ultramath, from: "Open Math Harness", how: "Several agents attack one problem, each on a direction registered on a shared board; duplicates are refused, and abandoned directions are posted with a reason. Limits: members, rounds, a model-call budget." },
];

/** What a run may turn on, and what each changes. */
const PROCEDURES: { name: string; when: string; what: string }[] = [
  { name: "Strict verifier", when: "always", what: "The acceptance check below. Ported from Open Math Harness." },
  { name: "Linters off", when: "always", what: "Lean's style warnings are not errors and are not shown to the model." },
  { name: "Dead-tactic repair", when: "attempts, decompose", what: "A tactic after the goal is already closed is removed instead of costing an attempt." },
  { name: "Name repair", when: "attempts, decompose", what: "A lemma name Mathlib does not have is replaced when exactly one real name fits." },
  { name: "Automation sweep", when: "if on", what: "rfl, decide, omega, norm_num, simp, linarith, nlinarith, positivity, ring, aesop, grind… tried before any model call and on every gap a proof leaves." },
  { name: "Premise selection", when: "if on", what: "The Mathlib theorems the statement most likely needs are given with the problem." },
  { name: "Easier versions first", when: "if on", what: "Special cases and the key lemma are proved first and offered to every attempt." },
  { name: "Lemma pool", when: "if on", what: "Helper lemmas from problems already solved in the same run are offered to later ones. Never shared between runs." },
  { name: "Prover model", when: "if set", what: "A model trained for Lean writes the attempts; the main model plans. Several make an ensemble." },
  { name: "Thinking level", when: "if set", what: "The reasoning effort asked of the models; otherwise each model's default." },
];

/** The full methodology: what is measured, on what, how, and what can and cannot be checked. */
export function methodologyPage(repo: string): string {
  const sets = BENCH_SETS.map(
    (set) => `<tr><td><b>${esc(set.label)}</b></td><td>${set.problems.length}</td><td class="wrap">${esc(set.blurb)}</td></tr>`,
  ).join("\n");
  const methods = METHODS.map((m) => `<tr><td><b>${esc(m.label.replace(/ \(.*\)$/, ""))}</b></td><td>${m.from === "Mack" ? '<span class="pill">Mack</span>' : '<span class="pill omh">Open Math Harness</span>'}</td><td class="wrap">${esc(m.how)}</td></tr>`).join("\n");
  const procedures = PROCEDURES.map((x) => `<tr><td><b>${esc(x.name)}</b></td><td class="muted">${esc(x.when)}</td><td class="wrap">${esc(x.what)}</td></tr>`).join("\n");
  const failures = Object.values(FAILURES)
    .map((f) => {
      const text = f === FAILURES.other ? "Any other Lean error: the problem page shows the last one." : f.fix[0].toUpperCase() + f.fix.slice(1) + ".";
      return `<tr><td><b>${esc(f.label)}</b></td><td class="wrap">${esc(text)}</td></tr>`;
    })
    .join("\n");
  const toc = [
    ["solved", "What counts as solved"],
    ["sets", "Problem sets"],
    ["sample", "Which problems"],
    ["methods", "Methods"],
    ["procedures", "Procedures"],
    ["limits", "Limits and budgets"],
    ["time", "Time and cost"],
    ["scoring", "Scoring"],
    ["failures", "Why problems fail"],
    ["checks", "What is checked"],
  ]
    .map(([id, t]) => `<a class="pill" href="#${id}">${t}</a>`)
    .join(" ");
  return page(
    "Methodology · Mack benchmark",
    `<section class="hero compact">
<h1>Methodology</h1>
<p class="lead">How every run on this site is made and scored.</p>
<p class="toc">${toc}</p>
</section>
<section id="solved">
<h2>What counts as solved</h2>
<p class="sub">Lean decides, never the model. A proof is accepted only when all of these hold:</p>
<ul class="bullets">
<li>The theorem statement and the file's preamble are unchanged, character for character.</li>
<li>Lean elaborates the file with no error.</li>
<li>No <code>sorry</code>, and no axioms beyond Lean's three standard ones (<code>propext</code>, <code>Classical.choice</code>, <code>Quot.sound</code>).</li>
<li>The proved theorem's fully elaborated type is identical to the original statement's.</li>
<li>No forbidden shortcuts (new axioms, <code>native_decide</code>, editing the statement).</li>
</ul>
<p class="note">Lean's report is read only after a random per-run marker, so text a proof prints cannot fake a pass.</p>
</section>
<section id="sets">
<h2>Problem sets</h2>
<div class="scroll"><table class="stack"><thead><tr><th>Set</th><th>Problems</th><th>What it is</th></tr></thead><tbody>
${sets}
</tbody></table></div>
<p class="note">miniF2F (MIT) and PutnamBench (Apache-2.0) statements, as formalized upstream. Rates on different sets are not comparable.</p>
</section>
<section id="sample">
<h2>Which problems</h2>
<ul class="bullets">
<li><b>Fixed order.</b> Each set has one fixed pseudo-random order; a run of n problems takes the first n. Two runs of the same size always face the same problems, and 20 is part of 50.</li>
<li><b>Ranked by size.</b> Each set's leaderboard has one table per sample size, the whole set first. Runs in a table faced the same problems and are ranked against each other; rates from different sizes are not compared, since a sample can be easier or harder than the set.</li>
<li><b>Skipped counts as unsolved.</b> If a run stops or spends its budget, the problems left still count, so stopping early cannot raise a score.</li>
</ul>
</section>
<section id="methods">
<h2>Methods</h2>
<div class="scroll"><table class="stack"><thead><tr><th>Method</th><th>From</th><th>How it works</th></tr></thead><tbody>
${methods}
</tbody></table></div>
<p class="note">Each run lists its harness: Mack's version, the Open Math Harness commit it follows and the procedures used. Runs from different harnesses are not the same experiment.</p>
</section>
<section id="procedures">
<h2>Procedures</h2>
<div class="scroll"><table class="stack"><thead><tr><th>Procedure</th><th>Used</th><th>What it does</th></tr></thead><tbody>
${procedures}
</tbody></table></div>
</section>
<section id="limits">
<h2>Limits and budgets</h2>
<div class="scroll"><table class="stack"><thead><tr><th>Limit</th><th>What it bounds</th></tr></thead><tbody>
<tr><td><b>Attempts per problem</b></td><td class="wrap">Model calls that write a proof, across all chains. Automation does not count.</td></tr>
<tr><td><b>Attempts at once</b></td><td class="wrap">Parallel chains sharing that budget; the first verified proof stops the others.</td></tr>
<tr><td><b>Lean deadline</b></td><td class="wrap">Per check (600 s by default). A slower check is a failed attempt, never a pass.</td></tr>
<tr><td><b>Run budget</b></td><td class="wrap">USD the whole run may spend; when it is spent the remaining problems are skipped.</td></tr>
<tr><td><b>Search and swarm limits</b></td><td class="wrap">Rounds, workers, fan-out or members, and a model-call budget per problem.</td></tr>
</tbody></table></div>
</section>
<section id="time">
<h2>Time and cost</h2>
<ul class="bullets">
<li><b>Time</b> is wall-clock per problem: model calls, Lean checks and automation together. It depends on the provider's speed, the computer and how many Lean processes run at once, so compare it within a run more than across runs.</li>
<li><b>Time to first proof</b> on a problem page is when the verified proof arrived; the time bar shows each attempt.</li>
<li><b>Cost</b> is tokens times the model's price, as the run counted it. <b>Per solve</b> is the run's whole cost divided by problems solved.</li>
<li><b>Tokens</b> are what the provider reported. Each problem page keeps up to ${LOG_LIMITS.attempts} attempts, each with Lean's feedback.</li>
</ul>
</section>
<section id="scoring">
<h2>Scoring</h2>
<div class="scroll"><table class="stack"><thead><tr><th>Measure</th><th>Definition</th></tr></thead><tbody>
<tr><td><b>Solve rate</b></td><td class="wrap">Problems solved out of the whole sample (skipped included).</td></tr>
<tr><td><b>Range</b></td><td class="wrap">95% Wilson interval of the rate. 13 of 20 is 43–82%; two runs differ only when their ranges barely overlap.</td></tr>
<tr><td><b>Solved within k</b></td><td class="wrap">Problems solved within ${WITHIN.join(", ")} model attempts. Like pass@k, but Mack's attempts learn from Lean's errors, where pass@k samples independently.</td></tr>
<tr><td><b>By automation</b></td><td class="wrap">Solved by Lean's own tactics before any model wrote a proof (0 attempts). A floor every model starts from.</td></tr>
<tr><td><b>Attempts per solve</b></td><td class="wrap">Average attempts the solved problems took.</td></tr>
<tr><td><b>Contamination check</b></td><td class="wrap">Recent Putnam (${RECENT_YEARS.join(", ")}) against older Putnam. Much weaker on recent problems suggests memory helped on older ones.</td></tr>
</tbody></table></div>
</section>
<section id="failures">
<h2>Why problems fail</h2>
<p class="sub">Each failed attempt is labelled from Lean's errors; a problem's reason is its most common label.</p>
<div class="scroll"><table class="stack"><thead><tr><th>Label</th><th>Meaning, and what would help</th></tr></thead><tbody>
${failures}
</tbody></table></div>
</section>
<section id="checks">
<h2>What is checked</h2>
<div class="grid2">
<div class="card"><h3>Checked by CI on every shared run</h3><ul class="bullets">
<li>Every solved proof is re-verified with Lean and the strict verifier, against the same Mathlib.</li>
<li>The sample is exactly the fixed problems for its size, each with one result.</li>
<li>A run that fails either is not merged.</li>
</ul></div>
<div class="card"><h3>Official runs</h3><ul class="bullets">
<li>Made by the Mack repo's own workflow on one fixed cloud machine (GitHub Actions, 4 CPUs, 16 GB), linked from their badge.</li>
<li>Only those time and cost figures compare across models; community runs ran on their sharers' computers.</li>
<li>CI refuses the official mark on a pull request from a fork.</li>
</ul></div>
<div class="card"><h3>Self-reported</h3><ul class="bullets">
<li>Model names, thinking level, cost, time and tokens.</li>
<li>Failed problems: a failure cannot be re-run for free, so its attempts are shown as logged.</li>
</ul></div>
</div>
<p class="note">Source: <a href="${esc(repo)}/tree/main/core/bench">core/bench</a> and <a href="${esc(repo)}/blob/main/core/lean/verify.ts">the verifier</a>.</p>
</section>`,
    "",
    repo,
  );
}

const hasPage = (x: BenchResult) => !!(x.log?.length || x.timeline?.length || x.proof);

/** Every page of the site, by path. */
export function buildSite(runs: SharedRun[], repo: string): Record<string, string> {
  const files: Record<string, string> = { "index.html": indexPage(runs, repo), "methodology.html": methodologyPage(repo) };
  for (const slug of new Set(runs.map((r) => modelSlug(r)))) files[`models/${slug}.html`] = modelPage(slug, runs, repo);
  for (const r of runs) {
    files[`runs/${r.folder}.html`] = runPage(r, repo);
    const set = BENCH_SETS.find((s) => s.id === r.set);
    for (const x of r.results) if (hasPage(x)) files[`runs/${r.folder}/${x.id}.html`] = problemPage(r, x, set?.problems.find((p) => p.id === x.id)?.source, repo);
  }
  return files;
}
