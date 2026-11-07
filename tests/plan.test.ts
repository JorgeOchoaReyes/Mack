import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { describeStatement, EMPTY_PLAN, normalizePlan, provedBy, readPlan, recordProved, writePlan } from "../core/chat/plan";

const GRID = `import Mathlib

/-- **Squares in an \`n × n\` grid, counted by increasing size.**
There are \`(k+1)²\` squares of side \`k+1\`. -/
theorem squares_in_grid (n : ℕ) :
    (∑ k ∈ Finset.range n, (k + 1) ^ 2) = n * (n + 1) * (2 * n + 1) / 6 := by
  sorry
`;

describe("the Proved list", () => {
  it("reads the theorem and its doc comment as plain text", () => {
    expect(describeStatement(GRID)).toEqual({ theorem: "squares_in_grid", summary: "Squares in an n × n grid, counted by increasing size. There are (k+1)² squares of side k+1." });
    expect(describeStatement("theorem foo : True := trivial")).toEqual({ theorem: "foo", summary: undefined });
    expect(describeStatement("def x := 1")).toEqual({});
  });

  it("takes only a verifier's acceptance", () => {
    const v = (output: string, ok = true) => provedBy({ name: "verify_lean", ok, args: { statement_path: "./Grid\\A.lean", proof_path: ".mack/scratch/A.lean" }, output });
    expect(v("accepted: the strict verifier accepts the proof (axioms: none)")).toEqual({ file: "Grid/A.lean", how: "verify_lean", proof: ".mack/scratch/A.lean" });
    expect(v("rejected: the theorem changed")).toBeUndefined();
    expect(v("accepted", false)).toBeUndefined();
    expect(provedBy({ name: "start_proof", ok: true, args: { path: "Grid/B.lean" }, output: "verified: the strict verifier accepted a proof (run 1794 in History; axioms: none)" })).toEqual({ file: "Grid/B.lean", how: "proof_run", proof: "1794" });
    expect(provedBy({ name: "start_proof", ok: true, args: { path: "Grid/B.lean" }, output: "no verified proof (run 3): gave up" })).toBeUndefined();
    expect(provedBy({ name: "write_file", ok: true, args: { path: "accepted.lean" }, output: "accepted" })).toBeUndefined();
  });

  it("cannot be written by plan_update, and a newer verdict on a file replaces the older", async () => {
    let plan = recordProved(EMPTY_PLAN, { file: "A.lean", how: "verify_lean", at: 1 });
    plan = recordProved(plan, { file: "B.lean", how: "proof_run", at: 2 });
    plan = recordProved(plan, { file: "A.lean", how: "proof_run", at: 3 });
    expect(plan.proved?.map((p) => `${p.file}:${p.at}`)).toEqual(["B.lean:2", "A.lean:3"]);
    const after = normalizePlan({ goal: "g", proved: [] }, plan);
    expect(after.proved).toEqual(plan.proved);
    expect(normalizePlan({ proved: [{ file: "Fake.lean", how: "verify_lean", at: 9 }] }, EMPTY_PLAN).proved).toBeUndefined();

    const dir = await mkdtemp(join(tmpdir(), "mack-plan-"));
    try {
      await writePlan(dir, after);
      expect((await readPlan(dir)).proved).toEqual(plan.proved);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("the path to a proof", () => {
  it("lists the writes, checks and verdicts on one statement in order, and keeps the accepted proof", async () => {
    const { proofPath } = await import("../core/chat/path");
    const tool = (at: number, name: string, args: Record<string, unknown>, output: string, ok = true) => ({ role: "tool" as const, at, results: [{ name, args, output, ok }] });
    const s = [
      tool(1, "write_file", { path: "G/A.lean", content: "theorem a : 1 = 1 := by sorry" }, "wrote"),
      tool(2, "write_file", { path: "G/AP.lean", content: "attempt one" }, "wrote"),
      tool(3, "check_lean", { path: "G/AP.lean" }, "status: error\nerrors: 1"),
      tool(4, "verify_lean", { statement_path: "G/A.lean", proof_path: "G/AP.lean" }, "rejected: Lean rejected the file"),
      tool(5, "write_file", { path: "G/Other.lean", content: "unrelated" }, "wrote"),
      tool(6, "write_file", { path: "G/AP.lean", content: "attempt two" }, "wrote"),
      tool(7, "verify_lean", { statement_path: "G/A.lean", proof_path: "G/AP.lean" }, "accepted: the strict verifier accepts the proof (axioms: none)"),
    ];
    const p = proofPath([s as never], "G/A.lean");
    expect(p.steps.map((x) => `${x.kind}:${x.ok}`)).toEqual(["statement:null", "draft:null", "check:false", "verify:false", "draft:null", "verify:true"]);
    expect(p.proof).toBe("attempt two");
  });
});
