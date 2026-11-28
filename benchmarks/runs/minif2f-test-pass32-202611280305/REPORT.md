# Mack benchmark: miniF2F test, 15/20 solved (75.0%)

- Run 1795835151070, 2026-11-28T03:05:13.061Z, done; run with Mack 0.2.56, report by Mack 0.2.56
- Ran on 20 machines in parallel, each GitHub Actions ubuntu-latest, 16 GB, 4 CPUs, Lake version 5.0.0-src+c9afcdd (Lean version 4.36.0-rc1); Lean REPL on; Lean deadline 600s; 2 Lean processes
- Harness: Mack 0.2.56, Open Math Harness 687f2a2; procedures: strict verifier, linters off, pass@32: independent samples, checked as written, replies up to 32k tokens, thinking high
- Method: Attempts (Mack); model deepseek-v4.1-flash; no prover model
- Thinking level: high
- 32 attempts, 8 at once, revisions before starting over 1; automation off; premise selection off; easier versions first off
- Spent $2.221 in 93 min; 0 solved by Lean's automation alone; budget $10

## Failures by reason

- **Reply cut off before the proof**: 5 (imo_1992_p1, imo_2001_p6, amc12_2001_p5, amc12b_2020_p21, imo_1969_p2). the reply hit its token limit while the model was still working, so no proof reached Lean: a longer reply limit, or a lower thinking level.

## All 220 attempts by how they ended

- Reply cut off before the proof: 154 (70%)
- Other Lean errors: 18 (8%)
- Verified: 15 (7%)
- Type mismatch: 10 (5%)
- Tactics after the goal was closed: 9 (4%)
- Tactics did not close goals: 6 (3%)
- Lean timed out: 5 (2%)
- Wrong lemma names: 3 (1%)

## Commonest Lean errors

| Error | Attempts | Problems |
|---|---|---|
| the frozen theorem statement must appear verbatim; it is, byte for byte: | 154 | 6 |
| No goals to be solved | 10 | 5 |
| unexpected token `…`; expected command | 9 | 4 |
| unexpected token `…`; expected `…` | 8 | 2 |
| unsolved goals | 6 | 3 |
| Type mismatch | 4 | 3 |
| Tactic `…` failed: Did not find an occurrence of the pattern | 4 | 3 |
| Application type mismatch: The argument | 3 | 3 |
| failed to synthesize instance of type class | 2 | 2 |
| Unknown constant `…` | 2 | 2 |
| Tactic `…` failed: invalid equality proof, it is not of the form (x = t) or (t = x) | 2 | 1 |
| `…` has already been declared | 1 | 1 |

## Results

| Problem | Outcome | Attempts | Time | Cost | Reason |
|---|---|---|---|---|---|
| mathd_algebra_598 | solved | 6 | 114s | $0.029 |  |
| imo_1992_p1 | failed | 32 | 627s | $0.356 | Reply cut off before the proof |
| imo_2001_p6 | failed | 32 | 586s | $0.356 | Reply cut off before the proof |
| amc12a_2019_p12 | solved | 1 | 88s | $0.004 |  |
| aime_1997_p9 | solved | 5 | 98s | $0.031 |  |
| mathd_algebra_513 | solved | 1 | 30s | $0.001 |  |
| mathd_numbertheory_618 | solved | 1 | 47s | $0.001 |  |
| amc12_2001_p5 | failed | 32 | 824s | $0.340 | Reply cut off before the proof |
| amc12b_2020_p22 | solved | 4 | 88s | $0.017 |  |
| amc12b_2020_p21 | failed | 32 | 845s | $0.354 | Reply cut off before the proof |
| imo_1969_p2 | failed | 32 | 821s | $0.353 | Reply cut off before the proof |
| numbertheory_notEquiv2i2jasqbsqdiv8 | solved | 1 | 22s | $0.001 |  |
| amc12b_2020_p13 | solved | 4 | 98s | $0.018 |  |
| induction_sumkexp3eqsumksq | solved | 2 | 129s | $0.012 |  |
| imo_1963_p5 | solved | 1 | 89s | $0.004 |  |
| aime_1988_p8 | solved | 1 | 79s | $0.003 |  |
| imo_1983_p6 | solved | 1 | 107s | $0.010 |  |
| induction_pord1p1on2powklt5on2 | solved | 30 | 795s | $0.324 |  |
| mathd_numbertheory_728 | solved | 1 | 32s | $0.003 |  |
| aime_1989_p8 | solved | 1 | 34s | $0.003 |  |

## Unsolved problems

### imo_1992_p1: Reply cut off before the proof

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

### imo_2001_p6: Reply cut off before the proof

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

### amc12_2001_p5: Reply cut off before the proof

Attempts ended: errors 14, refused 18.

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

### amc12b_2020_p21: Reply cut off before the proof

Attempts ended: errors 7, refused 25.

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

### imo_1969_p2: Reply cut off before the proof

Attempts ended: errors 8, refused 24.

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
