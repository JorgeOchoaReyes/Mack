// A problem's plan: what we are trying to show, where we honestly stand, and
// the steps that get us there. The chat's assistant writes it with
// `plan_update`; the person reads it beside the chat. It lives in the problem
// folder (.mack/plan.json), so it travels with the work.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** What a step does, in the person's terms. Only "lean" steps end in a machine-checked proof. */
export const STEP_KINDS = ["lean", "read", "compute", "think", "write"] as const;
export type StepKind = (typeof STEP_KINDS)[number];

/** Which of Mack's features a step uses: the plan says how each step gets done, not only what. */
export const STEP_VIA = ["chat", "web", "python", "lean_check", "proof_run", "proof_search", "ultramath", "agents", "reminder", "pull_request"] as const;
export type StepVia = (typeof STEP_VIA)[number];

export const STEP_STATUSES = ["todo", "doing", "done", "stuck", "dropped"] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

export type PlanStep = {
  id: string;
  title: string;
  kind: StepKind;
  /** The feature that does the work; absent means the conversation itself. */
  via?: StepVia;
  status: StepStatus;
  /** Why this step matters, in plain words. */
  why?: string;
  /** What came of it: a verified theorem, a reference, a number, a dead end. */
  result?: string;
  /** True only when a Lean verifier accepted this step's proof in a session. */
  verified?: boolean;
};

export type Plan = {
  /** The problem in one or two plain sentences. */
  goal: string;
  /** Where we stand, honestly: what is known, how hard it is, what we aim for. */
  outlook: string;
  steps: PlanStep[];
  /** What Lean accepted, newest last. Only Mack writes this; `plan_update` cannot. */
  proved?: Proved[];
  updatedAt: number;
};

/**
 * A statement a Lean verifier accepted in this problem. Mack records it from the verifier's own
 * verdict (`verify_lean` or a proof run), never from the model, so the list is what Lean decided.
 */
export type Proved = {
  /** The frozen statement file, relative to the problem folder. */
  file: string;
  /** The theorem's name in that file. */
  theorem?: string;
  /** The statement's doc comment, in the words it was written in. */
  summary?: string;
  how: "verify_lean" | "proof_run";
  /** The accepted proof file (verify_lean) or the proof run's id (proof_run). */
  proof?: string;
  at: number;
};

export const EMPTY_PLAN: Plan = { goal: "", outlook: "", steps: [], updatedAt: 0 };

/** The theorem a frozen statement states, and its doc comment as plain text. */
export function describeStatement(source: string): { theorem?: string; summary?: string } {
  const m = /(\/--([\s\S]*?)-\/\s*)?(?:@\[[^\]]*\]\s*)?(?:theorem|lemma)\s+([^\s:({[]+)/.exec(source);
  if (!m) return {};
  const summary = m[2]
    ?.replace(/\*\*|`/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return { theorem: m[3], summary: summary ? summary.slice(0, 400) : undefined };
}

/** The plan with `p` recorded as proved: a newer verdict on the same statement file replaces the older one. */
export function recordProved(plan: Plan, p: Proved): Plan {
  return { ...plan, proved: [...(plan.proved ?? []).filter((x) => x.file !== p.file), p], updatedAt: Date.now() };
}

/** What a verifier's tool outcome proved, if anything: `verify_lean` accepted, or a proof run verified. */
export function provedBy(o: { name: string; ok: boolean; args: Record<string, unknown>; output: string }): Pick<Proved, "file" | "how" | "proof"> | undefined {
  if (!o.ok) return undefined;
  const clean = (v: unknown) => (typeof v === "string" && v ? v.replace(/\\/g, "/").replace(/^\.\//, "") : undefined);
  if (o.name === "verify_lean" && o.output.startsWith("accepted")) {
    const file = clean(o.args.statement_path);
    return file ? { file, how: "verify_lean", proof: clean(o.args.proof_path) } : undefined;
  }
  if (o.name === "start_proof" && o.output.startsWith("verified")) {
    const file = clean(o.args.path);
    return file ? { file, how: "proof_run", proof: /run (\d+)/.exec(o.output)?.[1] } : undefined;
  }
  return undefined;
}

function storedProved(raw: unknown): Proved[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.flatMap((x): Proved[] => {
    const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    if (typeof o.file !== "string" || (o.how !== "verify_lean" && o.how !== "proof_run")) return [];
    return [{ file: o.file, how: o.how, theorem: text(o.theorem, 200), summary: text(o.summary, 400), proof: text(o.proof, 300), at: typeof o.at === "number" ? o.at : 0 }];
  });
}

const planPath = (root: string) => join(root, ".mack", "plan.json");

export async function readPlan(root: string): Promise<Plan> {
  try {
    const raw = JSON.parse(await readFile(planPath(root), "utf8")) as Record<string, unknown>;
    const plan = normalizePlan(raw, EMPTY_PLAN);
    const proved = storedProved(raw.proved);
    return { ...plan, ...(proved ? { proved } : {}), updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : plan.updatedAt };
  } catch {
    return EMPTY_PLAN;
  }
}

export async function writePlan(root: string, plan: Plan): Promise<void> {
  await mkdir(join(root, ".mack"), { recursive: true });
  await writeFile(planPath(root), JSON.stringify(plan, null, 2), "utf8");
}

const text = (v: unknown, max: number): string | undefined => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
const oneOf = <T extends string>(v: unknown, all: readonly T[], fallback: T): T => (all.includes(v as T) ? (v as T) : fallback);

/**
 * The plan a `plan_update` call (or a stored file) describes, on top of the current one:
 * fields it leaves out are kept; `steps`, when given, replaces the list.
 */
export function normalizePlan(raw: unknown, current: Plan): Plan {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  let steps = current.steps;
  let rawSteps = o.steps;
  if (typeof rawSteps === "string") {
    try {
      rawSteps = JSON.parse(rawSteps);
    } catch {
      throw new Error("steps must be an array of steps");
    }
  }
  if (rawSteps !== undefined) {
    if (!Array.isArray(rawSteps)) throw new Error("steps must be an array of steps");
    steps = rawSteps.slice(0, 60).flatMap((s, i): PlanStep[] => {
      const x = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
      const title = text(x.title, 200);
      if (!title) return [];
      const status = oneOf(x.status, STEP_STATUSES, "todo");
      const before = current.steps.find((c) => c.id === x.id);
      return [
        {
          id: text(x.id, 40) ?? `s${i + 1}`,
          title,
          kind: oneOf(x.kind, STEP_KINDS, "think"),
          via: STEP_VIA.includes(x.via as StepVia) ? (x.via as StepVia) : undefined,
          status,
          why: text(x.why, 600),
          result: text(x.result, 1200),
          // A step stays verified only while it is done; the model cannot clear the record by rewording it.
          verified: status === "done" && (x.verified === true || before?.verified === true) ? true : undefined,
        },
      ];
    });
  }
  return {
    goal: text(o.goal, 800) ?? current.goal,
    outlook: text(o.outlook, 1500) ?? current.outlook,
    steps,
    // Kept from the current plan whatever the call says: only a verifier's verdict adds to it.
    ...(current.proved ? { proved: current.proved } : {}),
    updatedAt: Date.now(),
  };
}

/** The plan as the assistant reads it at the start of a turn. */
export function planPrompt(plan: Plan): string {
  const how = `# The plan

The person follows this problem through its plan, shown beside the chat. Keep it current with \`plan_update\`: set the goal and an honest outlook when the problem is new, break the work into steps, and update a step's status and result as soon as it changes. Write for someone with no training in mathematics or Lean: plain words, no unexplained jargon. Be brief, because the person sees the short parts first and opens details only when they want them: the goal is one sentence, the outlook starts with one sentence that says the honest bottom line (the rest of the outlook is detail), and a step title is a short action of at most ten words. Put the detail in a step's \`why\` and \`result\`. Kinds: "lean" (state or prove something in Lean; mark it verified only when \`verify_lean\` or a proof run's verifier accepted it), "read" (find and read what is known), "compute" (check examples or search numerically), "think" (work out an idea or a reduction), "write" (write up what we found). For a famous open problem, say plainly that a full solution is very unlikely and aim the steps at things that can really be done: understanding it, checking known partial results in Lean, exploring small cases.

Plan with everything Mack can do, and give each step a \`via\` naming the feature that does it:
- "web": \`web_search\` and \`fetch_url\` (papers and PDFs) to find what is known; save notes in the problem folder, e.g. notes/literature.md.
- "python": \`shell_exec\` running a Python script (in the background for long runs) to test small cases, search for counterexamples or check a bound numerically; save the script and its output. Evidence, never proof.
- "lean_check": write a Lean statement and \`check_lean\` it, to pin down exactly what is claimed before any proof attempt. Freeze the statement in its own file.
- "proof_run": \`start_proof\` on one statement: "single" for a lemma that should be routine, "search" for a harder one (a tree of attempts).
- "proof_search": \`discovery_start\` on several Lean files at once: break a known result into a chain of lemmas and search for all of them in one run, then read \`discovery_status\`.
- "ultramath": \`ultramath_start\` puts several agents on one hard question, each taking a different direction on a shared board. Use it for a genuinely open or stuck sub-question, not for routine lemmas, and judge what they submit.
- "agents": \`run_agent\` for a side task done in parallel (read one paper, try one idea) while you continue.
- "reminder": \`conversation_remind\` to come back to long work (a proof search, a swarm, a background computation) instead of waiting.
- "pull_request": \`open_pr\` to publish finished, verified work for review.
- "chat": explaining, deciding and writing up in the conversation itself.
A good plan mixes these: understand and read first, compute to build intuition, state precisely in Lean, prove the known pieces with proof runs or one proof search, put a swarm on the genuinely hard part, and write up honestly what was and was not proved.`;
  const tell = `When a verifier accepts a proof, Mack adds it to the plan's "Proved" list, which the person sees at the top of the plan, and marks the step verified. Then tell the person, in plain words and in a few sentences: what the theorem says, using a small example such as n = 3; how it answers or relates to their question; which file holds it; and what is still not proved. Name the theorem and file in your message so they can find them.`;
  const proved = plan.proved?.length
    ? `\n\nProved (recorded by Mack from the verifier, newest last):\n${plan.proved.map((p) => `- ${p.theorem ?? "(theorem)"} in ${p.file}, by ${p.how === "proof_run" ? `proof run ${p.proof ?? ""}`.trim() : `verify_lean${p.proof ? ` of ${p.proof}` : ""}`}`).join("\n")}`
    : "";
  if (!plan.goal && !plan.steps.length) return `${how}\n\n${tell}\n\nThere is no plan yet.${proved}`;
  const steps = plan.steps.map((s) => `- [${s.status}${s.verified ? ", verified" : ""}] (${s.kind}${s.via ? ` via ${s.via}` : ""}) ${s.id}: ${s.title}${s.result ? ` — ${s.result}` : ""}`).join("\n");
  return `${how}\n\n${tell}\n\nThe current plan:\nGoal: ${plan.goal || "(not set)"}\nOutlook: ${plan.outlook || "(not set)"}\nSteps:\n${steps || "(none)"}${proved}`;
}
