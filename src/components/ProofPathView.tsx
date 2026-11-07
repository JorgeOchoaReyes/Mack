// How a proof was reached, drawn as a path: each write, Lean check and
// verifier verdict is a stop on the line, coloured by what Lean said. Click a
// stop to read what was written or what Lean answered.

import { FileCode, History, Network, ShieldCheck, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, type PathStep, type Proved, type ProofPath } from "../api";
import { CodeEditor } from "./CodeEditor";
import { timeAgo } from "./ui";

const ROW = 56;
const X0 = 22;

function tone(s: PathStep): "ok" | "bad" | "write" {
  return s.ok === true ? "ok" : s.ok === false ? "bad" : "write";
}

export function ProofPathView({ projectId, proved, onClose, onOpenInProve, onOpenRun }: { projectId: string; proved: Proved; onClose: () => void; onOpenInProve?: (path: string) => void; onOpenRun?: (id: string) => void }) {
  const [path, setPath] = useState<ProofPath | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    api
      .getProofPath(projectId, proved.file)
      .then((p) => {
        if (!live) return;
        setPath(p);
        // Open on the stop that settled it: the last accepted verdict, else the last stop.
        const last = p.steps.map((s) => s.kind === "verify" && s.ok).lastIndexOf(true);
        setSel(last >= 0 ? last : p.steps.length ? p.steps.length - 1 : null);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [projectId, proved.file]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  const steps = path?.steps ?? [];
  const counts = useMemo(
    () => ({
      drafts: steps.filter((s) => s.kind === "draft").length,
      rejected: steps.filter((s) => s.kind === "verify" && s.ok === false).length,
      failedChecks: steps.filter((s) => s.kind === "check" && s.ok === false).length,
    }),
    [steps],
  );
  const step = sel !== null ? steps[sel] : undefined;
  const height = Math.max(ROW, steps.length * ROW);

  return (
    <div className="path-overlay" role="dialog" aria-modal="true" aria-label={`How ${proved.theorem ?? proved.file} was proved`} onClick={onClose}>
      <div className="path-card" onClick={(e) => e.stopPropagation()}>
        <div className="path-head">
          <ShieldCheck size={16} className="ok" />
          <div className="path-head-text">
            <div className="path-title">
              How <code>{proved.theorem ?? proved.file}</code> was proved
            </div>
            {proved.summary && <div className="muted small">{proved.summary}</div>}
          </div>
          <button className="icon-btn" title="Close (Esc)" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        {proved.how === "proof_run" && (
          <div className="path-run">
            <Network size={14} />
            <span>
              A proof run found this proof{proved.proof ? ` (run ${proved.proof})` : ""}. Its whole search, every attempt and branch, is on the Proof attempts screen.
            </span>
            {proved.proof && onOpenRun && (
              <button className="link small" onClick={() => onOpenRun(proved.proof!)}>
                <History size={12} /> Show the search
              </button>
            )}
          </div>
        )}

        {error && <div className="bad small">{error}</div>}
        {path && !steps.length && proved.how !== "proof_run" && <div className="muted small">The chats that proved this are gone, so the path cannot be shown.</div>}

        {steps.length > 0 && (
          <>
            <div className="path-sum muted small">
              {counts.drafts} proof attempt{counts.drafts === 1 ? "" : "s"}
              {counts.failedChecks ? ` · ${counts.failedChecks} failed Lean check${counts.failedChecks === 1 ? "" : "s"}` : ""}
              {counts.rejected ? ` · rejected ${counts.rejected} time${counts.rejected === 1 ? "" : "s"} by the verifier` : ""}{steps.some((s) => s.kind === "verify" && s.ok) ? " · then accepted" : ""}
            </div>
            <div className="path-body">
              <div className="path-line">
                <svg width="100%" height={height} viewBox={`0 0 260 ${height}`} preserveAspectRatio="xMinYMin meet" role="list">
                  <line x1={X0} y1={ROW / 2} x2={X0} y2={height - ROW / 2} className="path-spine" />
                  {steps.map((s, i) => {
                    const y = i * ROW + ROW / 2;
                    const t = tone(s);
                    const final = s.kind === "verify" && s.ok;
                    return (
                      <g key={i} role="listitem" className={`path-stop ${t} ${sel === i ? "sel" : ""}`} onClick={() => setSel(i)} tabIndex={0} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setSel(i)}>
                        <rect x={0} y={y - ROW / 2 + 3} width={260} height={ROW - 6} rx={8} className="path-hit" />
                        <circle cx={X0} cy={y} r={final ? 10 : s.kind === "verify" ? 8 : 6} className="path-dot" />
                        {t === "bad" && <path d={`M${X0 - 3} ${y - 3} l6 6 M${X0 + 3} ${y - 3} l-6 6`} className="path-mark" />}
                        {t === "ok" && <path d={`M${X0 - 4} ${y} l3 3 l5 -6`} className="path-mark" />}
                        <text x={X0 + 22} y={y - 3} className="path-label">
                          {s.title}
                        </text>
                        <text x={X0 + 22} y={y + 13} className="path-sub">
                          {s.file.split("/").pop()} · {timeAgo(s.at)}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>
              <div className="path-detail">
                {step ? (
                  <>
                    <div className={`path-detail-head ${tone(step)}`}>{step.title}</div>
                    <div className="muted small">{new Date(step.at).toLocaleString()} · {step.file}</div>
                    {step.code !== undefined ? (
                      <div className="code-frame path-code">
                        <CodeEditor value={step.code} readOnly />
                      </div>
                    ) : (
                      <pre className="path-output">{step.detail}</pre>
                    )}
                    {step.kind === "verify" && step.ok && path?.proof && (
                      <>
                        <div className="plan-detail-label">The proof Lean accepted</div>
                        <div className="code-frame path-code">
                          <CodeEditor value={path.proof} readOnly />
                        </div>
                      </>
                    )}
                  </>
                ) : (
                  <div className="muted small">Pick a stop on the path.</div>
                )}
              </div>
            </div>
          </>
        )}

        <div className="path-foot">
          {onOpenInProve && (
            <button className="link small" onClick={() => onOpenInProve(proved.file)}>
              <FileCode size={12} /> Open the statement on Prove
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
