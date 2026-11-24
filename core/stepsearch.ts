// Step-by-step proof search: a proof built one tactic at a time on Lean's
// proof states, through the resident REPL, as the step-level provers do
// (best-first search over goals). Whole-proof attempts lose their way on long
// proofs: one wrong line and the whole file fails. Here every step is checked
// as it is taken, only steps Lean accepts are kept, and the most promising
// state (fewest and smallest goals) is expanded next. Lean's automation is
// tried on every state first, so the model is asked only where it is needed.
// A finished tactic script is checked by the strict verifier like any proof.

import { SWEEP_SUITE } from "./lean/analysis";
import { splitHeader, type RawTactic, type ReplSession } from "./lean/repl";
import { extractStatement } from "./lean/rules";
import { describeRejection, pristineType, verifyText, type LeanRun } from "./lean/verify";
import type { ChatMessage, ModelProvider } from "./model/provider";
import type { ProveEvent } from "./prove";

export type StepSearchOptions = {
  frozen: string;
  provider: ModelProvider;
  model: string;
  /** A REPL session on the frozen file's imports, held for the whole search. */
  session: <T>(header: string, fn: (s: ReplSession) => Promise<T>) => Promise<T>;
  /** A fresh Lean run, for the strict verifier. */
  run: LeanRun;
  /** Model calls the search may make (each proposes several next steps). */
  maxCalls: number;
  /** Next steps asked for per call. */
  width?: number;
  /** Proof states kept at most. */
  maxNodes?: number;
  /** Try Lean's automation on each state before asking the model (default on). */
  automation?: boolean;
  /** Notes every call is given (premises, lemmas). */
  notes?: string;
  signal?: AbortSignal;
  onEvent: (e: ProveEvent) => void;
};

/** A proof state reached: the tactics that led to it and the goals left. */
export type StepNode = { ps: number; goals: string[]; tactics: string[]; expanded: number; failed: string[] };

const STEP_HEARTBEATS = 200_000;
const capped = (t: string) => `set_option maxHeartbeats ${STEP_HEARTBEATS} in (${t})`;
const errorsOf = (r: RawTactic) => [r.message ?? "", ...(r.messages ?? []).filter((m) => m.severity === "error").map((m) => m.data)].filter(Boolean);

/** Lower is more promising: fewer goals, shorter goals, fewer steps, less already tried. */
export function score(n: Pick<StepNode, "goals" | "tactics" | "expanded">): number {
  return n.goals.length * 1000 + n.goals.join("\n").length / 8 + n.tactics.length * 25 + n.expanded * 400;
}

/** The candidate next tactics in a reply: the lines of its last ```lean block (or of the reply), numbering and bullets removed, at most `width`, each once. */
export function parseTactics(reply: string, width: number): string[] {
  const blocks = [...reply.matchAll(/```(?:lean4?)?\n([\s\S]*?)```/g)].map((m) => m[1]);
  const text = blocks.length ? blocks[blocks.length - 1] : reply;
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    const t = raw
      .replace(/--.*$/, "")
      .replace(/^\s*(?:\d+[.)]|[-*•])\s+/, "")
      .trim();
    if (!t || /^(theorem|lemma|example|import|open)\b/.test(t) || /\bsorry\b|\badmit\b|native_decide/.test(t)) continue;
    if (!out.includes(t)) out.push(t);
    if (out.length >= width) break;
  }
  return out;
}

/** The finished proof: the frozen file with its proof replaced by the tactic script. */
export function assemble(frozen: string, tactics: string[]): string | null {
  const statement = extractStatement(frozen);
  if (!statement) return null;
  const at = frozen.indexOf(statement);
  const body = tactics.map((t) => t.split("\n").map((l) => `  ${l}`).join("\n")).join("\n");
  return `${frozen.slice(0, at)}${statement} by\n${body}\n`;
}

const SYSTEM = `You prove a Lean 4 (Mathlib) theorem one tactic at a time. You are shown the goals left at one point of the proof and the tactics that led there.
Propose next tactics: each one line, a real step that Lean can check now (intro, obtain/rcases, induction, cases, constructor, refine, have h : … := by …, rw [...], simp [...], field_simp, norm_num [...], nlinarith [sq_nonneg (a - b), …], omega, positivity, gcongr, exact …, apply …). Combine with \`<;>\` or \`;\` when useful. Never use sorry, admit or native_decide.
Reply with the tactics only, one per line, in one \`\`\`lean block, the most promising first.`;

/**
 * Search for a proof of `frozen` step by step. Emits an `attempt` per model
 * call (its tactics, and how many Lean accepted), and `solved` or `failed`.
 */
export async function stepSearch(o: StepSearchOptions): Promise<void> {
  const statement = extractStatement(o.frozen);
  if (!statement) return o.onEvent({ type: "failed", message: "The problem file has no theorem statement." });
  const width = Math.max(1, Math.min(o.width ?? 4, 8));
  const maxNodes = o.maxNodes ?? 300;
  o.onEvent({ type: "status", message: "Elaborating the frozen statement with Lean…" });
  const pristine = await pristineType(o.frozen, o.run);
  if (!pristine.ok) return o.onEvent({ type: "failed", message: `Lean could not check the problem file:\n${pristine.reason}` });
  const { header, body } = splitHeader(o.frozen);
  let calls = 0;
  let solved = false;
  let reason = "";
  try {
    await o.session(header, async (s) => {
      const opened = await s.command(body, s.mathlibEnv);
      const start = (opened.sorries ?? []).find((x) => typeof x.proofState === "number");
      if (!start || start.proofState === undefined) {
        reason = `the statement could not be opened as a proof state${opened.messages?.length ? `: ${opened.messages.map((m) => m.data).join("; ").slice(0, 400)}` : ""}`;
        return;
      }
      const nodes: StepNode[] = [{ ps: start.proofState, goals: [start.goal], tactics: [], expanded: 0, failed: [] }];
      const seen = new Set<string>([start.goal]);
      const triedAutomation = new Set<number>();

      // A script Lean closed, checked by the strict verifier: the proof and its axioms when it holds.
      const finish = async (tactics: string[]): Promise<{ proof: string; axioms: string[] } | null> => {
        const proof = assemble(o.frozen, tactics);
        if (!proof) return null;
        o.onEvent({ type: "status", message: `Lean closed every goal in ${tactics.length} step${tactics.length === 1 ? "" : "s"}; running the strict verifier…` });
        const v = await verifyText(o.frozen, pristine.type, proof, o.run);
        if (v.ok) return { proof, axioms: v.axioms };
        o.onEvent({ type: "status", message: `The verifier refused the finished script: ${describeRejection(v.rejection)}` });
        return null;
      };

      // One tactic on one state: the new state, or the error.
      const step = async (node: StepNode, tactic: string): Promise<{ done: boolean; node?: StepNode; error?: string }> => {
        const r = await s.tactic(capped(tactic), node.ps);
        const errors = errorsOf(r);
        if (errors.length || r.proofState === undefined) return { done: false, error: errors.join("; ").slice(0, 300) || "no proof state" };
        const goals = r.goals ?? [];
        if (!goals.length) return { done: true };
        return { done: false, node: { ps: r.proofState, goals, tactics: [...node.tactics, tactic], expanded: 0, failed: [] } };
      };

      while (!o.signal?.aborted && calls < o.maxCalls && nodes.length) {
        nodes.sort((a, b) => score(a) - score(b));
        const node = nodes[0];
        // Lean's automation first, once per state: free, and it closes many leaves.
        if (o.automation !== false && !triedAutomation.has(node.ps)) {
          triedAutomation.add(node.ps);
          for (const t of SWEEP_SUITE.filter((x) => x !== "exact?")) {
            const r = await step(node, t);
            const done = r.done ? await finish([...node.tactics, t]) : null;
            if (done) {
              o.onEvent({ type: "attempt", n: 0, candidate: done.proof, outcome: "verified", detail: `closed by Lean's automation (${t.slice(0, 60)}) after ${node.tactics.length} step${node.tactics.length === 1 ? "" : "s"}`, ms: 0, tokens: 0 });
              o.onEvent({ type: "solved", n: calls, proof: done.proof, axioms: done.axioms });
              return void (solved = true);
            }
          }
        }
        if (o.signal?.aborted) break;
        node.expanded++;
        calls++;
        const t0 = Date.now();
        const at = Date.now();
        const messages: ChatMessage[] = [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: `Theorem:\n\`\`\`lean\n${statement}\n\`\`\`\n\nTactics so far:\n${node.tactics.length ? node.tactics.map((t) => `  ${t}`).join("\n") : "  (none yet)"}\n\nGoals now:\n${node.goals.join("\n\n")}${node.failed.length ? `\n\nAlready tried here and refused by Lean:\n${node.failed.slice(-8).join("\n")}` : ""}${o.notes ? `\n\n${o.notes}` : ""}\n\nGive ${width} different next tactics.`,
          },
        ];
        let reply = "";
        let tokens = 0;
        let promptTokens = 0;
        let reasoning: string | undefined;
        try {
          const r = await o.provider.chat({ model: o.model, messages, maxTokens: 2048, temperature: 0.8, signal: o.signal });
          reply = r.content;
          tokens = r.usage?.completionTokens ?? 0;
          promptTokens = r.usage?.promptTokens ?? 0;
          reasoning = r.reasoning;
        } catch (e) {
          if (o.signal?.aborted) break;
          reason = `model call failed: ${(e as Error).message}`;
          break;
        }
        const tactics = parseTactics(reply, width);
        const lines: string[] = [];
        let advanced = 0;
        for (const t of tactics) {
          if (o.signal?.aborted) break;
          const r = await step(node, t);
          if (r.done) {
            const done = await finish([...node.tactics, t]);
            if (done) {
              o.onEvent({ type: "attempt", n: calls, candidate: done.proof, outcome: "verified", detail: "", ms: Date.now() - t0, tokens, model: o.model, at, promptTokens, reply, ...(reasoning ? { reasoning } : {}) });
              o.onEvent({ type: "solved", n: calls, proof: done.proof, axioms: done.axioms });
              return void (solved = true);
            }
            lines.push(`${t}  -- closes every goal, but the verifier refused the script`);
            continue;
          }
          if (r.error) {
            node.failed.push(`${t}  -- ${r.error.replace(/\s+/g, " ").slice(0, 160)}`);
            lines.push(`${t}  -- error: ${r.error}`);
            continue;
          }
          const key = r.node!.goals.join("\n\n");
          if (seen.has(key)) {
            lines.push(`${t}  -- a state already reached`);
            continue;
          }
          seen.add(key);
          advanced++;
          lines.push(`${t}  -- ${r.node!.goals.length} goal${r.node!.goals.length === 1 ? "" : "s"} left`);
          if (nodes.length < maxNodes) nodes.push(r.node!);
        }
        o.onEvent({
          type: "attempt",
          n: calls,
          candidate: [...node.tactics, "-- next steps tried:", ...tactics].join("\n"),
          outcome: advanced ? "sorries" : "errors",
          detail: lines.length ? `Step ${node.tactics.length + 1}, ${advanced} of ${tactics.length} accepted:\n${lines.join("\n")}` : "error: the reply had no tactic",
          ms: Date.now() - t0,
          tokens,
          model: o.model,
          at,
          promptTokens,
          reply,
          ...(reasoning ? { reasoning } : {}),
        });
        o.onEvent({ type: "status", message: `Step search: ${calls} of ${o.maxCalls} model calls, ${nodes.length} proof states, best has ${nodes[0].goals.length} goal${nodes[0].goals.length === 1 ? "" : "s"} left.` });
        // A state nothing advances from, tried several times, is dropped.
        if (node.expanded >= 3 && !advanced) nodes.splice(nodes.indexOf(node), 1);
      }
      if (!nodes.length && !reason) reason = "every proof state was a dead end";
    });
  } catch (e) {
    reason = `the REPL failed: ${(e as Error).message}`;
  }
  if (solved) return;
  if (o.signal?.aborted) return o.onEvent({ type: "failed", message: "Stopped." });
  o.onEvent({ type: "failed", message: `No proof step by step after ${calls} model call${calls === 1 ? "" : "s"}${reason ? `: ${reason}` : ""}.` });
}
