// Starter problems, from warm-up to genuinely hard for a model.

export type Example = { title: string; level: "Warm-up" | "Easy" | "Medium" | "Hard"; source: string };

export const EXAMPLES: Example[] = [
  {
    title: "Addition commutes",
    level: "Warm-up",
    source: `import Mathlib

theorem add_comm_example (a b : ℕ) : a + b = b + a :=
sorry
`,
  },
  {
    title: "Sum of the first n odd numbers",
    level: "Easy",
    source: `import Mathlib

open Finset

theorem sum_odd (n : ℕ) : ∑ i ∈ range n, (2 * i + 1) = n ^ 2 :=
sorry
`,
  },
  {
    title: "Arithmetic–geometric mean, two variables",
    level: "Medium",
    source: `import Mathlib

theorem am_gm_two (a b : ℝ) (ha : 0 ≤ a) (hb : 0 ≤ b) : Real.sqrt (a * b) ≤ (a + b) / 2 :=
sorry
`,
  },
  {
    title: "Cauchy–Schwarz in two dimensions",
    level: "Hard",
    source: `import Mathlib

theorem cs_two (a b c d : ℝ) : (a * c + b * d) ^ 2 ≤ (a ^ 2 + b ^ 2) * (c ^ 2 + d ^ 2) :=
sorry
`,
  },
  {
    title: "Infinitely many primes",
    level: "Medium",
    source: `import Mathlib

theorem exists_prime_ge (n : ℕ) : ∃ p, n ≤ p ∧ Nat.Prime p :=
sorry
`,
  },
  {
    title: "√2 is irrational",
    level: "Medium",
    source: `import Mathlib

theorem sqrt_two_irrational : Irrational (Real.sqrt 2) :=
sorry
`,
  },
  {
    title: "A divisibility identity",
    level: "Easy",
    source: `import Mathlib

theorem six_dvd (n : ℕ) : 6 ∣ n * (n + 1) * (2 * n + 1) :=
sorry
`,
  },
];
