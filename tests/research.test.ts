import { describe, expect, it } from "vitest";
import type { LeanCheck } from "../core/lean/check";
import type { RunResult } from "../core/lean/verify";
import type { ChatRequest, ModelProvider } from "../core/model/provider";
import type { ProveEvent } from "../core/prove";
import { critiqueOf, CRITIC_SYSTEM, parsePlans, parseRank, research, roundBudgets, SKETCH_SYSTEM, type ResearchEvent } from "../core/research";

const frozen = "import Mathlib\n\ntheorem t (x : ℕ) : x + 0 = x := by\n  sorry\n";
const run = async (src: string): Promise<RunResult> => {
  const marker = /#print "(mack-report-[0-9a-f]+)"/.exec(src)?.[1];
  const thm = /#print axioms (\S+)/.exec(src)?.[1];
  return marker && thm ? { kind: "ok", output: `${marker}\n'${thm}' depends on axioms: [propext]\n${thm} : P\n` } : { kind: "ok", output: "" };
};
// Lean: a line with `bogus` is an error there; anything else checks.
const check = async (src: string): Promise<LeanCheck> => {
  const line = src.split("\n").findIndex((l) => l.includes("bogus"));
  return line >= 0 ? { status: "errors", errors: [{ line: line + 1, col: 2, message: "unknown identifier 'bogus'" }], sorries: [], output: "" } : { status: "complete", errors: [], sorries: [], output: "" };
};

describe("the research loop's parts", () => {
  it("reads plans, the critic's ranking and its notes on each plan", () => {
    const plans = parsePlans("intro\nPLAN 1: induction on x\nsteps…\n**PLAN 2:** use simp\nPLAN 3: cases", 2);
    expect(plans).toEqual(["induction on x\nsteps…", "use simp"]);
    const critique = "PLAN 1: the base case is fine.\nPLAN 2: simp may loop.\nRANK: 2, 1";
    expect(parseRank(critique, 2)).toEqual([1, 0]);
    expect(parseRank("no ranking", 3)).toEqual([0, 1, 2]);
    expect(critiqueOf(critique, 1)).toBe("simp may loop.");
  });

  it("doubles the attempts from round to round, spending exactly the budget", () => {
    expect(roundBudgets(14, 3)).toEqual([2, 4, 8]);
    expect(roundBudgets(10, 3).reduce((a, b) => a + b, 0)).toBe(10);
    expect(roundBudgets(2, 3)).toEqual([1, 1]);
  });
});

describe("research", () => {
  it("keeps a verified lemma from a failed round, re-plans from the failure, and proves the theorem with the lemma", async () => {
    const asked: { system: string; user: string }[] = [];
    const provider: ModelProvider = {
      name: "fake",
      listModels: async () => [],
      chat: async (r: ChatRequest) => {
        const system = r.messages[0].role === "system" ? r.messages[0].content : "";
        const user = r.messages.map((m) => m.content).join("\n");
        asked.push({ system, user });
        if (system === SKETCH_SYSTEM) return { content: "PLAN 1: rewrite with add_zero.\nPLAN 2: induction on x." };
        if (system === CRITIC_SYSTEM) return { content: "PLAN 1: fine.\nPLAN 2: overkill.\nRANK: 1, 2" };
        if (system.startsWith("You split")) return { content: "no split" };
        // The prover: with the verified helper on offer, it proves the theorem; before, it writes the helper and a broken main proof.
        if (user.includes("theorem helper_ok")) return { content: "```lean\nimport Mathlib\n\ntheorem t (x : ℕ) : x + 0 = x := by\n  exact Nat.add_zero x\n```" };
        return { content: "```lean\nimport Mathlib\n\ntheorem helper_ok (x : ℕ) : x = x := rfl\n\ntheorem t (x : ℕ) : x + 0 = x := by\n  exact bogus\n```" };
      },
    };
    const events: (ProveEvent | ResearchEvent)[] = [];
    await research({ frozen, provider, model: "m", run, check, maxAttempts: 6, rounds: 2, automation: false, onEvent: (e) => events.push(e) });

    const solved = events.find((e): e is Extract<ProveEvent, { type: "solved" }> => e.type === "solved");
    expect(solved?.proof).toContain("exact Nat.add_zero x");
    // Two rounds, plans and a critique each time, and the helper kept from round 1.
    expect(events.filter((e) => e.type === "round").map((e) => (e as Extract<ResearchEvent, { type: "round" }>).round)).toEqual([1, 2]);
    expect(events.some((e) => e.type === "plans")).toBe(true);
    expect(events.find((e): e is Extract<ResearchEvent, { type: "lemma" }> => e.type === "lemma")?.name).toBe("helper_ok");
    // Round 2's plans were told what failed in round 1 and which lemma Lean verified.
    const secondSketch = asked.filter((a) => a.system === SKETCH_SYSTEM)[1];
    expect(secondSketch.user).toContain("unknown identifier 'bogus'");
    expect(secondSketch.user).toContain("theorem helper_ok");
    // Every attempt was told a plan and the referee's notes.
    expect(asked.find((a) => a.system.includes("Lean 4 and Mathlib expert"))?.user).toContain("A referee's notes on this plan");
  });

  it("says what it tried when nothing is proved", async () => {
    const provider: ModelProvider = {
      name: "fake",
      listModels: async () => [],
      chat: async () => ({ content: "```lean\nimport Mathlib\n\ntheorem t (x : ℕ) : x + 0 = x := by\n  exact bogus\n```" }),
    };
    const events: (ProveEvent | ResearchEvent)[] = [];
    await research({ frozen, provider, model: "m", run, check, maxAttempts: 3, rounds: 2, automation: false, onEvent: (e) => events.push(e) });
    const failed = events.find((e): e is Extract<ProveEvent, { type: "failed" }> => e.type === "failed");
    expect(failed?.message).toMatch(/^No verified proof after 2 rounds of research/);
  });
});
