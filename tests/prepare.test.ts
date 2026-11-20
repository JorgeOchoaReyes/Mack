import { describe, expect, it } from "vitest";
import { falsifyFile, readFalsify } from "../core/lean/falsify";
import type { LeanCheck } from "../core/lean/check";
import { lemmaNote, lemmaSource, prepare, type PrepareEvent } from "../core/prepare";
import type { ChatRequest, ModelProvider } from "../core/model/provider";

const FROZEN = `import Mathlib

/-- Every natural number is at most its square. -/
theorem le_sq (n : ℕ) : n ≤ n ^ 2 := by
  sorry
`;

const check = (c: Partial<LeanCheck>): LeanCheck => ({ status: "complete", errors: [], sorries: [], output: "", ...c });

describe("trying to break a statement", () => {
  it("replaces the proof with Lean's random tester and keeps the statement", () => {
    expect(falsifyFile(FROZEN)).toBe(`import Mathlib

/-- Every natural number is at most its square. -/
theorem le_sq (n : ℕ) : n ≤ n ^ 2 := by
  plausible
`);
    expect(falsifyFile("import Mathlib\n")).toBeUndefined();
  });

  it("reads a counterexample, a pass, an untestable statement and no verdict", () => {
    const counter = "Found a counter-example!\nn := 2\nissue: 4 < 2 does not hold\n(0 shrinks)";
    expect(readFalsify(check({ status: "errors", errors: [{ line: 4, col: 38, message: counter }], output: counter }))).toEqual({ verdict: "counterexample", detail: counter });
    expect(readFalsify(check({ status: "sorries", output: "warning: declaration uses 'sorry'" })).verdict).toBe("passed");
    expect(readFalsify(check({ status: "errors", errors: [{ line: 4, col: 38, message: "failed to synthesize\n  Plausible.Testable (∀ x : ℝ, x ≤ x ^ 2)" }] })).verdict).toBe("untestable");
    expect(readFalsify(check({ status: "sorries", output: "warning: Gave up after failing to generate values that fulfill the preconditions 100 times." })).verdict).toBe("untestable");
    expect(readFalsify(check({ status: "noVerdict" })).verdict).toBe("unknown");
  });
});

function fakeModel(reply: string) {
  const calls: ChatRequest[] = [];
  const provider: ModelProvider = {
    name: "fake",
    chat: async (r: ChatRequest) => {
      calls.push(r);
      return { content: reply, usage: { promptTokens: 1, completionTokens: 1 } };
    },
    listModels: async () => [],
  } as unknown as ModelProvider;
  return { provider, calls };
}

describe("the steps before the first attempt", () => {
  it("stops without a model call when the tester finds a counterexample", async () => {
    const { provider, calls } = fakeModel("unused");
    const events: (PrepareEvent | { type: "status" })[] = [];
    const counter = "Found a counter-example!\nn := 2";
    const r = await prepare({
      frozen: FROZEN,
      provider,
      model: "m",
      check: async () => check({ status: "errors", errors: [{ line: 1, col: 1, message: counter }] }),
      checkStatement: true,
      idea: true,
      onEvent: (e) => events.push(e),
    });
    expect(r.stop).toContain("counterexample");
    expect(calls).toHaveLength(0);
    expect(events.find((e) => e.type === "statementCheck")).toMatchObject({ check: { verdict: "counterexample" } });
  });

  it("plans the proof in words and offers the project's lemmas to every attempt", async () => {
    const { provider, calls } = fakeModel("<think>hmm</think>1. Induct on n.\n2. Close each case with nlinarith.");
    const events: PrepareEvent[] = [];
    const r = await prepare({
      frozen: FROZEN,
      provider,
      model: "m",
      check: async () => check({ status: "sorries" }),
      checkStatement: true,
      idea: true,
      lemmas: [{ file: "Sq/Pos.lean", source: "theorem sq_pos' (n : ℕ) (h : 0 < n) : 0 < n ^ 2 := by positivity" }],
      onEvent: (e) => e.type !== "status" && events.push(e),
    });
    expect(r.stop).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0].messages[1].content).toContain("theorem le_sq");
    expect(events.map((e) => e.type)).toEqual(["statementCheck", "idea"]);
    expect(events[1]).toEqual({ type: "idea", text: "1. Induct on n.\n2. Close each case with nlinarith." });
    expect(r.notes).toContain("Induct on n");
    expect(r.notes).toContain("theorem sq_pos'");
  });

  it("asks nothing when both steps are off", async () => {
    const { provider, calls } = fakeModel("unused");
    const r = await prepare({ frozen: FROZEN, provider, model: "m", checkStatement: false, idea: false, onEvent: () => {} });
    expect(calls).toHaveLength(0);
    expect(r).toEqual({ notes: "" });
  });
});

describe("the project's lemma library", () => {
  it("drops import and option lines from a proof file", () => {
    expect(lemmaSource("import Mathlib\nset_option maxHeartbeats 400000\n\ntheorem a : 1 = 1 := rfl\n")).toBe("theorem a : 1 = 1 := rfl");
  });

  it("keeps the newest lemmas within its size limit", () => {
    expect(lemmaNote([])).toBe("");
    const big = "x".repeat(7000);
    const note = lemmaNote([
      { file: "A.lean", source: `theorem a : True := trivial -- ${big}` },
      { file: "B.lean", source: `theorem b : True := trivial -- ${big}` },
    ]);
    expect(note).toContain("-- from A.lean");
    expect(note).not.toContain("-- from B.lean");
    expect(note).toContain("the 1 newest of 2");
  });
});
