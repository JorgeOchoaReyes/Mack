// The prover's Lean procedures against real Lean + Mathlib: the automation
// sweep, reading a goal and stating it as a lemma, decompose's assembly, and
// premise selection on Mathlib's own source. Opt-in, like real-lean.test.ts;
// CI runs it in the community proofs workspace (.github/workflows/real-lean.yml).
//   MACK_LEAN_WORKSPACE=%USERPROFILE%\mack-lean npx vitest run tests/real-prover.test.ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { closeByAutomation, sweep } from "../core/lean/analysis";
import { checkFromRun, type LeanCheckRun } from "../core/lean/check";
import { MathlibIndex, mathlibSource, premises } from "../core/lean/mathlib-index";
import { leanRunner, setLeanSlots } from "../core/lean/runner";
import { pristineType, verifyText } from "../core/lean/verify";
import { decompose, goalAt, goalToLemma } from "../core/decompose";
import { dropDeadTactics } from "../core/lean/repair";
import type { ChatRequest, ModelProvider } from "../core/model/provider";
import type { ProveEvent } from "../core/prove";

const workspace = process.env.MACK_LEAN_WORKSPACE;
const run = workspace ? leanRunner({ workspace, timeoutMs: 600_000 }) : undefined;
const check: LeanCheckRun = async (src) => checkFromRun(await run!(src));
const T = 1_800_000;
setLeanSlots(2);

describe.skipIf(!workspace)("the prover's Lean procedures against real Lean", () => {
  it(
    "closes routine sorries with Lean's automation, and the result passes the verifier",
    async () => {
      const frozen = "import Mathlib\n\ntheorem sweep_demo (x : ℕ) (h : 3 ≤ x) : 2 * x + 1 ≥ 7 := by\n  sorry\n";
      const candidate = "import Mathlib\n\ntheorem sweep_demo (x : ℕ) (h : 3 ≤ x) : 2 * x + 1 ≥ 7 := by\n  have h1 : 2 * x ≥ 6 := by sorry\n  sorry\n";
      const r = await sweep(candidate, check);
      expect(r, JSON.stringify(r)).toMatchObject({ closed: 2, open: 0 });
      const p = await pristineType(frozen, run!);
      expect(p.ok).toBe(true);
      const v = await verifyText(frozen, p.ok ? p.type : "", r.completed!, run!);
      expect(v, JSON.stringify(v)).toMatchObject({ ok: true });
    },
    T,
  );

  it(
    "closes a statement with Lean's automation in one Lean run, and the proof passes the verifier",
    async () => {
      const frozen = "import Mathlib\n\ntheorem auto_demo (x : ℕ) (h : 3 ≤ x) : 2 * x + 1 ≥ 7 := by\n  sorry\n";
      const closed = await closeByAutomation(frozen, check);
      expect(closed).not.toBeNull();
      const p = await pristineType(frozen, run!);
      const v = await verifyText(frozen, p.ok ? p.type : "", closed!, run!);
      expect(v, JSON.stringify(v)).toMatchObject({ ok: true });
    },
    T,
  );

  it(
    "leaves a step automation cannot close, and closes the rest",
    async () => {
      const candidate = "import Mathlib\n\ntheorem sweep_open (x : ℕ) : x * x ≥ 0 := by\n  have h1 : x = x + 1 := by sorry\n  sorry\n";
      const r = await sweep(candidate, check);
      expect(r, JSON.stringify(r)).toMatchObject({ closed: 1, open: 1 });
      expect(r.current).toContain("have h1 : x = x + 1 := by sorry");
    },
    T,
  );

  it(
    "reads the goal at a sorry and states it as a lemma Lean accepts",
    async () => {
      const src = "import Mathlib\n\ntheorem goal_demo (a b : ℝ) (ha : 0 < a) (hb : 0 < b) : 0 < a * b + a := by\n  have h1 : 0 < a * b := by sorry\n  linarith\n";
      const at = src.indexOf("sorry");
      const g = await goalAt(src, at, check);
      if (!g) {
        const raw = await run!(`${src.slice(0, at)}(trace_state; sorry)${src.slice(at + 5)}`);
        const parsed = await check(`${src.slice(0, at)}(trace_state; sorry)${src.slice(at + 5)}`);
        expect.fail(`no goal was read. Lean said:\n${JSON.stringify(raw)}\nparsed: ${JSON.stringify(parsed)}`);
      }
      expect(g!.term).toBe(false);
      const lemma = goalToLemma(g!.goal);
      expect(lemma, g!.goal).not.toBeNull();
      expect(lemma!.args).toEqual(["a", "b", "ha", "hb"]);
      const c = await check(`import Mathlib\n\ntheorem goal_demo_step1 ${lemma!.binders} :\n    ${lemma!.target} := by\n  sorry\n`);
      expect(c.status, c.output).toBe("sorries");
    },
    T,
  );

  it(
    "decomposes a statement, proves the step as a lemma, and assembles a proof the verifier accepts",
    async () => {
      const frozen = "import Mathlib\n\ntheorem decompose_demo (a b : ℝ) (ha : 0 < a) (hb : 0 < b) : 0 < a * b + a := by\n  sorry\n";
      const provider: ModelProvider = {
        name: "scripted",
        listModels: async () => [],
        chat: async (r: ChatRequest) => {
          const sys = r.messages[0].role === "system" ? r.messages[0].content : "";
          const file = /```lean4?\n([\s\S]*?)```/.exec(r.messages.find((m) => m.role === "user")!.content)?.[1] ?? "";
          if (sys.includes("split a Lean 4 theorem")) {
            return { content: "```lean\nimport Mathlib\n\ntheorem decompose_demo (a b : ℝ) (ha : 0 < a) (hb : 0 < b) : 0 < a * b + a := by\n  have h1 : 0 < a * b := by sorry\n  linarith\n```" };
          }
          // The theorem's own attempts fail; a step lemma gets a real proof.
          return { content: `\`\`\`lean\n${file.includes("_step") ? file.replace(/sorry/, "exact mul_pos ha hb") : file.replace(/sorry/, "exact no_such_lemma")}\`\`\`` };
        },
      };
      const events: ProveEvent[] = [];
      await decompose({ frozen, provider, model: "scripted", run: run!, check, maxAttempts: 1, lemmaAttempts: 1, maxDepth: 1, rounds: 1, automation: false, onEvent: (e) => events.push(e) });
      const solved = events.find((e): e is Extract<ProveEvent, { type: "solved" }> => e.type === "solved");
      expect(solved, JSON.stringify(events.filter((e) => e.type !== "status"), null, 1).slice(0, 4000)).toBeDefined();
      expect(solved!.proof).toContain("exact decompose_demo_step1 a b ha hb");
    },
    T,
  );

  it(
    "removes a tactic left after its goal closed, and the repaired proof checks",
    async () => {
      const src = "import Mathlib\n\ntheorem dead_demo (x : ℕ) : x + 0 = x := by\n  simp\n  rfl\n";
      const c = await check(src);
      expect(c.status, c.output).toBe("errors");
      expect(c.errors.map((e) => e.message.toLowerCase())).toEqual([expect.stringMatching(/^no goals/)]);
      const repaired = dropDeadTactics(src, c.errors);
      expect(repaired).toBe("import Mathlib\n\ntheorem dead_demo (x : ℕ) : x + 0 = x := by\n  simp\n");
      expect((await check(repaired!)).status).toBe("complete");
    },
    T,
  );

  it(
    "selects premises from Mathlib's own source",
    async () => {
      expect(mathlibSource(workspace!)).toBeDefined();
      const decls = await new MathlibIndex(workspace!, join(mkdtempSync(join(tmpdir(), "mack-idx-")), "index.json")).load();
      expect(decls.length).toBeGreaterThan(50_000);
      const found = premises(decls, "theorem t (n : ℕ) (h : 2 ≤ n) : Nat.choose n 2 = n * (n - 1) / 2 :=").map((d) => d.name);
      expect(found.some((n) => n.startsWith("Nat.choose")), found.join(", ")).toBe(true);
    },
    T,
  );
});
