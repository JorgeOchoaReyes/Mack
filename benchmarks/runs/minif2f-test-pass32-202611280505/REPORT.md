# Mack benchmark: miniF2F test, 12/20 solved (60.0%)

- Run 1795842359938, 2026-11-28T05:05:41.106Z, done; run with Mack 0.2.56, report by Mack 0.2.56
- Ran on 20 machines in parallel, each GitHub Actions ubuntu-latest, 15 GB, 4 CPUs, Lake version 5.0.0-src+c9afcdd (Lean version 4.36.0-rc1); Lean REPL on; Lean deadline 600s; 2 Lean processes
- Harness: Mack 0.2.56, Open Math Harness 687f2a2; procedures: strict verifier, linters off, pass@32: independent samples, checked as written, replies up to 32k tokens, thinking high
- Method: Attempts (Mack); model glm-5.3; no prover model
- Thinking level: high
- 32 attempts, 8 at once, revisions before starting over 1; automation off; premise selection off; easier versions first off
- Spent $11.053 in 280 min; 0 solved by Lean's automation alone; budget $20

## Failures by reason

- **Reply cut off before the proof**: 8 (imo_1992_p1, imo_2001_p6, mathd_numbertheory_618, amc12_2001_p5, amc12b_2020_p22, amc12b_2020_p21, imo_1969_p2, amc12b_2020_p13). the reply hit its token limit while the model was still working, so no proof reached Lean: a longer reply limit, or a lower thinking level.

## All 322 attempts by how they ended

- Reply cut off before the proof: 274 (85%)
- Model call failed: 19 (6%)
- Verified: 12 (4%)
- Other Lean errors: 6 (2%)
- Type mismatch: 5 (2%)
- Wrong lemma names: 5 (2%)
- Tactics did not close goals: 1 (0%)

## Commonest Lean errors

| Error | Attempts | Problems |
|---|---|---|
| the frozen theorem statement must appear verbatim; it is, byte for byte: | 274 | 14 |
| Cheaper Inference: The request timed out before the stream completed. | 17 | 5 |
| Tactic `…` failed: Did not find an occurrence of the pattern | 4 | 4 |
| unsolved goals | 3 | 2 |
| Application type mismatch: The argument | 3 | 2 |
| Cheaper Inference: The stream ended before completion. | 2 | 1 |
| Unknown constant `…` | 2 | 2 |
| unexpected identifier; expected `…` | 1 | 1 |
| unexpected token `…`; expected `…` | 1 | 1 |
| unexpected token `…`; expected `…`, `…` | 1 | 1 |
| Function expected at | 1 | 1 |
| Invalid field `…`: The environment does not contain `…`, so it is not possible to project the field `…` from an expression | 1 | 1 |

## Results

| Problem | Outcome | Attempts | Time | Cost | Reason |
|---|---|---|---|---|---|
| mathd_algebra_598 | solved | 9 | 406s | $0.270 |  |
| imo_1992_p1 | failed | 32 | 1435s | $1.238 | Reply cut off before the proof |
| imo_2001_p6 | failed | 30 | 1119s | $1.161 | Reply cut off before the proof |
| amc12a_2019_p12 | solved | 10 | 634s | $0.346 |  |
| aime_1997_p9 | solved | 11 | 633s | $0.339 |  |
| mathd_algebra_513 | solved | 2 | 26s | $0.002 |  |
| mathd_numbertheory_618 | failed | 29 | 1559s | $1.122 | Reply cut off before the proof |
| amc12_2001_p5 | failed | 23 | 2550s | $0.841 | Reply cut off before the proof |
| amc12b_2020_p22 | failed | 32 | 1398s | $1.211 | Reply cut off before the proof |
| amc12b_2020_p21 | failed | 31 | 1551s | $1.200 | Reply cut off before the proof |
| imo_1969_p2 | failed | 28 | 2097s | $1.084 | Reply cut off before the proof |
| numbertheory_notEquiv2i2jasqbsqdiv8 | solved | 2 | 35s | $0.007 |  |
| amc12b_2020_p13 | failed | 32 | 1385s | $1.212 | Reply cut off before the proof |
| induction_sumkexp3eqsumksq | solved | 2 | 159s | $0.027 |  |
| imo_1963_p5 | solved | 9 | 361s | $0.313 |  |
| aime_1988_p8 | solved | 9 | 480s | $0.324 |  |
| imo_1983_p6 | solved | 1 | 302s | $0.036 |  |
| induction_pord1p1on2powklt5on2 | solved | 9 | 626s | $0.313 |  |
| mathd_numbertheory_728 | solved | 1 | 24s | $0.001 |  |
| aime_1989_p8 | solved | 1 | 33s | $0.007 |  |

## Unsolved problems

### imo_1992_p1: Reply cut off before the proof

Attempts ended: refused 32.

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
a
```

### imo_2001_p6: Reply cut off before the proof

Attempts ended: refused 30, model error 2.

Run message: No verified proof after 32 attempts. The last model call failed: Cheaper Inference: The request timed out before the stream completed.

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
Cheaper Inference: The request timed out before the stream completed.
```

Last attempt:
```lean

```

### mathd_numbertheory_618: Reply cut off before the proof

Attempts ended: refused 29, model error 3.

Run message: No verified proof after 32 attempts. The last model call failed: Cheaper Inference: The stream ended before completion.

Statement:
```lean
import Mathlib

set_option maxHeartbeats 400000

open BigOperators Real Nat Topology Rat

theorem mathd_numbertheory_618
  (n : ℕ)
  (hn : n > 0)
  (p : ℕ → ℕ)
  (h₀ : ∀ x, p x = x^2 - x + 41)
  (h₁ : 1 < Nat.gcd (p n) (p (n+1))) :
  41 ≤ n := by sorry
```

Lean's last feedback:
```
Cheaper Inference: The stream ended before completion.
```

Last attempt:
```lean
--
```

### amc12_2001_p5: Reply cut off before the proof

Attempts ended: refused 20, errors 3, model error 9.

Run message: No verified proof after 32 attempts. The last model call failed: Cheaper Inference: The request timed out before the stream completed.

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
Cheaper Inference: The request timed out before the stream completed.
```

Last attempt:
```lean
```
```

### amc12b_2020_p22: Reply cut off before the proof

Attempts ended: refused 31, errors 1.

Run message: No verified proof after 32 attempts.

Statement:
```lean
import Mathlib

set_option maxHeartbeats 400000

open BigOperators Real Nat Topology Rat

theorem amc12b_2020_p22
  (t : ℝ) :
  ((2^t - 3 * t) * t) / (4^t) ≤ 1 / 12 := by sorry
```

Lean's last feedback:
```
the frozen theorem statement must appear verbatim; it is, byte for byte:
theorem amc12b_2020_p22
  (t : ℝ) :
  ((2^t - 3 * t) * t) / (4^t) ≤ 1 / 12 :=
```

Last attempt:
```lean
```
```

### amc12b_2020_p21: Reply cut off before the proof

Attempts ended: refused 31, model error 1.

Run message: No verified proof after 32 attempts. The last model call failed: Cheaper Inference: The request timed out before the stream completed.

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

Attempts ended: refused 28, model error 4.

Run message: No verified proof after 32 attempts. The last model call failed: Cheaper Inference: The request timed out before the stream completed.

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
Cheaper Inference: The request timed out before the stream completed.
```

Last attempt:
```lean
y
```

### amc12b_2020_p13: Reply cut off before the proof

Attempts ended: errors 4, refused 28.

Run message: No verified proof after 32 attempts.

Statement:
```lean
import Mathlib

set_option maxHeartbeats 400000

open BigOperators Real Nat Topology Rat

theorem amc12b_2020_p13 :
  Real.sqrt (Real.log 6 / Real.log 2 + Real.log 6 / Real.log 3) = Real.sqrt (Real.log 3 / Real.log 2) + Real.sqrt (Real.log 2 / Real.log 3) := by sorry
```

Lean's last feedback:
```
the frozen theorem statement must appear verbatim; it is, byte for byte:
theorem amc12b_2020_p13 :
  Real.sqrt (Real.log 6 / Real.log 2 + Real.log 6 / Real.log 3) = Real.sqrt (Real.log 3 / Real.log 2) + Real.sqrt (Real.log 2 / Real.log 3) :=
```

Last attempt:
```lean
theorem
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
