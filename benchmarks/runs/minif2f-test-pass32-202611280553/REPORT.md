# Mack benchmark: miniF2F test, 18/20 solved (90.0%)

- Run 1795845212316, 2026-11-28T05:53:03.008Z, done; run with Mack 0.2.58, report by Mack 0.2.58
- Ran on 20 machines in parallel, each GitHub Actions ubuntu-latest, 16 GB, 4 CPUs, Lake version 5.0.0-src+c9afcdd (Lean version 4.36.0-rc1); Lean REPL on; Lean deadline 600s; 2 Lean processes
- Harness: Mack 0.2.58, Open Math Harness 687f2a2; procedures: strict verifier, linters off, pass@32: independent samples, checked as written, replies up to 64k tokens, thinking high
- Method: Attempts (Mack); model deepseek-v4.1-flash; no prover model
- Thinking level: high
- 32 attempts, 8 at once, revisions before starting over 1; automation off; premise selection off; easier versions first off
- Spent $2.358 in 114 min; 0 solved by Lean's automation alone; budget $10

## Failures by reason

- **Type mismatch**: 1 (aime_1997_p9). terms of the wrong type, often casts between ℕ, ℤ and ℝ: push_cast/norm_cast hints, or a prover model.
- **Other Lean errors**: 1 (imo_1969_p2). read the last error below.

## All 193 attempts by how they ended

- Type mismatch: 46 (24%)
- Other Lean errors: 34 (18%)
- Wrong lemma names: 23 (12%)
- Tactics after the goal was closed: 22 (11%)
- Reply cut off before the proof: 22 (11%)
- Verified: 18 (9%)
- Lean timed out: 17 (9%)
- Tactics did not close goals: 11 (6%)

## Commonest Lean errors

| Error | Attempts | Problems |
|---|---|---|
| unexpected token `…`; expected `…` | 34 | 3 |
| the frozen theorem statement must appear verbatim; it is, byte for byte: | 22 | 6 |
| Application type mismatch: The argument | 20 | 4 |
| No goals to be solved | 18 | 7 |
| unsolved goals | 14 | 4 |
| Type mismatch | 13 | 4 |
| Tactic `…` failed: Did not find an occurrence of the pattern | 13 | 4 |
| failed to synthesize instance of type class | 8 | 3 |
| Unknown constant `…` | 7 | 5 |
| linarith failed to find a contradiction | 6 | 3 |
| Unknown identifier `…` | 4 | 3 |
| omega could not prove the goal: | 2 | 2 |
| (deterministic) timeout at `…`, maximum number of heartbeats (N) has been reached | 2 | 1 |
| `…` has already been declared | 2 | 1 |
| unexpected token `…`; expected command | 1 | 1 |

## Results

| Problem | Outcome | Attempts | Time | Cost | Reason |
|---|---|---|---|---|---|
| mathd_algebra_598 | solved | 1 | 66s | $0.004 |  |
| imo_1992_p1 | solved | 13 | 729s | $0.232 |  |
| imo_2001_p6 | solved | 25 | 1239s | $0.481 |  |
| amc12a_2019_p12 | solved | 1 | 60s | $0.003 |  |
| aime_1997_p9 | failed | 32 | 597s | $0.250 | Type mismatch |
| mathd_algebra_513 | solved | 1 | 44s | $0.002 |  |
| mathd_numbertheory_618 | solved | 1 | 55s | $0.002 |  |
| amc12_2001_p5 | solved | 32 | 1250s | $0.428 |  |
| amc12b_2020_p22 | solved | 13 | 192s | $0.073 |  |
| amc12b_2020_p21 | solved | 7 | 253s | $0.096 |  |
| imo_1969_p2 | failed | 32 | 1337s | $0.455 | Other Lean errors |
| numbertheory_notEquiv2i2jasqbsqdiv8 | solved | 1 | 28s | $0.002 |  |
| amc12b_2020_p13 | solved | 2 | 82s | $0.008 |  |
| induction_sumkexp3eqsumksq | solved | 3 | 73s | $0.012 |  |
| imo_1963_p5 | solved | 4 | 111s | $0.027 |  |
| aime_1988_p8 | solved | 1 | 49s | $0.002 |  |
| imo_1983_p6 | solved | 1 | 74s | $0.010 |  |
| induction_pord1p1on2powklt5on2 | solved | 21 | 571s | $0.266 |  |
| mathd_numbertheory_728 | solved | 1 | 30s | $0.003 |  |
| aime_1989_p8 | solved | 1 | 19s | $0.001 |  |

## Unsolved problems

### aime_1997_p9: Type mismatch

Attempts ended: errors 31, refused 1.

Run message: No verified proof after 32 attempts.

Statement:
```lean
import Mathlib

set_option maxHeartbeats 400000

open BigOperators Real Nat Topology Rat

theorem aime_1997_p9
  (a : ℝ)
  (h₀ : 0 < a)
  (h₁ : 1 / a - Int.floor (1 / a) = a^2 - Int.floor (a^2))
  (h₂ : 2 < a^2)
  (h₃ : a^2 < 3) :
  a^12 - 144 * (1 / a) = 233 := by sorry
```

Lean's last feedback:
```
Probe.lean:38:6: error: linarith failed to find a contradiction
case right
a : ℝ
h₀ : 0 < a
h₁ : 1 / a - ↑⌊1 / a⌋ = a ^ 2 - ↑⌊a ^ 2⌋
h₂ : 2 < a ^ 2
h₃ : a ^ 2 < 3
h_a_gt_one : 1 < a
h_inv_pos : 0 < 1 / a
h_inv_lt_one : 1 / a < 1
a✝ : 1 ≤ a⁻¹
⊢ False
failed
Probe.lean:47:4: error: Type mismatch: After simplification, term
  h₁
 has type
  Int.fract a⁻¹ = a ^ 2 - 2
but is expected to have type
  a⁻¹ = a ^ 2 - 2
```

Last attempt:
```lean
import Mathlib

set_option maxHeartbeats 400000

open BigOperators Real Nat Topology Rat

theorem aime_1997_p9
  (a : ℝ)
  (h₀ : 0 < a)
  (h₁ : 1 / a - Int.floor (1 / a) = a^2 - Int.floor (a^2))
  (h₂ : 2 < a^2)
  (h₃ : a^2 < 3) :
  a^12 - 144 * (1 / a) = 233 := by
  have h_a_gt_one : 1 < a := by
    by_contra h
    have ha_le : a ≤ 1 := le_of_not_gt h
    have h_sq_le : a^2 ≤ 1 := by
      calc
        a^2 = a * a := by ring
        _ ≤ 1 * a := mul_le_mul_of_nonneg_right ha_le h₀.le
        _ = a := by ring
        _ ≤ 1 := ha_le
    linarith [h₂, h_sq_le]
  have h_inv_pos : 0 < 1 / a := div_pos zero_lt_one h₀
  have h_inv_lt_one : 1 / a < 1 := by
    by_contra h
    have hge : 1 ≤ 1 / a := le_of_not_gt h
    have hmul := mul_le_mul_of_nonneg_right hge h₀.le
    rw [one_div, inv_mul_cancel₀ (ne_of_gt h₀)] at hmul
    have ha_le_one : a ≤ 1 := by simpa using hmul
    linarith [h_a_gt_one, ha_le_one]
  have hfloor1 : Int.floor (1 / a) = 0 := by
    rw [Int.floor_eq_iff]
    constructor
    · norm_num
      linarith [h_inv_pos]
    · norm_num
      linarith [h_inv_lt_one]
  have hfloor2 : Int.floor (a^2) = 2 := by
    rw [Int.floor_eq_iff]
    constructor
    · norm_num
      linarith [h₂]
    · norm_num
      linarith [h₃]
  have h1' : 1 / a = a^2 - 2 := by
    simpa [hfloor1, hfloor2] using h₁
  have hcubic : a^3 - 2 * a - 1 = 0 := by
    have hmul : (1 / a) * a = (a^2 - 2) * a := by rw [h1']
    rw [one_div, inv_mul_cancel₀ (ne_of_gt h₀)] at hmul
    have hmul' : (a^2 - 2) * a = 1 := by linarith [hmul]
    calc
      a^3 - 2 * a - 1 = (a^2 - 2) * a - 1 := by ring
      _ = 1 - 1 := by rw [hmul']
      _ = 0 := by ring
  have hfac : (a^2 - a - 1) * (a + 1) = 0 := by
    calc
      (a^2 - a - 1) * (a + 1) = a^3 - 2 * a - 1 := by ring
      _ = 0 := hcubic
  have ha2 : a^2 = a + 1 := by
    have hzero : a^2 - a - 1 = 0 := by
      rcases mul_eq_zero.mp hfac with h | h
      · exact h
      · exfalso
        linarith [h, h₀]
    linarith
  have ha4 : a^4 = 3 * a + 2 := by
    calc
      a^4 = (a^2)^2 := by ring
      _ = (a + 1)^2 := by rw [ha2]
      _ = a^2 + 2 * a + 1 := by ring
      _ = (a + 1) + 2 * a + 1 := by rw [ha2]
      _ = 3 * a + 2 := by ring
  have ha8 : a^8 = 21 * a + 13 := by
    calc
      a^8 = (a^4)^2 := by ring
      _ = (3 * a + 2)^2 := by rw [ha4]
      _ = 9 * a^2 + 12 * a + 4 := by ring
      _ = 9 * (a + 1) + 12 * a + 4 := by rw [ha2]
      _ = 21 * a + 13 := by ring
  have ha12 : a^12 = 144 * a + 89 := by
    calc
      a^12 = a^8 
…
```

### imo_1969_p2: Other Lean errors

Attempts ended: errors 29, refused 3.

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
