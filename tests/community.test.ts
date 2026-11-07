import { describe, expect, it } from "vitest";
import { buildEntry, communityPrBody, ENTRY_FILES, entrySlug, freeSlug } from "../core/community";

describe("community entries", () => {
  it("names a folder from the theorem", () => {
    expect(entrySlug("squares_in_grid")).toBe("squares-in-grid");
    expect(entrySlug("Nat.sumSquares'")).toBe("nat-sum-squares");
    expect(entrySlug("∑∑")).toBe("proof");
    expect(freeSlug("a", new Set(["a", "a-2"]))).toBe("a-3");
  });

  it("holds exactly the allowed files, with the statement and proof unchanged", () => {
    const meta = { theorem: "squares_in_grid", summary: "Squares in a grid.", problem: "grid | squares", contributor: "someone", verifiedBy: "verify_lean" as const, attempts: 6, rejected: 5, sharedAt: "2026-11-07T00:00:00Z" };
    const e = buildEntry({ slug: "squares-in-grid", statement: "theorem t : True := by sorry", proof: "theorem t : True := trivial\n", meta });
    expect(Object.keys(e.files).sort()).toEqual([...ENTRY_FILES].sort());
    expect(e.files["Statement.lean"]).toBe("theorem t : True := by sorry\n");
    expect(e.files["Proof.lean"]).toBe("theorem t : True := trivial\n");
    expect(e.files["README.md"]).toContain("@someone");
    expect(e.files["README.md"]).toContain(String.raw`grid \| squares`);
    expect(e.files["README.md"]).toContain("Found after 6 proof attempts; the verifier rejected 5");
    expect(JSON.parse(e.files["entry.json"])).toEqual(meta);
    expect(communityPrBody(e, meta)).toContain("community/proofs/squares-in-grid/");
  });
});
