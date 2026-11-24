import { describe, expect, it } from "vitest";
import type { RawCommand, RawTactic, ReplSession } from "../core/lean/repl";
import type { RunResult } from "../core/lean/verify";
import type { ChatRequest, ModelProvider } from "../core/model/provider";
import type { ProveEvent } from "../core/prove";
import { assemble, parseTactics, score, stepSearch } from "../core/stepsearch";

const frozen = "import Mathlib\n\ntheorem t (p q : Prop) (hq : q) : p → q := by\n  sorry\n";

describe("step-by-step search", () => {
  it("reads the tactics of a reply, one per line, without numbering or sorry", () => {
    expect(parseTactics("Some thoughts\n```lean\n1. intro h\n- exact hq -- done\nsorry\nintro h\n```", 4)).toEqual(["intro h", "exact hq"]);
    expect(parseTactics("omega\nsimp\nlinarith\nnorm_num\npositivity", 3)).toEqual(["omega", "simp", "linarith"]);
  });

  it("prefers states with fewer and smaller goals", () => {
    expect(score({ goals: ["⊢ a"], tactics: ["x"], expanded: 0 })).toBeLessThan(score({ goals: ["⊢ a", "⊢ b"], tactics: [], expanded: 0 }));
    expect(score({ goals: ["⊢ a"], tactics: [], expanded: 0 })).toBeLessThan(score({ goals: ["⊢ a"], tactics: [], expanded: 1 }));
  });

  it("puts the tactic script in place of the proof", () => {
    expect(assemble(frozen, ["intro h", "exact hq"])).toBe("import Mathlib\n\ntheorem t (p q : Prop) (hq : q) : p → q := by\n  intro h\n  exact hq\n");
  });

  it("keeps the steps Lean accepts, and the verifier has the last word", async () => {
    // A toy REPL: `intro h` opens state 1, `exact hq` closes it; everything else is an error.
    const session = async <T>(_h: string, fn: (s: ReplSession) => Promise<T>) =>
      fn({
        mathlibEnv: 0,
        command: async (): Promise<RawCommand> => ({ env: 1, sorries: [{ pos: { line: 4, column: 2 }, goal: "p q : Prop\nhq : q\n⊢ p → q", proofState: 0 }] }),
        tactic: async (tactic: string, ps: number): Promise<RawTactic> => {
          if (ps === 0 && tactic.includes("(intro h)")) return { proofState: 1, goals: ["p q : Prop\nhq : q\nh : p\n⊢ q"] };
          if (ps === 1 && tactic.includes("(exact hq)")) return { proofState: 2, goals: [] };
          return { messages: [{ severity: "error", pos: { line: 1, column: 0 }, data: "tactic failed" }] };
        },
      });
    const run = async (src: string): Promise<RunResult> => {
      const marker = /#print "(mack-report-[0-9a-f]+)"/.exec(src)?.[1];
      const thm = /#print axioms (\S+)/.exec(src)?.[1];
      if (!marker || !thm) return { kind: "ok", output: "" };
      return { kind: "ok", output: `${marker}\n'${thm}' depends on axioms: [propext]\n${thm} : P\n` };
    };
    const replies = ["```lean\nsimp_all_bogus\nintro h\n```", "```lean\nexact hq\n```"];
    const asked: string[] = [];
    const provider: ModelProvider = {
      name: "fake",
      listModels: async () => [],
      chat: async (r: ChatRequest) => {
        asked.push(r.messages[1].content);
        return { content: replies.shift() ?? "```lean\nrfl\n```" };
      },
    };
    const events: ProveEvent[] = [];
    await stepSearch({ frozen, provider, model: "m", session, run, maxCalls: 5, onEvent: (e) => events.push(e) });
    const solved = events.find((e): e is Extract<ProveEvent, { type: "solved" }> => e.type === "solved");
    expect(solved?.proof).toContain("  intro h\n  exact hq\n");
    expect(asked).toHaveLength(2);
    // The second call is told the step taken and the goal it left.
    expect(asked[1]).toContain("  intro h");
    expect(asked[1]).toContain("h : p\n⊢ q");
    const attempts = events.filter((e): e is Extract<ProveEvent, { type: "attempt" }> => e.type === "attempt");
    expect(attempts[0].detail).toContain("simp_all_bogus  -- error: tactic failed");
    expect(attempts[0].outcome).toBe("sorries");
    expect(attempts[attempts.length - 1].outcome).toBe("verified");
  });

  it("says why when it finds nothing", async () => {
    const session = async <T>(_h: string, fn: (s: ReplSession) => Promise<T>) =>
      fn({ mathlibEnv: 0, command: async () => ({ env: 1, sorries: [{ pos: { line: 4, column: 2 }, goal: "⊢ False", proofState: 0 }] }), tactic: async () => ({ message: "nope" }) });
    const run = async (src: string): Promise<RunResult> => {
      const marker = /#print "(mack-report-[0-9a-f]+)"/.exec(src)?.[1];
      const thm = /#print axioms (\S+)/.exec(src)?.[1];
      return marker && thm ? { kind: "ok", output: `${marker}\n'${thm}' depends on axioms: [propext]\n${thm} : P\n` } : { kind: "ok", output: "" };
    };
    const provider: ModelProvider = { name: "fake", listModels: async () => [], chat: async () => ({ content: "```lean\ntrivial\n```" }) };
    const events: ProveEvent[] = [];
    await stepSearch({ frozen, provider, model: "m", session, run, maxCalls: 4, onEvent: (e) => events.push(e) });
    const failed = events.find((e): e is Extract<ProveEvent, { type: "failed" }> => e.type === "failed");
    expect(failed?.message).toMatch(/^No proof step by step after 3 model calls: every proof state was a dead end\.$/);
  });
});
