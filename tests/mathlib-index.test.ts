import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { describeDecls, MathlibIndex, parseDecls, searchDecls, similarNames, unknownNames, words } from "../core/lean/mathlib-index";

const SOURCE = `/-
Copyright (c) 2017 Someone. All rights reserved.
-/
import Mathlib.Data.Nat.Basic

/-! # Primes

theorem not_a_decl : True := trivial
-/

namespace Nat

/-- A prime is at least two. -/
@[simp]
theorem Prime.two_le {p : ℕ} (hp : p.Prime) : 2 ≤ p :=
  hp.two_le'

lemma exists_infinite_primes (n : ℕ) :
    ∃ p, n ≤ p ∧ Nat.Prime p := by
  sorry

section Helpers
variable {a b : ℕ}

protected theorem add_comm' (a b : ℕ) : a + b = b + a := Nat.add_comm a b

end Helpers

theorem _root_.Odd.pos_of_odd {n : ℕ} (h : Odd n) : 0 < n := sorry

instance : Inhabited ℕ := ⟨0⟩

def sqrtFloor (n : ℕ) : ℕ := n

end Nat

structure Foo where
  x : ℕ
`;

describe("reading Mathlib's declarations", () => {
  const decls = parseDecls(SOURCE, "Mathlib.NumberTheory.Primes");

  it("keeps names with their namespaces, statements, kinds and doc comments", () => {
    expect(decls.map((d) => d.name)).toEqual(["Nat.Prime.two_le", "Nat.exists_infinite_primes", "Nat.add_comm'", "Odd.pos_of_odd", "Nat.sqrtFloor", "Foo"]);
    expect(decls[0]).toEqual({ name: "Nat.Prime.two_le", kind: "theorem", sig: "{p : ℕ} (hp : p.Prime) : 2 ≤ p", module: "Mathlib.NumberTheory.Primes", doc: "A prime is at least two." });
    expect(decls[1].sig).toBe("(n : ℕ) : ∃ p, n ≤ p ∧ Nat.Prime p");
    expect(decls[1].kind).toBe("theorem");
    expect(decls[4].kind).toBe("def");
    expect(decls[5]).toMatchObject({ kind: "structure", sig: "" });
  });

  it("splits names and queries into words", () => {
    expect(words("Nat.Prime.two_le")).toEqual(["nat", "prime", "two", "le"]);
    expect(words("sqrtFloor")).toEqual(["sqrt", "floor"]);
  });

  it("finds a declaration by words of its name or statement, or by its name", () => {
    expect(searchDecls(decls, "prime two le")[0].name).toBe("Nat.Prime.two_le");
    expect(searchDecls(decls, "infinite primes").map((d) => d.name)).toEqual(["Nat.exists_infinite_primes"]);
    expect(searchDecls(decls, "two_le")[0].name).toBe("Nat.Prime.two_le");
    expect(searchDecls(decls, "Odd.pos_of_odd")[0].name).toBe("Odd.pos_of_odd");
    expect(searchDecls(decls, "zeta function")).toEqual([]);
  });

  it("offers real names for one Lean did not know", () => {
    expect(unknownNames("error: unknown identifier 'Nat.prime_two_le'\nerror: unknown constant 'Nat.foo'")).toEqual(["Nat.prime_two_le", "Nat.foo"]);
    expect(similarNames(decls, "Nat.prime_two_le")[0].name).toBe("Nat.Prime.two_le");
  });

  it("tells the model to confirm what it found, and that a miss proves nothing", () => {
    expect(describeDecls(searchDecls(decls, "two le"), "two le")).toContain("#check");
    expect(describeDecls([], "zeta")).toContain("does not prove a name is absent");
  });
});

describe("the index of a workspace's Mathlib", () => {
  it("is built from the source once, then read from its cache", async () => {
    const ws = mkdtempSync(join(tmpdir(), "mack-ws-"));
    const src = join(ws, ".lake", "packages", "mathlib", "Mathlib", "NumberTheory");
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, "Primes.lean"), SOURCE);
    writeFileSync(join(ws, "lake-manifest.json"), JSON.stringify({ packages: [{ name: "mathlib", rev: "abc123" }] }));
    const cache = join(ws, "cache", "mathlib.json");
    const first = await new MathlibIndex(ws, cache).load();
    expect(first.find((d) => d.name === "Nat.Prime.two_le")?.module).toBe("Mathlib.NumberTheory.Primes");
    // A second index of the same version reads the cache, even with the source gone.
    writeFileSync(join(src, "Primes.lean"), "");
    expect(await new MathlibIndex(ws, cache).load()).toHaveLength(first.length);
    await expect(new MathlibIndex(mkdtempSync(join(tmpdir(), "mack-empty-")), cache).load()).rejects.toThrow("Mathlib's source is not in the Lean workspace");
  });
});
