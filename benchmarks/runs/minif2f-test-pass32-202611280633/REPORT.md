# Mack benchmark: miniF2F test, 17/20 solved (85.0%)

- Run 1795847647760, 2026-11-28T06:33:46.262Z, done; run with Mack 0.2.59, report by Mack 0.2.59
- Ran on 20 machines in parallel, each GitHub Actions ubuntu-latest, 16 GB, 4 CPUs, Lake version 5.0.0-src+c9afcdd (Lean version 4.36.0-rc1); Lean REPL on; Lean deadline 600s; 2 Lean processes
- Harness: Mack 0.2.59, Open Math Harness 687f2a2; procedures: strict verifier, linters off, pass@32: independent samples, checked as written, replies up to 64k tokens, thinking high
- Method: Attempts (Mack); model gpt-6.1-sol; no prover model
- Thinking level: high
- 32 attempts, 8 at once, revisions before starting over 1; automation off; premise selection off; easier versions first off
- Spent $12.298 in 176 min; 0 solved by Lean's automation alone; budget $60

## Failures by reason

- **Model call failed**: 1 (imo_2001_p6). the provider refused or failed: the key, the model id or the provider's limits.
- **Lean timed out**: 1 (amc12_2001_p5). heavy tactics (nlinarith, decide, simp on big terms): a longer Lean deadline or lighter proofs.
- **Budget or stop**: 1 (imo_1969_p2). the run's budget or a stop ended it: a larger budget.

## All 124 attempts by how they ended

- Model call failed: 37 (30%)
- Wrong lemma names: 21 (17%)
- Verified: 17 (14%)
- Type mismatch: 14 (11%)
- Lean timed out: 12 (10%)
- Tactics after the goal was closed: 11 (9%)
- Tactics did not close goals: 6 (5%)
- Other Lean errors: 6 (5%)

## Commonest Lean errors

| Error | Attempts | Problems |
|---|---|---|
| Cheaper Inference: The request timed out before the stream completed. | 37 | 4 |
| unsolved goals | 13 | 3 |
| No goals to be solved | 11 | 7 |
| Tactic `…` failed: Did not find an occurrence of the pattern | 8 | 3 |
| Application type mismatch: The argument | 7 | 4 |
| Unknown constant `…` | 7 | 2 |
| Unknown identifier `…` | 5 | 4 |
| unexpected token `…`; expected `…` | 5 | 3 |
| Type mismatch | 3 | 3 |
| linarith failed to find a contradiction | 2 | 2 |
| unexpected token `…`; expected command | 1 | 1 |
| omega could not prove the goal: | 1 | 1 |
| Function expected at | 1 | 1 |
| typeclass instance problem is stuck | 1 | 1 |
| expected interpolated string | 1 | 1 |

## Results

| Problem | Outcome | Attempts | Time | Cost | Reason |
|---|---|---|---|---|---|
| mathd_algebra_598 | solved | 2 | 123s | $0.180 |  |
| imo_1992_p1 | solved | 1 | 458s | $0.306 |  |
| imo_2001_p6 | failed | 3 | 2390s | $0.395 | Model call failed |
| amc12a_2019_p12 | solved | 1 | 905s | $0.127 |  |
| aime_1997_p9 | solved | 5 | 278s | $0.648 |  |
| mathd_algebra_513 | solved | 1 | 40s | $0.031 |  |
| mathd_numbertheory_618 | solved | 1 | 708s | $0.059 |  |
| amc12_2001_p5 | failed | 25 | 1512s | $3.027 | Lean timed out |
| amc12b_2020_p22 | solved | 3 | 161s | $0.442 |  |
| amc12b_2020_p21 | solved | 6 | 617s | $1.574 |  |
| imo_1969_p2 | failed | 16 | 1808s | $3.003 | Budget or stop |
| numbertheory_notEquiv2i2jasqbsqdiv8 | solved | 1 | 23s | $0.017 |  |
| amc12b_2020_p13 | solved | 9 | 347s | $1.086 |  |
| induction_sumkexp3eqsumksq | solved | 1 | 124s | $0.087 |  |
| imo_1963_p5 | solved | 6 | 394s | $0.785 |  |
| aime_1988_p8 | solved | 1 | 54s | $0.058 |  |
| imo_1983_p6 | solved | 1 | 115s | $0.094 |  |
| induction_pord1p1on2powklt5on2 | solved | 2 | 457s | $0.273 |  |
| mathd_numbertheory_728 | solved | 1 | 30s | $0.030 |  |
| aime_1989_p8 | solved | 1 | 38s | $0.076 |  |

## Unsolved problems

### imo_2001_p6: Model call failed

Attempts ended: errors 3, model error 14.

Run message: No verified proof after 17 attempts. The last model call failed: Cheaper Inference: The request timed out before the stream completed.

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
  ¬ Nat.Prime (a * b + c * d) := by
  have ha : 0 < a := h₀.1
  have hb : 0 < b := h₀.2.1
  have hc : 0 < c := h₀.2.2.1
  have hd : 0 < d := h₀.2.2.2

  have hca : c < a := lt_trans h₂ h₃
  have hda : d < a := lt_trans h₁ hca

  have hLpos : 0 < a * c + b * d := by
    have hac : 0 < a * c := Nat.mul_pos ha hc
    have hbd : 0 < b * d := Nat.mul_pos hb hd
    omega

  have hle1 : c ≤ b + d + a := by omega

  have hfac2 : 0 < b + d + c - a := by
    by_contra hnot
    have hle : b + d + c - a ≤ 0 := le_of_not_gt hnot
    have hzero : b + d + c - a = 0 := le_antisymm hle (Nat.zero_le _)
    have hprod0 : (b + d + a - c) * (b + d + c - a) = 0 := by
      rw [hzero, mul_zero]
    have hzeroL : a * c + b * d = 0 := by
      rw [h₄, hprod0]
    omega

  have hle2 : a ≤ b + d + c := by omega

  have h4z :
      (a : ℤ) * (c : ℤ) + (b : ℤ) * (d : ℤ)
        = ((b : ℤ) + (d : ℤ) + (a : ℤ) - (c : ℤ)) *
          ((b : ℤ) + (d : ℤ) + (c : ℤ) - (a : ℤ)) := by
    have h := congrArg (fun n : ℕ => (n : ℤ)) h₄
    simp only [Nat.cast_add, Nat.cast_mul] at h
    rw [Nat.cast_sub hle1, Nat.cast_sub hle2] at h
    simp only [Nat.cast_add, Nat.cast_mul] at h
    simpa [sub_eq_add_neg, add_assoc, add_comm, add_left_comm] using h

  have hE2z :
      (a : ℤ) * (a : ℤ) + (c : ℤ) * (c : ℤ)
        = (a : ℤ) * (c : ℤ) +
          ((b : ℤ) * (b : ℤ) + (b : ℤ) * (d : ℤ) + (d : ℤ) * (d : ℤ)) := by
    nlinarith [h4z]

  have hE2 : a * a + c * c = a * c + (b * b + b * d + d * d) := by
    have hcast :
        ((a * a + c * c : ℕ) : ℤ)
          = ((a * c + (b * b + b * d + d * d) : ℕ) : ℤ) := by
      simp only [Nat.cast_add, Nat.cast_mul]
      exact hE2z
    exact_mod_cast hcast

  have hPR :
      (a * b + c * d) * (a * d + b * c)
        = (a * c + b * d) * (b * b + b * d + d * d) := by
    have hcast :
        (((a * b + c * d) * (a * d + b * c) : ℕ) : ℤ)
          = (((a * c + b * d) * (b * b + b * d + d * d) : ℕ) : ℤ) := by
      simp only [Nat.cast_add, Nat.cast_mul]
      nlinarith [hE2z]
    exact_mod_cast hcast

  have hQltP : a * c + b * d < a * b + c * d := by
    have hcast :
        ((a * c + b * d : ℕ) : ℤ) < ((a * b + c * d : ℕ) : ℤ) := by
      simp only [Nat.cast_add, Nat.cast_mul]
      have hdalt 
…
```

### amc12_2001_p5: Lean timed out

Attempts ended: errors 25, model error 7.

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
Probe.lean:9:17: error: Application type mismatch: The argument
  fun k => 2 * k
has type
  ℕ → ℕ
but is expected to have type
  ?m.7 ↪ ?m.8
in the application
  Finset.map fun k => 2 * k
Probe.lean:17:4: error: unsolved goals
case mp.refine_2
x : ℕ
hx : x < 10000
m : ℕ
hm : x = m + m
⊢ (sorry ()) m = m + m
Probe.lean:25:17: error: Application type mismatch: The argument
  fun k => 2 * k + 1
has type
  ℕ → ℕ
but is expected to have type
  ?m.9 ↪ ?m.10
in the application
  Finset.map fun k => 2 * k + 1
Probe.lean:34:8: error: Tactic `apply` failed: could not unify the type of `hne`
  Odd x
with the goal
  False

x : ℕ
hx : x < 10000
hne : Odd x
hlt : x % 2 < 2
h0 : x % 2 = 0
⊢ False
Probe.lean:45:4: error: No goals to be solved
Probe.lean:57:79: error: Application type mismatch: The argument
  fun k => 2 * k + 1
has type
  ℕ → ℕ
but is expected to have type
  ?m.90 ↪ ?m.91
in the application
  Finset.map fun k => 2 * k + 1
Probe.lean:62:46: error: Application type mismatch: The argument
  fun k => 2 * k
has type
  (k : ?m.165) → ?m.167 k
but is expected to have type
  ℕ ↪ ?m.153
in the application
  Finset.prod_map (Finset.range 5000) fun k => 2 * k
Probe.lean:62:10: error: maximum recursion depth has been reached
use `set_option maxRecDepth <num>` to increase limit
use `set_option diagnostics true` to get diagnostic information
Probe.lean:66:46: error: Application type mismatch: The argument
  fun k => 2 * k + 1
has type
  (k : ?m.246) → ?m.253 k
but is expected to have type

…
```

Last attempt:
```lean
import Mathlib

set_option maxHeartbeats 400000

open BigOperators Real Nat Topology Rat

lemma even_filter_range_10000 :
    Finset.filter Even (Finset.range 10000) =
      Finset.map (fun k : ℕ => 2 * k) (Finset.range 5000) := by
  ext x
  simp [Finset.mem_filter, Finset.mem_range, Finset.mem_map]
  constructor
  · intro ⟨hx, he⟩
    rcases he with ⟨m, hm⟩
    refine ⟨m, ?_, ?_⟩
    · omega
    · simp [hm]
  · intro ⟨m, hm, hxm⟩
    constructor
    · omega
    · exact ⟨m, hxm⟩

lemma odd_filter_range_10000 :
    Finset.filter (λ x => ¬ Even x) (Finset.range 10000) =
      Finset.map (λ k : ℕ => 2 * k + 1) (Finset.range 5000) := by
  ext x
  simp [Finset.mem_filter, Finset.mem_range, Finset.mem_map]
  constructor
  · intro ⟨hx, hne⟩
    have hmod : x % 2 = 1 := by
      have hlt : x % 2 < 2 := Nat.mod_lt x (by decide)
      have hne0 : x % 2 ≠ 0 := by
        intro h0
        apply hne
        refine ⟨x / 2, ?_⟩
        have := Nat.div_add_mod x 2
        simpa [h0] using this
      have hge : 0 ≤ x % 2 := Nat.zero_le _
      omega
    refine ⟨x / 2, ?_, ?_⟩
    · omega
    · have := Nat.div_add_mod x 2
      simpa [hmod] using this
  · intro ⟨k, hk, rfl⟩
    constructor
    · omega
    · intro he
      rcases he with ⟨m, hm⟩
      have : 2 * m = 2 * k + 1 := hm
      omega

theorem amc12_2001_p5 :
  Finset.prod (Finset.filter (λ x => ¬ Even x) (Finset.range 10000)) (id : ℕ → ℕ) = (10000!) / ((2^5000) * (5000!)) := by
  let L := Finset.prod (Finset.filter (λ x => ¬ Even x) (Finset.range 10000)) (id : ℕ → ℕ)
  have hL : L = (Finset.range 5000).prod (fun k => 2 * k + 1) := by
    have h := odd_filter_range_10000
    rw [show Finset.filter (λ x => ¬ Even x) (Finset.range 10000) = Finset.map (λ k : ℕ => 2 * k + 1) (Finset.range 5000) from h]
    exact Finset.prod_map (Finset.range 5000) (fun k => 2 * k + 1) (id : ℕ → ℕ)
  have hevenprod : (Finset.filter Even (Finset.range 10000)).prod (fun i => i + 1) =
      (Finset.range 5000).prod (fun k => 2 * k + 1) := by
    rw [even_filter_range_10000]
    exact Finset.prod_map (Finset.range 5000) (fun k => 2 * k) (fun i => i + 1)
  have hoddsprod : (Finset.filter (λ i => ¬ Even i) (Finset.range 10000)).prod (fun i => i + 1) =
      (Finset.range 5000).prod (fun k => 2 * k + 2) := by
    rw [odd_filter_range_10000]
    exact Finset.prod_map (Finset.range 5000) (fun k => 2 * k + 1) (fun i => i + 1)
  have hevenval : (Finset.range 5000).prod (fun k => 2 * k + 2) = (2 ^ 5000) * (5000 !) := by
    have h : (Finset.range 50
…
```

### imo_1969_p2: Budget or stop

Attempts ended: model error 8, errors 16.

Run message: Stopped.

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
Probe.lean:26:20: error: Tactic `rewrite` failed: Did not find an occurrence of the pattern
  Complex.exp ((↑(a i) + ↑x) * Complex.I)
in the target expression
  cos (a i + x) / 2 ^ i = (Complex.exp (↑(a i + x) * Complex.I) / 2 ^ i).re

m n : ℝ
k : ℕ
a : ℕ → ℝ
y : ℝ → ℝ
h₀ : 0 < k
h₁ : ∀ (x : ℝ), y x = ∑ i ∈ Finset.range k, cos (a i + x) / 2 ^ i
h₂ : y m = 0
h₃ : y n = 0
Z : ℂ := ∑ i ∈ Finset.range k, Complex.exp (Complex.I * ↑(a i)) / 2 ^ i
x : ℝ
i : ℕ
a✝ : i ∈ Finset.range k
⊢ cos (a i + x) / 2 ^ i = (Complex.exp (↑(a i + x) * Complex.I) / 2 ^ i).re
Probe.lean:35:95: error: Type mismatch
  ?m.219 = ∑ i ∈ Finset.range k, Complex.exp (Complex.I * ↑(a i)) / 2 ^ i * Complex.exp (Complex.I * ↑x)
has type
  Prop
of sort `Type` but is expected to have type
  ∑ i ∈ Finset.range k, Complex.exp (Complex.I * ↑(a i + x)) / 2 ^ i =
    ∑ i ∈ Finset.range k, Complex.exp (Complex.I * ↑(a i)) * Complex.exp (Complex.I * ↑x) / 2 ^ i
of sort `Prop`
Probe.lean:36:12: error: Type mismatch
  Finset.sum_congr rfl fun i x => ?m.265
has type
  Finset.sum ?m.262 ?m.259 = Finset.sum ?m.262 ?m.260
of sort `Prop` but is expected to have type
  ℂ
of sort `Type`
Probe.lean:19:83: error: unsolved goals
case calc.step
m n : ℝ
k : ℕ
a : ℕ → ℝ
y : ℝ → ℝ
h₀ : 0 < k
h₁ : ∀ (x : ℝ), y x = ∑ i ∈ Finset.range k, cos (a i + x) / 2 ^ i
h₂ : y m = 0
h₃ : y n = 0
Z : ℂ := ∑ i ∈ Finset.range k, Complex.exp (Complex.I * ↑(a i)) / 2 ^ i
x : ℝ
term : ∀ i ∈ Finset.range k, cos (a i + x) / 2 ^ i = (Complex.exp (Complex.I * 
…
```

Last attempt:
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
  ∃ t : ℤ, m - n = t * π := by
  let Z : ℂ := ∑ i ∈ Finset.range k, Complex.exp (Complex.I * ↑(a i)) / (2 : ℂ) ^ i

  have hZ_expand : ∀ x : ℝ, y x = Complex.re (Z * Complex.exp (Complex.I * ↑x)) := by
    intro x
    rw [h₁ x]
    have term : ∀ i ∈ Finset.range k,
        Real.cos (a i + x) / (2 : ℝ) ^ i =
        Complex.re (Complex.exp (Complex.I * ↑(a i + x)) / (2 : ℂ) ^ i) := by
      intro i _
      rw [mul_comm, Complex.exp_mul_I (a i + x)]
      rw [← Complex.ofReal_pow]
      simp [Complex.re_div_ofReal]
    rw [Finset.sum_congr rfl term]
    rw [← Complex.re_sum]
    congr 1
    calc
      ∑ i ∈ Finset.range k, Complex.exp (Complex.I * ↑(a i + x)) / (2 : ℂ) ^ i
          = ∑ i ∈ Finset.range k,
              Complex.exp (Complex.I * ↑(a i)) * Complex.exp (Complex.I * ↑x) / (2 : ℂ) ^ i := by
            refine Finset.sum_congr rfl (fun i _ => ?_)
            have : Complex.I * ↑(a i + x) = Complex.I * ↑(a i) + Complex.I * ↑x := by
              push_cast
              ring
            rw [this, Complex.exp_add]
            ring
          = ∑ i ∈ Finset.range k,
              Complex.exp (Complex.I * ↑(a i)) / (2 : ℂ) ^ i * Complex.exp (Complex.I * ↑x) := by
            refine Finset.sum_congr rfl (fun i _ => by ring)
          = Z * Complex.exp (Complex.I * ↑x) := by
            rw [← Finset.sum_mul]

  have Zne : Z ≠ 0 := by
    let first := Complex.exp (Complex.I * ↑(a 0))
    let tail := ∑ i ∈ (Finset.range k).erase 0, Complex.exp (Complex.I * ↑(a i)) / (2 : ℂ) ^ i
    have hsplit : Z = first + tail := by
      dsimp [Z, first, tail]
      rw [← Finset.sum_erase_add (Finset.range k) (fun i => Complex.exp (Complex.I * ↑(a i)) / (2 : ℂ) ^ i) (Finset.mem_range.mpr (Nat.zero_lt_of_lt h₀))]
    have hfirst : Complex.abs first = 1 := by
      dsimp [first]
      rw [Complex.abs_exp]
      simp
    have htail_le : Complex.abs tail ≤ 1 - 2 * (1 / 2 : ℝ) ^ k := by
      calc
        Complex.abs tail
            ≤ ∑ i ∈ (Finset.range k).erase 0, Complex.abs (Complex.exp (Complex.I * ↑(a i)) / (2 : ℂ) ^ i) := by
              dsimp [tail]
              exact Complex.abs_sum_le _ _
            _ = ∑ i ∈ (Finset.range k).erase 0, (1 / 2 : ℝ) ^ i := by
              refine Finset
…
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
