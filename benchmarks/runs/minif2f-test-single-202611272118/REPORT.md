# Mack benchmark: miniF2F test, 14/20 solved (70.0%)

- Run 1795814332704, 2026-11-27T21:18:40.188Z, done; run with Mack 0.2.0, report by Mack 0.2.0
- Ran on 5 machines in parallel, each GitHub Actions ubuntu-latest, 16 GB, 4 CPUs, Lake version 5.0.0-src+c9afcdd (Lean version 4.36.0-rc1); Lean REPL on; Lean deadline 600s; 2 Lean processes
- Harness: Mack 0.2.0, Open Math Harness 687f2a2; procedures: strict verifier, linters off, pass@32: independent samples, checked as written, replies up to 32k tokens
- Method: Attempts (Mack); model deepseek-v4.1-flash; no prover model
- Thinking level: each model's default
- 32 attempts, 8 at once, revisions before starting over 1; automation off; premise selection off; easier versions first off
- Spent $2.124 in 82 min; 0 solved by Lean's automation alone; budget $15

## Failures by reason

- **Statement changed or forbidden**: 6 (imo_1992_p1, imo_2001_p6, amc12_2001_p5, amc12b_2020_p21, imo_1969_p2, induction_pord1p1on2powklt5on2). the attempts edited the theorem or used a banned shortcut: a prover model that follows the format.

## All 216 attempts by how they ended

- Statement changed or forbidden: 167 (77%)
- Verified: 14 (6%)
- Other Lean errors: 14 (6%)
- Wrong lemma names: 6 (3%)
- Tactics did not close goals: 4 (2%)
- Lean timed out: 4 (2%)
- Tactics after the goal was closed: 4 (2%)
- Type mismatch: 3 (1%)

## Commonest Lean errors

| Error | Attempts | Problems |
|---|---|---|
| the frozen theorem statement must appear verbatim; it is, byte for byte: | 167 | 6 |
| unexpected token `…`; expected `…` | 9 | 2 |
| unsolved goals | 5 | 5 |
| Unknown constant `…` | 4 | 2 |
| Tactic `…` failed: Did not find an occurrence of the pattern | 4 | 4 |
| unexpected token `…`; expected command | 3 | 2 |
| Unknown identifier `…` | 3 | 3 |
| No goals to be solved | 3 | 2 |
| failed to synthesize instance of type class | 1 | 1 |
| Invalid projection: Projections cannot be used on functions, and | 1 | 1 |
| Type mismatch: After simplification, term | 1 | 1 |
| Application type mismatch: The argument | 1 | 1 |

## Results

| Problem | Outcome | Attempts | Time | Cost | Reason |
|---|---|---|---|---|---|
| mathd_algebra_598 | solved | 2 | 58s | $0.009 |  |
| imo_1992_p1 | failed | 32 | 686s | $0.346 | Statement changed or forbidden |
| imo_2001_p6 | failed | 32 | 766s | $0.346 | Statement changed or forbidden |
| amc12a_2019_p12 | solved | 1 | 69s | $0.007 |  |
| aime_1997_p9 | solved | 3 | 53s | $0.006 |  |
| mathd_algebra_513 | solved | 1 | 27s | $0.001 |  |
| mathd_numbertheory_618 | solved | 1 | 36s | $0.001 |  |
| amc12_2001_p5 | failed | 32 | 681s | $0.321 | Statement changed or forbidden |
| amc12b_2020_p22 | solved | 3 | 67s | $0.009 |  |
| amc12b_2020_p21 | failed | 32 | 684s | $0.344 | Statement changed or forbidden |
| imo_1969_p2 | failed | 32 | 687s | $0.343 | Statement changed or forbidden |
| numbertheory_notEquiv2i2jasqbsqdiv8 | solved | 1 | 27s | $0.002 |  |
| amc12b_2020_p13 | solved | 3 | 83s | $0.014 |  |
| induction_sumkexp3eqsumksq | solved | 1 | 78s | $0.005 |  |
| imo_1963_p5 | solved | 3 | 116s | $0.017 |  |
| aime_1988_p8 | solved | 2 | 63s | $0.006 |  |
| imo_1983_p6 | solved | 1 | 62s | $0.004 |  |
| induction_pord1p1on2powklt5on2 | failed | 32 | 675s | $0.342 | Statement changed or forbidden |
| mathd_numbertheory_728 | solved | 1 | 19s | $0.001 |  |
| aime_1989_p8 | solved | 1 | 15s | $0.001 |  |

## Unsolved problems

### imo_1992_p1: Statement changed or forbidden

Attempts ended: refused 31, errors 1.

Run message: No verified proof after 32 attempts.

Statement:
```lean
import Mathlib

set_option maxHeartbeats 400000

open BigOperators Real Nat Topology Rat

theorem imo_1992_p1
  (p q r : ℤ)
  (h₀ : 1 < p ∧ p < q ∧ q < r)
  (h₁ : (p - 1) * (q - 1) * (r - 1)∣(p * q * r - 1)) :
  (p, q, r) = (2, 4, 8) ∨ (p, q, r) = (3, 5, 15) := by sorry
```

Lean's last feedback:
```
the frozen theorem statement must appear verbatim; it is, byte for byte:
theorem imo_1992_p1
  (p q r : ℤ)
  (h₀ : 1 < p ∧ p < q ∧ q < r)
  (h₁ : (p - 1) * (q - 1) * (r - 1)∣(p * q * r - 1)) :
  (p, q, r) = (2, 4, 8) ∨ (p, q, r) = (3, 5, 15) :=
```

Last attempt:
```lean

```

### imo_2001_p6: Statement changed or forbidden

Attempts ended: refused 32.

Run message: No verified proof after 32 attempts.

Statement:
```lean
import Mathlib

set_option maxHeartbeats 400000

open BigOperators Real Nat Topology Rat

theorem imo_2001_p6
  (a b c d : ℕ)
  (h₀ : 0 < a ∧ 0 < b ∧ 0 < c ∧ 0 < d)
  (h₁ : d < c)
  (h₂ : c < b)
  (h₃ : b < a)
  (h₄ : a * c + b * d = (b + d + a - c) * (b + d + c - a)) :
  ¬ Nat.Prime (a * b + c * d) := by sorry
```

Lean's last feedback:
```
the frozen theorem statement must appear verbatim; it is, byte for byte:
theorem imo_2001_p6
  (a b c d : ℕ)
  (h₀ : 0 < a ∧ 0 < b ∧ 0 < c ∧ 0 < d)
  (h₁ : d < c)
  (h₂ : c < b)
  (h₃ : b < a)
  (h₄ : a * c + b * d = (b + d + a - c) * (b + d + c - a)) :
  ¬ Nat.Prime (a * b + c * d) :=
```

Last attempt:
```lean

```

### amc12_2001_p5: Statement changed or forbidden

Attempts ended: errors 13, refused 19.

Run message: No verified proof after 32 attempts.

Statement:
```lean
import Mathlib

set_option maxHeartbeats 400000

open BigOperators Real Nat Topology Rat

theorem amc12_2001_p5 :
  Finset.prod (Finset.filter (λ x => ¬ Even x) (Finset.range 10000)) (id : ℕ → ℕ) = (10000!) / ((2^5000) * (5000!)) := by sorry
```

Lean's last feedback:
```
the frozen theorem statement must appear verbatim; it is, byte for byte:
theorem amc12_2001_p5 :
  Finset.prod (Finset.filter (λ x => ¬ Even x) (Finset.range 10000)) (id : ℕ → ℕ) = (10000!) / ((2^5000) * (5000!)) :=
```

Last attempt:
```lean

```

### amc12b_2020_p21: Statement changed or forbidden

Attempts ended: errors 5, refused 27.

Run message: No verified proof after 32 attempts.

Statement:
```lean
import Mathlib

set_option maxHeartbeats 400000

open BigOperators Real Nat Topology Rat

theorem amc12b_2020_p21
  (S : Finset ℕ)
  (h₀ : ∀ (n : ℕ), n ∈ S ↔ 0 < n ∧ (↑n + (1000 : ℝ)) / 70 = Int.floor (Real.sqrt n)) :
  S.card = 6 := by sorry
```

Lean's last feedback:
```
the frozen theorem statement must appear verbatim; it is, byte for byte:
theorem amc12b_2020_p21
  (S : Finset ℕ)
  (h₀ : ∀ (n : ℕ), n ∈ S ↔ 0 < n ∧ (↑n + (1000 : ℝ)) / 70 = Int.floor (Real.sqrt n)) :
  S.card = 6 :=
```

Last attempt:
```lean

```

### imo_1969_p2: Statement changed or forbidden

Attempts ended: refused 30, errors 2.

Run message: No verified proof after 32 attempts.

Statement:
```lean
import Mathlib

set_option maxHeartbeats 400000

open BigOperators Real Nat Topology Rat

theorem imo_1969_p2
  (m n : ℝ)
  (k : ℕ)
  (a : ℕ → ℝ)
  (y : ℝ → ℝ)
  (h₀ : 0 < k)
  (h₁ : ∀ x, y x = ∑ i ∈ Finset.range k, ((Real.cos (a i + x)) / (2^i)))
  (h₂ : y m = 0)
  (h₃ : y n = 0) :
  ∃ t : ℤ, m - n = t * π := by sorry
```

Lean's last feedback:
```
the frozen theorem statement must appear verbatim; it is, byte for byte:
theorem imo_1969_p2
  (m n : ℝ)
  (k : ℕ)
  (a : ℕ → ℝ)
  (y : ℝ → ℝ)
  (h₀ : 0 < k)
  (h₁ : ∀ x, y x = ∑ i ∈ Finset.range k, ((Real.cos (a i + x)) / (2^i)))
  (h₂ : y m = 0)
  (h₃ : y n = 0) :
  ∃ t : ℤ, m - n = t * π :=
```

Last attempt:
```lean

```

### induction_pord1p1on2powklt5on2: Statement changed or forbidden

Attempts ended: refused 28, errors 4.

Run message: No verified proof after 32 attempts.

Statement:
```lean
import Mathlib

set_option maxHeartbeats 400000

open BigOperators Real Nat Topology Rat

theorem induction_pord1p1on2powklt5on2
  (n : ℕ)
  (h₀ : 0 < n) :
  ∏ k ∈ Finset.Icc 1 n, (1 + (1:ℝ) / 2^k) < 5 / 2 := by sorry
```

Lean's last feedback:
```
the frozen theorem statement must appear verbatim; it is, byte for byte:
theorem induction_pord1p1on2powklt5on2
  (n : ℕ)
  (h₀ : 0 < n) :
  ∏ k ∈ Finset.Icc 1 n, (1 + (1:ℝ) / 2^k) < 5 / 2 :=
```

Last attempt:
```lean

```

## How to read this report

- **Solved.** Lean's strict verifier accepted the proof: the statement is unchanged, no sorry or extra axiom is used, and Lean's kernel checks it. Nothing else counts, whatever the model says.
- **The problems.** miniF2F has 244 competition problems (AIME, AMC, IMO, MATH exercises); PutnamBench has Putnam problems since 1962 and is much harder. The same number of problems always picks the same ones, so runs compare.
- **Methods.** Attempts: the model writes whole proofs and fixes them from Lean's errors. Decompose: if that fails, the statement is split into lemmas that are proved separately and put back together. Step by step: the proof is built one tactic at a time on Lean's live proof states, keeping only steps Lean accepts.
- **Solve rate and cost.** In the app, solved problems out of those tried; on the public site, out of the whole sample, so a skipped problem counts as unsolved. Per solve is the run's whole cost divided by the problems solved. Cost, time and tokens are as the run reported them.
- **Attempts.** One attempt is one proof the model wrote and Lean checked. Attempts per solve is how many the solved problems took on average; fewer means the model gets there sooner.
- **By automation alone.** Problems Lean's own tactics (omega, simp, linarith, aesop, …) closed before any model call: free, and a floor every model starts from.
- **Why not solved.** Each failed attempt is labelled from Lean's errors: wrong lemma names, type mismatch, goals left open, timeouts, and so on. A problem's reason is its most common one; its timeline shows every attempt.
- **Range.** The 95% range of a solve rate: with few problems it is wide (13 of 20 is 43–82%), so two runs are only told apart when their ranges barely overlap. Runs are ranked only against runs of the same size, which faced the same problems.
- **Solved within k.** How many problems were solved within 1, 4, 16 or 64 model attempts. Like the labs' pass@k, but Mack's attempts learn from Lean's errors where pass@k samples independently, so compare with care.
- **Recent problems.** The latest Putnam competitions, as a contamination check: a model trained before they were set cannot have memorized their proofs. A big drop from older problems suggests memory helped there.
- **Mack's own failures.** If Lean could not start, crashed or lost its connection, the attempt is labelled "Mack or Lean failed to run", never blamed on the model. Many of these mean something to fix in Mack or the setup, not in the model.
