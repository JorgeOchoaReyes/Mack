// The proof search (build step 2): rounds of CONTINUE(v) over a SearchTree,
// adapted from open-math-harness `program-files/discovery` (the rollout) and
// `program-files/prover` (the fixed-loop worker and its `putnam.j2`
// prompt), Apache-2.0.
//
// Each round the policy picks up to `w` nodes; one worker per pick starts
// from that node's file, makes at most `callsPerContinuation` model calls
// (each candidate is quick-checked and the verdict goes back to it) and
// hands back one file. The harness then evaluates that file itself: the
// textual rules, the quick check, and for a complete file the strict
// verifier in a fresh Lean process. Only `verifyText` makes a node solved.

import { describeCheck, type LeanCheck, type LeanCheckRun } from "../lean/check";
import { extractStatement, frozenObjection, protocolObjection } from "../lean/rules";
import { describeRejection, pristineType, verifyText, type LeanRun } from "../lean/verify";
import type { ChatMessage, ModelProvider } from "../model/provider";
import { extractLean } from "../prove";
import { analyze, complete, creditScore, type SketchAnalysis } from "../lean/analysis";
import { admit, initialPolicy, partialScore, scoreOf, SearchTree, type Limits, type NodeStatus, type SearchNode } from "./tree";

export type SearchEvent =
  | { type: "status"; message: string }
  | { type: "round"; round: number; batch: number[] }
  | { type: "node"; node: SearchNode; ms: number; tokens: number; calls: number }
  | { type: "solved"; n: number; proof: string; axioms: string[] }
  | { type: "failed"; message: string };

export type SearchOptions = {
  frozen: string;
  provider: ModelProvider;
  model: string;
  /** A fresh `lake env lean` run: the strict verifier and the pristine type. */
  run: LeanRun;
  /** The quick check: the resident REPL when built, else a fresh run. */
  check: LeanCheckRun;
  limits: Limits;
  /** Run upstream's completion and the sketch analysis on partial nodes (scoring v3); off, partial nodes get the textual credit. */
  analysis?: boolean;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  onEvent: (e: SearchEvent) => void;
};

/** The worker's system message: upstream's fixed-loop template, with the competition framing made general. */
export function workerSystem(o: {
  statement: string;
  frozen: string;
  parent: SearchNode;
  check: LeanCheck | null;
  siblings: SearchNode[];
}): string {
  const parts = [
    `You are proving one theorem in Lean 4 with Mathlib, and you are continuing a partial proof that someone else started.
Keep the theorem statement exactly as given, byte for byte. \`sorry\` is allowed for the parts you have not proved yet; \`native_decide\` and \`axiom\` are not. You may add helper lemmas before the theorem.
Make progress on at least one thing: close or decompose at least one \`sorry\` (for example, split it into \`have\` steps that each end in \`sorry\`, and prove the ones you can), or fix at least one error. Do as much as you can verify. Do not rewrite parts that already check.
Return the complete file in one \`\`\`lean code block, and nothing else.
If the statement begins with \`let (…) := (…)\`, Lean shows the goal as a \`match\` term: start the proof with \`intro\` and then \`simp only []\` (or \`show\` the unfolded statement) to expose the real goal before proving it.

You are continuing from node ${o.parent.id} of the search tree.

The frozen theorem statement (keep it byte for byte):
\`\`\`lean
${o.frozen.trimEnd()}
\`\`\``,
  ];
  if (o.parent.file !== o.frozen) parts.push(`The current file (the node's workspace):\n\`\`\`lean\n${o.parent.file.trimEnd()}\n\`\`\``);
  else parts.push("The current file is the statement itself: nothing has been proved yet.");
  parts.push(
    `The checker's verdict on the current file:\n${
      o.check ? describeCheck(o.check) : "(root node: not checked yet; the proof is the statement with `sorry`)"
    }`,
  );
  if (o.siblings.length > 0) {
    const shown = o.siblings.slice(-12);
    const lines = [`Other continuations already made from this same node (${o.siblings.length}); each was already tried, so do something different:`];
    if (o.siblings.length > shown.length) lines.push(`  (the ${o.siblings.length - shown.length} oldest are omitted)`);
    for (const s of shown) {
      lines.push(`  - node ${s.id}: ${s.status} (${s.errors} error(s), ${s.sorries} sorry(ies) remaining)`);
      if (s.approach) lines.push(`    approach: ${s.approach.slice(0, 300)}`);
    }
    parts.push(lines.join("\n"));
  }
  parts.push(
    "Make progress on at least one thing (close or decompose at least one sorry, or fix at least one error; more if you can) and return the complete file in one ```lean block. Before the block, write one line starting with `Approach:` that says what you are trying.",
  );
  return parts.join("\n\n");
}

function approachOf(reply: string): string {
  return (/^\s*Approach:\s*(.+)$/m.exec(reply.replace(/<think>[\s\S]*?<\/think>/g, ""))?.[1] ?? "").trim().slice(0, 300);
}

type Evaluation = {
  status: NodeStatus;
  score: number;
  detail: string;
  errors: number;
  sorries: number;
  check: LeanCheck | null;
  axioms?: string[];
  analysis?: SketchAnalysis;
  /** The harness's completed version of the file, when the completion suite closed every sorry and the verifier accepted it. */
  completed?: string;
};

const rank = (e: Evaluation) => [e.score, -e.sorries, -e.errors];
const better = (a: Evaluation, b: Evaluation) => {
  const [x, y] = [rank(a), rank(b)];
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
};

export async function search(o: SearchOptions): Promise<void> {
  const objection = frozenObjection(o.frozen);
  if (objection) return o.onEvent({ type: "failed", message: `The problem file is not usable: ${objection}` });
  const statement = extractStatement(o.frozen);
  if (!statement) return o.onEvent({ type: "failed", message: "The problem file has no theorem statement." });

  o.onEvent({ type: "status", message: "Elaborating the frozen statement with Lean (first run loads Mathlib)…" });
  const pristine = await pristineType(o.frozen, o.run);
  if (!pristine.ok) return o.onEvent({ type: "failed", message: `Lean could not check the problem file:\n${pristine.reason}` });

  const { w, k1, fanout, callsPerContinuation, modelCalls } = o.limits;
  const tree = new SearchTree({ file: o.frozen, status: "sorries", score: 0.5, detail: "", errors: 0, sorries: 1, approach: "the frozen statement" });
  const checks = new Map<number, LeanCheck | null>([[0, null]]);
  let callsLeft = modelCalls;
  let solved = false;

  /** The harness's own evaluation of a file: textual rules, quick check, then the strict verifier for a complete file. */
  const evaluate = async (file: string, known?: LeanCheck): Promise<Evaluation> => {
    const textual = protocolObjection(statement, file);
    if (textual) return { status: "invalid", score: scoreOf("invalid"), detail: textual, errors: 0, sorries: 0, check: null };
    const check = known ?? (await o.check(file));
    const base = { errors: check.errors.length, sorries: check.sorries.length, check };
    const at = (status: NodeStatus) => ({ status, score: status === "sorries" ? partialScore(file, base.sorries) : scoreOf(status) });
    if (check.status === "noVerdict") return { ...base, ...at("no verdict"), detail: check.output };
    if (check.status !== "complete") return { ...base, ...at(check.status), detail: describeCheck(check) };
    const verdict = await verifyText(o.frozen, pristine.type, file, o.run);
    if (verdict.ok) return { ...base, ...at("verified"), detail: "", axioms: verdict.axioms };
    return { ...base, ...at("rejected"), detail: describeRejection(verdict.rejection) };
  };

  /**
   * The harness's last word on a partial node (scoring v3): try to complete it
   * with the suite and verify the completed file; otherwise score its sketch.
   */
  const finalize = async (file: string, ev: Evaluation): Promise<Evaluation> => {
    if (!o.analysis || ev.status !== "sorries" || o.signal?.aborted) return ev;
    const c = await complete(file, o.check);
    if (c.completed) {
      const v = await verifyText(o.frozen, pristine.type, c.completed, o.run);
      if (v.ok) return { ...ev, status: "verified", score: 1, sorries: 0, axioms: v.axioms, completed: c.completed, detail: `completed by the harness: ${c.closers.map((x) => x.tactic).join(", ")}` };
    }
    const a = await analyze(file, statement, o.check);
    const note = `sketch analysis (${a.suite}): ${a.closed} closed step(s), ${a.trivial} trivial, ${a.unused} unused; ${a.leaves} leaf/leaves, ${a.hollow} hollow, ${a.untestable} untestable${a.error ? `; ${a.error}` : ""}`;
    return { ...ev, analysis: a, score: a.error && a.leaves === 0 ? ev.score : creditScore(a), detail: `${ev.detail}

${note}` };
  };

  /** CONTINUE(v): one worker's fixed loop, then the harness's evaluation of what it hands back. */
  const continueNode = async (parentId: number, round: number, siblings: SearchNode[]): Promise<void> => {
    const parent = tree.nodes[parentId];
    const started = Date.now();
    const messages: ChatMessage[] = [
      { role: "system", content: workerSystem({ statement, frozen: o.frozen, parent, check: checks.get(parentId) ?? null, siblings }) },
      { role: "user", content: "Return the complete file." },
    ];
    let best = null as { file: string; ev: Evaluation; approach: string } | null;
    let tokens = 0;
    let calls = 0;
    for (let attempt = 1; attempt <= callsPerContinuation && callsLeft > 0; attempt++) {
      if (o.signal?.aborted || solved) return;
      callsLeft--;
      calls++;
      let reply: string;
      try {
        const r = await o.provider.chat({
          model: o.model,
          messages,
          maxTokens: o.maxTokens ?? 8192,
          temperature: o.temperature ?? 0.7,
          signal: o.signal,
        });
        reply = r.content;
        tokens += r.usage?.completionTokens ?? 0;
      } catch (e) {
        if (o.signal?.aborted) return;
        o.onEvent({ type: "status", message: `A worker's model call failed: ${(e as Error).message}` });
        break;
      }
      messages.push({ role: "assistant", content: reply });
      const file = extractLean(reply);
      const ev = await evaluate(file);
      const approach = approachOf(reply) || (best?.approach ?? "");
      if (!best || better(ev, best.ev)) best = { file, ev, approach };
      if (ev.status === "verified") break;
      const verdict = ev.check ? describeCheck(ev.check) : `status: ${ev.status}\n${ev.detail}`;
      messages.push({
        role: "user",
        content: `The checker's verdict on your file:\n${ev.status === "rejected" ? `Lean accepts it, but the strict verifier rejected it: ${ev.detail}` : verdict}\n\nMake progress on at least one thing and return the complete file in one \`\`\`lean block.`,
      });
    }
    if (!best || o.signal?.aborted) return;
    best = { ...best, ev: await finalize(best.file, best.ev) };
    parent.continued++;
    const node = tree.add(parentId, {
      file: best.ev.completed ?? best.file,
      status: best.ev.status,
      score: best.ev.score,
      detail: best.ev.detail,
      errors: best.ev.errors,
      sorries: best.ev.sorries,
      round,
      approach: best.approach,
    });
    checks.set(node.id, best.ev.check);
    o.onEvent({ type: "node", node: { ...node }, ms: Date.now() - started, tokens, calls });
    if (best.ev.status === "verified" && !solved) {
      solved = true;
      o.onEvent({ type: "solved", n: node.id, proof: node.file, axioms: best.ev.axioms ?? [] });
    }
  };

  for (let round = 1; round <= k1; round++) {
    if (o.signal?.aborted) return o.onEvent({ type: "failed", message: "Stopped." });
    if (callsLeft <= 0) break;
    const affordable = Math.max(1, Math.floor(callsLeft / Math.max(1, callsPerContinuation)));
    const width = Math.min(w, affordable);
    const batch = admit(tree, initialPolicy(tree, width, fanout), width, fanout);
    o.onEvent({ type: "round", round, batch });
    o.onEvent({ type: "status", message: `Round ${round} of ${k1}: ${batch.length} worker${batch.length === 1 ? "" : "s"} continuing node${new Set(batch).size === 1 ? "" : "s"} ${[...new Set(batch)].join(", ")}…` });
    const siblingsOf = (id: number) => tree.nodes.filter((n) => n.parent === id);
    await Promise.all(batch.map((id) => continueNode(id, round, siblingsOf(id))));
    if (tree.solved()) return;
  }
  if (o.signal?.aborted) return o.onEvent({ type: "failed", message: "Stopped." });
  const best = tree.nodes.slice(1).sort((a, b) => b.score - a.score || a.sorries - b.sorries)[0];
  o.onEvent({
    type: "failed",
    message: `No verified proof after ${tree.nodes.length - 1} node${tree.nodes.length === 2 ? "" : "s"}.${best ? ` The best is node ${best.id} (${best.status}, ${best.sorries} sorry left, ${best.errors} error${best.errors === 1 ? "" : "s"}).` : ""}`,
  });
}
