// "Show me": a guided tour of a whole proof, one step at a time. Each step has
// plain words, what is still left to show, a worked example, a picture, and
// the proof lines it covers. The tour is written once by the model and kept
// in the problem folder, with every earlier version, so it can be reviewed
// again later; Lean checked the proof, not these words.

import { ArrowLeft, ArrowRight, BookOpenCheck, History, MessagesSquare, RefreshCw, ShieldCheck, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type MapNode, type ProblemOutline, type SavedWalkthrough, type StoredWalkthrough, type Visual } from "../api";
import { Button, timeAgo } from "./ui";

/** `savedId` opens one kept walkthrough (see `api.showmeList`) as it was written, instead of the current one. */
export function ShowMe({ projectId, file, savedId, onClose, onAsk }: { projectId: string; file: string; savedId?: string; onClose: () => void; onAsk?: (text: string) => void }) {
  const [data, setData] = useState<StoredWalkthrough | null>(null);
  // Every kept walkthrough of this proof, newest first, to switch between.
  const [versions, setVersions] = useState<SavedWalkthrough[]>([]);
  const refreshVersions = () =>
    api
      .showmeList(projectId)
      .then((all) => setVersions(all.filter((w) => w.file === file)))
      .catch(() => setVersions([]));
  const [meta, setMeta] = useState<{ theorem?: string; summary?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // -1 is the overview; then one index per step; steps.length is the end.
  const [at, setAt] = useState(-1);

  const make = async () => {
    setBusy(true);
    setError(null);
    try {
      setData(await api.showmeMake(projectId, file));
      setAt(-1);
      void refreshVersions();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const openVersion = (id: string) => {
    setError(null);
    api
      .showmeOpen(projectId, id)
      .then((w) => {
        setData(w);
        setAt(-1);
      })
      .catch((e: Error) => setError(e.message));
  };

  useEffect(() => {
    let live = true;
    void refreshVersions();
    api
      .showmeGet(projectId, file)
      .then((r) => {
        if (!live) return;
        setMeta({ theorem: r.theorem, summary: r.summary });
        if (savedId) openVersion(savedId);
        else if (r.saved) setData(r.saved);
        else void make();
      })
      .catch((e: Error) => {
        if (!live) return;
        // The proof may be gone, but a kept walkthrough can still be read.
        if (savedId) openVersion(savedId);
        else setError(e.message);
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, file, savedId]);

  const steps = data?.walkthrough.steps ?? [];
  const go = (i: number) => setAt(Math.max(-1, Math.min(steps.length, i)));

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") go(at + 1);
      else if (e.key === "ArrowLeft") go(at - 1);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  const whole = file === "*";
  const theorem = whole ? "the whole proof" : (data?.theorem ?? meta?.theorem ?? file);
  const step = at >= 0 && at < steps.length ? steps[at] : undefined;
  const map = data?.walkthrough.map;
  const nameOf = (f?: string) => (f ? (map?.find((m) => m.file === f)?.title ?? f.split("/").pop()) : undefined);
  const proofOf = (f?: string) => (f && data?.proofs?.[f]) || data?.proof || "";
  const shown = versions.find((v) => v.createdAt === data?.createdAt);

  return (
    <div className="path-overlay" role="dialog" aria-modal="true" aria-label={`Show me how ${theorem} is proved`} onClick={onClose}>
      <div className="path-card showme-card" onClick={(e) => e.stopPropagation()}>
        <div className="path-head">
          <BookOpenCheck size={16} className="accent" />
          <div className="path-head-text">
            <div className="path-title">
              Show me: {whole ? theorem : <code>{theorem}</code>}
            </div>
            {meta?.summary && <div className="muted small">{meta.summary}</div>}
          </div>
          <button className="icon-btn" title="Close (Esc)" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        {error && (
          <div className="bad small">
            {error}{" "}
            <button className="link small" onClick={() => void make()}>
              Try again
            </button>
          </div>
        )}
        {busy && (
          <div className="showme-wait">
            <RefreshCw size={16} className="spin" />
            <div>
              <div>{whole ? "Writing one walkthrough that connects every proved result…" : "Writing a step-by-step walkthrough of this proof…"}</div>
              <div className="muted small">It uses your chat model once, about the cost of one long reply. It is saved in this problem's folder, so opening it again is instant.</div>
            </div>
          </div>
        )}

        {data && !busy && (
          <>
            <div className="showme-progress" role="tablist" aria-label="Steps">
              <button role="tab" aria-selected={at === -1} className={`showme-dot ${at === -1 ? "on" : ""}`} onClick={() => go(-1)} title="The idea">
                Idea
              </button>
              {steps.map((s, i) => (
                <button key={i} role="tab" aria-selected={at === i} className={`showme-dot ${at === i ? "on" : ""} ${at > i ? "past" : ""} ${whole && i > 0 && s.file !== steps[i - 1].file ? "part" : ""}`} onClick={() => go(i)} title={whole && s.file ? `${nameOf(s.file)}: ${s.title}` : s.title}>
                  {i + 1}
                </button>
              ))}
              <button role="tab" aria-selected={at === steps.length} className={`showme-dot ${at === steps.length ? "on" : ""}`} onClick={() => go(steps.length)} title="Done">
                <ShieldCheck size={11} />
              </button>
            </div>

            <div className="showme-body">
              {at === -1 && (
                <div className="showme-intro">
                  {data.walkthrough.problem && <ProblemCard problem={data.walkthrough.problem} />}
                  <div className="plan-detail-label">The idea</div>
                  <p className="showme-lead">{data.walkthrough.idea}</p>
                  <p className="muted small">
                    {steps.length} steps cover {whole ? "every proved result, in the order they build on each other" : "the whole proof"}. Use the arrows (or ← →) to go through them; each shows the proof lines it is about, what is left to prove, an example and a picture.
                  </p>
                  {whole ? map && map.length > 0 && <ProofMap map={map} onPick={(f) => go(steps.findIndex((s) => s.file === f))} /> : <ProofLines proof={data.proof} />}
                </div>
              )}

              {step && (
                <div className="showme-step">
                  <div className="showme-visual">
                    <VisualView v={step.visual} />
                    {step.example && (
                      <div className="showme-example">
                        <div className="plan-detail-label">Example</div>
                        {step.example}
                      </div>
                    )}
                  </div>
                  <div className="showme-text">
                    <div className="showme-step-n muted small">
                      Step {at + 1} of {steps.length}
                      {whole && step.file && (
                        <>
                          {" · "}
                          <span className={`showme-part ${at === 0 || steps[at - 1].file !== step.file ? "new" : ""}`}>
                            {at === 0 || steps[at - 1].file !== step.file ? "Now: " : ""}
                            {nameOf(step.file)} <code>{step.file.split("/").pop()}</code>
                          </span>
                        </>
                      )}
                    </div>
                    <h2 className="showme-step-title">{step.title}</h2>
                    <p>{step.explain}</p>
                    {step.goal && (
                      <div className="showme-goal">
                        <div className="plan-detail-label">Still to show</div>
                        {step.goal}
                      </div>
                    )}
                    {(!whole || step.file) && <ProofLines proof={proofOf(step.file)} lines={step.lines} />}
                  </div>
                </div>
              )}

              {at === steps.length && (
                <div className="showme-intro">
                  <div className="showme-done">
                    <ShieldCheck size={18} className="ok" /> That is the whole proof, and Lean accepted every line of it.
                  </div>
                  {data.walkthrough.takeaway && <p className="showme-lead">{data.walkthrough.takeaway}</p>}
                  <div className="row gap-sm">
                    {onAsk && (
                      <Button icon={MessagesSquare} onClick={() => (onAsk(`I went through the walkthrough of ${theorem} (${file}). Help me understand it better: `), onClose())}>
                        Ask about it in the chat
                      </Button>
                    )}
                    <Button variant="ghost" onClick={() => go(0)}>
                      Start over
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <div className="path-foot showme-foot">
              <Button variant="ghost" icon={ArrowLeft} disabled={at === -1} onClick={() => go(at - 1)}>
                Back
              </Button>
              <Button variant="primary" icon={ArrowRight} disabled={at === steps.length} onClick={() => go(at + 1)}>
                {at === -1 ? "Start" : at === steps.length - 1 ? "Finish" : "Next"}
              </Button>
              {versions.length > 1 && (
                <label className="showme-versions muted small" title="Every walkthrough written for this proof is kept in the problem folder; pick one to review it again">
                  <History size={12} />
                  <select value={shown?.id ?? ""} onChange={(e) => openVersion(e.target.value)}>
                    {!shown && <option value="">This one</option>}
                    {versions.map((v) => (
                      <option key={v.id} value={v.id}>
                        {new Date(v.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })} · {v.model.split("/").pop()}
                        {v.current ? "" : " · earlier proof"}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <span className="muted small showme-note">
                {shown && !shown.current && <span className="warn">This explains an earlier version of the proof. </span>}
                Written by {data.model.split("/").pop()} {timeAgo(data.createdAt)}. Lean checked the proof, not this explanation.{" "}
                <button className="link small" title="Write a new walkthrough (uses the model again)" onClick={() => void make()}>
                  Rewrite
                </button>
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** The problem, set out before the proof: what it is about, exactly what is proved, and what it relates to. */
function ProblemCard({ problem }: { problem: ProblemOutline }) {
  return (
    <section className="showme-problem" aria-label="The problem">
      <div className="plan-detail-label">The problem</div>
      {problem.title && <h2>{problem.title}</h2>}
      {problem.about && <p>{problem.about}</p>}
      {problem.defined && (
        <div className="showme-defined">
          <div className="plan-detail-label">Exactly what is proved</div>
          {problem.defined}
        </div>
      )}
      {problem.relates.length > 0 && (
        <div className="showme-relates small">
          <span className="muted" style={{ border: "none", padding: 0 }}>Related to:</span>
          {problem.relates.map((r) => (
            <span key={r}>{r}</span>
          ))}
        </div>
      )}
    </section>
  );
}

/** How the proved results fit together: each result after the ones it uses, all leading to the question. Click one to jump to it. */
function ProofMap({ map, onPick }: { map: MapNode[]; onPick: (file: string) => void }) {
  const files = new Set(map.map((m) => m.file));
  const depth = new Map<string, number>();
  const depthOf = (f: string, seen: Set<string> = new Set()): number => {
    if (depth.has(f)) return depth.get(f)!;
    if (seen.has(f)) return 0;
    seen.add(f);
    const node = map.find((m) => m.file === f);
    const d = node && node.uses.length ? 1 + Math.max(...node.uses.filter((u) => files.has(u)).map((u) => depthOf(u, seen)), -1) : 0;
    depth.set(f, d);
    return d;
  };
  map.forEach((m) => depthOf(m.file));
  const cols = Math.max(...depth.values()) + 2; // One more column for the question.
  const byCol: MapNode[][] = Array.from({ length: cols - 1 }, () => []);
  map.forEach((m) => byCol[depth.get(m.file)!].push(m));
  const W = 170;
  const H = 58;
  const gx = 60;
  const gy = 18;
  const rows = Math.max(1, ...byCol.map((c) => c.length));
  const width = cols * W + (cols - 1) * gx;
  const height = rows * H + (rows - 1) * gy;
  const pos = new Map<string, { x: number; y: number }>();
  byCol.forEach((col, c) => col.forEach((m, r) => pos.set(m.file, { x: c * (W + gx), y: (height - (col.length * H + (col.length - 1) * gy)) / 2 + r * (H + gy) })));
  const used = new Set(map.flatMap((m) => m.uses));
  const ends = map.filter((m) => !used.has(m.file));
  const q = { x: (cols - 1) * (W + gx), y: height / 2 - H / 2 };
  const edge = (a: { x: number; y: number }, b: { x: number; y: number }, key: string, cls = "") => {
    const x1 = a.x + W;
    const y1 = a.y + H / 2;
    const x2 = b.x;
    const y2 = b.y + H / 2;
    const mx = (x1 + x2) / 2;
    return <path key={key} d={`M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2 - 4} ${y2}`} className={`map-edge ${cls}`} markerEnd="url(#map-head)" />;
  };
  return (
    <div className="showme-map">
      <div className="plan-detail-label">How the pieces fit</div>
      <svg viewBox={`-6 -6 ${width + 12} ${height + 12}`} className="showme-svg" style={{ maxWidth: width + 12 }} role="img" aria-label="Map of the proved results">
        <defs>
          <marker id="map-head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0 0 L10 5 L0 10 z" className="viz-head" />
          </marker>
        </defs>
        {map.flatMap((m) => m.uses.filter((u) => pos.has(u)).map((u) => edge(pos.get(u)!, pos.get(m.file)!, `${u}>${m.file}`)))}
        {ends.map((m) => edge(pos.get(m.file)!, q, `${m.file}>q`, "to-q"))}
        {map.map((m) => {
          const p = pos.get(m.file)!;
          return (
            <g key={m.file} className="map-node" tabIndex={0} role="button" onClick={() => onPick(m.file)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onPick(m.file)}>
              <title>{m.role}</title>
              <rect x={p.x} y={p.y} width={W} height={H} rx={9} />
              <text x={p.x + 10} y={p.y + 22} className="map-title">
                {m.title.length > 22 ? `${m.title.slice(0, 21)}…` : m.title}
              </text>
              <text x={p.x + 10} y={p.y + 40} className="viz-label">
                {m.file.split("/").pop()} ✓
              </text>
            </g>
          );
        })}
        <g className="map-node map-q">
          <rect x={q.x} y={q.y} width={W} height={H} rx={9} />
          <text x={q.x + 10} y={q.y + 34} className="map-title">
            Your question
          </text>
        </g>
      </svg>
      <ul className="showme-roles small">
        {map.map((m) => (
          <li key={m.file}>
            <button className="link small" onClick={() => onPick(m.file)}>
              {m.title}
            </button>
            : {m.role}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The proof with line numbers, the step's lines marked and scrolled into view. */
function ProofLines({ proof, lines }: { proof: string; lines?: [number, number] }) {
  const ref = useRef<HTMLPreElement>(null);
  const all = useMemo(() => proof.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n"), [proof]);
  useEffect(() => {
    if (!lines) return;
    ref.current?.querySelector<HTMLElement>(`[data-line="${lines[0]}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [lines?.[0], lines?.[1]]);
  return (
    <pre className="showme-proof" ref={ref}>
      {all.map((l, i) => {
        const n = i + 1;
        const on = lines && n >= lines[0] && n <= lines[1];
        return (
          <div key={i} data-line={n} className={on ? "on" : lines ? "dim" : ""}>
            <span className="showme-ln">{n}</span>
            {l || " "}
          </div>
        );
      })}
    </pre>
  );
}

/** A clock for the pictures that move: one tick every `ms`, paused when the person prefers less motion. */
function useTick(ms: number, active: boolean): number {
  const [t, setT] = useState(0);
  useEffect(() => {
    setT(0);
    if (!active || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setT((x) => x + 1), ms);
    return () => clearInterval(id);
  }, [ms, active]);
  return t;
}

function VisualView({ v }: { v: Visual }) {
  return (
    <figure className="showme-figure">
      {v.type === "grid" && <GridVisual n={v.n} k={v.k} />}
      {v.type === "bars" && <BarsVisual values={v.values} labels={v.labels} highlight={v.highlight} />}
      {v.type === "equation" && <EquationVisual before={v.before} after={v.after} />}
      {v.type === "induction" && <InductionVisual upTo={v.upTo} base={v.base} step={v.step} />}
      {v.type === "table" && (
        <table className="showme-table">
          <thead>
            <tr>
              {v.columns.map((c, i) => (
                <th key={i}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {v.rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {v.type === "none" && <div className="showme-novisual muted small">No picture for this step.</div>}
      {"caption" in v && v.caption && <figcaption className="muted small">{v.caption}</figcaption>}
    </figure>
  );
}

/** An n×n grid; with k, a k×k square moves through every place it can sit, and each place it has been is marked. */
function GridVisual({ n, k }: { n: number; k?: number }) {
  const size = 240;
  const c = size / n;
  const per = k ? n - k + 1 : 0;
  const places = per * per;
  const t = useTick(700, !!k);
  const shown = k ? t % (places + 2) : 0; // A short pause on the full count before it starts again.
  const cur = k ? Math.min(shown, places - 1) : 0;
  const [cx, cy] = [cur % Math.max(per, 1), Math.floor(cur / Math.max(per, 1))];
  return (
    <div>
      <svg viewBox={`-4 -4 ${size + 8} ${size + 8}`} className="showme-svg" role="img" aria-label={k ? `${n} by ${n} grid: ${places} places for a ${k} by ${k} square` : `${n} by ${n} grid`}>
        {Array.from({ length: n * n }, (_, i) => (
          <rect key={i} x={(i % n) * c} y={Math.floor(i / n) * c} width={c} height={c} className="viz-cell" />
        ))}
        {k &&
          Array.from({ length: Math.min(shown + 1, places) }, (_, i) => (
            <circle key={i} cx={(i % per) * c + c / 2} cy={Math.floor(i / per) * c + c / 2} r={Math.max(2.5, c / 7)} className="viz-dot" />
          ))}
        {k && <rect x={cx * c} y={cy * c} width={k * c} height={k * c} className="viz-square" />}
      </svg>
      {k && (
        <div className="showme-count">
          A {k}×{k} square fits in {per} × {per} = <b>{places}</b> places{shown >= places ? "" : ` (showing ${Math.min(shown + 1, places)})`}
        </div>
      )}
    </div>
  );
}

function BarsVisual({ values, labels, highlight }: { values: number[]; labels?: string[]; highlight?: number[] }) {
  const w = 300;
  const h = 170;
  const max = Math.max(1, ...values.map((x) => Math.abs(x)));
  const bw = w / values.length;
  const total = values.reduce((a, b) => a + b, 0);
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h + 34}`} className="showme-svg" role="img" aria-label={`bars ${values.join(", ")}, total ${total}`}>
        {values.map((x, i) => {
          const bh = (Math.abs(x) / max) * h;
          const on = highlight?.includes(i);
          return (
            <g key={i}>
              <rect x={i * bw + bw * 0.15} y={h - bh} width={bw * 0.7} height={Math.max(bh, 1)} rx={3} className={on ? "viz-bar on" : "viz-bar"} />
              <text x={i * bw + bw / 2} y={h - bh - 4} textAnchor="middle" className="viz-num">
                {x}
              </text>
              <text x={i * bw + bw / 2} y={h + 16} textAnchor="middle" className="viz-label">
                {labels?.[i] ?? i + 1}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="showme-count">
        Total: <b>{values.join(" + ")}</b> = <b>{total}</b>
      </div>
    </div>
  );
}

/** The before and after of a rewrite, with the part that changed marked. */
function EquationVisual({ before, after }: { before: string; after: string }) {
  let p = 0;
  while (p < before.length && p < after.length && before[p] === after[p]) p++;
  let s = 0;
  while (s < before.length - p && s < after.length - p && before[before.length - 1 - s] === after[after.length - 1 - s]) s++;
  const part = (t: string) => (
    <>
      {t.slice(0, p)}
      <mark>{t.slice(p, t.length - s)}</mark>
      {t.slice(t.length - s)}
    </>
  );
  return (
    <div className="showme-eq">
      <div className="showme-eq-box">{part(before)}</div>
      <div className="showme-eq-arrow" aria-hidden>
        ↓
      </div>
      <div className="showme-eq-box after">{part(after)}</div>
    </div>
  );
}

/** Cases 0 … upTo as a chain: the base case lights first, then each case lights the next. */
function InductionVisual({ upTo, base, step }: { upTo: number; base?: string; step?: string }) {
  const t = useTick(800, true);
  const lit = t % (upTo + 3);
  const w = 300;
  const gap = w / (upTo + 1);
  return (
    <div>
      <svg viewBox={`0 0 ${w} 90`} className="showme-svg" role="img" aria-label={`induction from 0 to ${upTo}`}>
        {Array.from({ length: upTo + 1 }, (_, i) => {
          const x = gap * i + gap / 2;
          return (
            <g key={i}>
              {i < upTo && <line x1={x + 13} y1={40} x2={x + gap - 13} y2={40} className={lit > i ? "viz-arrow on" : "viz-arrow"} markerEnd="url(#viz-head)" />}
              <circle cx={x} cy={40} r={12} className={lit >= i ? (i === 0 ? "viz-case base" : "viz-case on") : "viz-case"} />
              <text x={x} y={44} textAnchor="middle" className="viz-num">
                {i}
              </text>
            </g>
          );
        })}
        <defs>
          <marker id="viz-head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0 0 L10 5 L0 10 z" className="viz-head" />
          </marker>
        </defs>
        <text x={gap / 2} y={74} textAnchor="middle" className="viz-label">
          base
        </text>
      </svg>
      <div className="showme-ind">
        {base && (
          <div>
            <b>Base case:</b> {base}
          </div>
        )}
        {step && (
          <div>
            <b>Step:</b> {step}
          </div>
        )}
      </div>
    </div>
  );
}
