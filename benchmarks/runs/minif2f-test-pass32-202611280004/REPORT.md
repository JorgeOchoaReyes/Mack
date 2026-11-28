# Mack benchmark: miniF2F test, 15/20 solved (75.0%)

- Run 1795824335102, 2026-11-28T00:04:49.879Z, done; run with Mack 0.2.52, report by Mack 0.2.52
- Ran on 5 machines in parallel, each GitHub Actions ubuntu-latest, 16 GB, 4 CPUs, Lake version 5.0.0-src+c9afcdd (Lean version 4.36.0-rc1); Lean REPL on; Lean deadline 600s; 2 Lean processes
- Harness: Mack 0.2.52, Open Math Harness 687f2a2; procedures: strict verifier, linters off, pass@32: independent samples, checked as written, replies up to 32k tokens
- Method: Attempts (Mack); model deepseek-v4.1-flash; no prover model
- Thinking level: each model's default
- 32 attempts, 8 at once, revisions before starting over 1; automation off; premise selection off; easier versions first off
- Spent $1.782 in 74 min; 0 solved by Lean's automation alone; budget $15

## Failures by reason

- **Reply cut off before the proof**: 5 (imo_1992_p1, imo_2001_p6, amc12_2001_p5, amc12b_2020_p21, imo_1969_p2). the reply hit its token limit while the model was still working, so no proof reached Lean: a longer reply limit, or a lower thinking level.

## All 182 attempts by how they ended

- Reply cut off before the proof: 120 (66%)
- Verified: 15 (8%)
- Wrong lemma names: 11 (6%)
- Tactics did not close goals: 9 (5%)
- Other Lean errors: 9 (5%)
- Type mismatch: 7 (4%)
- Lean timed out: 6 (3%)
- Gaps automation could not close: 3 (2%)
- Tactics after the goal was closed: 2 (1%)

## Commonest Lean errors

| Error | Attempts | Problems |
|---|---|---|
| the frozen theorem statement must appear verbatim; it is, byte for byte: | 110 | 5 |
| forbidden token `…` | 10 | 1 |
| Tactic `…` failed: Did not find an occurrence of the pattern | 8 | 5 |
| omega could not prove the goal: | 7 | 1 |
| linarith failed to find a contradiction | 6 | 2 |
| Unknown constant `…` | 4 | 2 |
| unexpected token `…`; expected command | 4 | 3 |
| unexpected token `…`; expected `…` | 4 | 2 |
| No goals to be solved | 3 | 3 |
| sorry left open, goal: | 3 | 2 |
| unsolved goals | 3 | 1 |
| failed to create binder due to failure when reverting variable dependencies | 1 | 1 |
| Unknown identifier `…` | 1 | 1 |
| Tactic `…` failed: invalid equality proof, it is not of the form (x = t) or (t = x) | 1 | 1 |
| unexpected end of input | 1 | 1 |

## Results

| Problem | Outcome | Attempts | Time | Cost | Reason |
|---|---|---|---|---|---|
| mathd_algebra_598 | solved | 2 | 64s | $0.007 |  |
| imo_1992_p1 | failed | 32 | 568s | $0.204 | Reply cut off before the proof |
| imo_2001_p6 | failed | 32 | 625s | $0.360 | Reply cut off before the proof |
| amc12a_2019_p12 | solved | 1 | 89s | $0.005 |  |
| aime_1997_p9 | solved | 6 | 49s | $0.012 |  |
| mathd_algebra_513 | solved | 1 | 35s | $0.001 |  |
| mathd_numbertheory_618 | solved | 1 | 43s | $0.002 |  |
| amc12_2001_p5 | failed | 31 | 735s | $0.360 | Reply cut off before the proof |
| amc12b_2020_p22 | solved | 3 | 64s | $0.010 |  |
| amc12b_2020_p21 | failed | 32 | 806s | $0.383 | Reply cut off before the proof |
| imo_1969_p2 | failed | 32 | 797s | $0.382 | Reply cut off before the proof |
| numbertheory_notEquiv2i2jasqbsqdiv8 | solved | 1 | 20s | $0.001 |  |
| amc12b_2020_p13 | solved | 1 | 48s | $0.003 |  |
| induction_sumkexp3eqsumksq | solved | 1 | 71s | $0.004 |  |
| imo_1963_p5 | solved | 1 | 89s | $0.012 |  |
| aime_1988_p8 | solved | 1 | 59s | $0.007 |  |
| imo_1983_p6 | solved | 1 | 85s | $0.015 |  |
| induction_pord1p1on2powklt5on2 | solved | 1 | 125s | $0.010 |  |
| mathd_numbertheory_728 | solved | 1 | 22s | $0.001 |  |
| aime_1989_p8 | solved | 1 | 16s | $0.001 |  |

## Unsolved problems

### imo_1992_p1: Reply cut off before the proof

Attempts ended: refused 12, errors 19, sorries 1.

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
Probe.lean:27:6: error: Tactic `subst` failed: invalid equality proof, it is not of the form (x = t) or (t = x)
  a = p - 1

p q r : ℤ
hp : 1 < p
hpq : p < q
hqr : q < r
a : ℤ := p - 1
ha_def : a = p - 1
b : ℤ := q - 1
hb_def : b = q - 1
c : ℤ := r - 1
h₁ : a * b * c ∣ p * q * r - 1
hc_def : c = r - 1
ha : 1 ≤ a
hab : a < b
hbc : b < c
hb1 : 1 ≤ b
hc1 : 1 ≤ c
⊢ p * q * r - 1 = a * b * c + a * b + b * c + c * a + a + b + c
Probe.lean:29:6: error: Tactic `subst` failed: invalid equality proof, it is not of the form (x = t) or (t = x)
  a = p - 1

p q r : ℤ
hp : 1 < p
hpq : p < q
hqr : q < r
a : ℤ := p - 1
ha_def : a = p - 1
b : ℤ := q - 1
hb_def : b = q - 1
c : ℤ := r - 1
h₁ : a * b * c ∣ p * q * r - 1
hc_def : c = r - 1
ha : 1 ≤ a
hab : a < b
hbc : b < c
hb1 : 1 ≤ b
hc1 : 1 ≤ c
heq : p * q * r - 1 = a * b * c + a * b + b * c + c * a + a + b + c
⊢ (p - 1) * (q - 1) * (r - 1) = a * b * c
Probe.lean:32:74: error: Type mismatch
  h₁
has type
  a * b * c ∣ a * b * c + a * b + b * c + c * a + a + b + c
but is expected to have type
  a * b * c ∣ a * b * c + (a * b + b * c + c * a + a + b + c)
Probe.lean:33:11: error: Unknown constant `Int.dvd_add_iff_right`
Probe.lean:476:4: error: Tactic `subst` failed: invalid equality proof, it is not of the form (x = t) or (t = x)
  a = 1

case inl
p q r : ℤ
hp : 1 < p
hpq : p < q
hqr : q < r
a : ℤ := p - 1
ha_def : a = p - 1
b : ℤ := q - 1
hb_def : b = q - 1
c : ℤ := r - 1
h₁ : a * b * c ∣ p * q * r - 1
hc_def : c = r - 1
ha : 1 ≤ a
hab : a < b

…
```

Last attempt:
```lean
import Mathlib

set_option maxHeartbeats 400000

open BigOperators Real Nat Topology Rat

theorem imo_1992_p1
  (p q r : ℤ)
  (h₀ : 1 < p ∧ p < q ∧ q < r)
  (h₁ : (p - 1) * (q - 1) * (r - 1)∣(p * q * r - 1)) :
  (p, q, r) = (2, 4, 8) ∨ (p, q, r) = (3, 5, 15) := by
  obtain ⟨hp, hpq, hqr⟩ := h₀
  -- Let a = p-1, b = q-1, c = r-1. Then 1 ≤ a < b < c, and abc | (a+1)(b+1)(c+1) - 1.
  -- (a+1)(b+1)(c+1) - 1 = abc + ab + bc + ca + a + b + c.
  -- So abc | ab + bc + ca + a + b + c.
  set a := p - 1 with ha_def
  set b := q - 1 with hb_def
  set c := r - 1 with hc_def
  have ha : 1 ≤ a := by omega
  have hab : a < b := by omega
  have hbc : b < c := by omega
  have hb1 : 1 ≤ b := by omega
  have hc1 : 1 ≤ c := by omega
  -- Rewrite the divisibility
  have hdiv : a * b * c ∣ a * b + b * c + c * a + a + b + c := by
    have heq : p * q * r - 1 = a * b * c + a * b + b * c + c * a + a + b + c := by
      subst ha_def hb_def hc_def; ring
    have hd : (p - 1) * (q - 1) * (r - 1) = a * b * c := by
      subst ha_def hb_def hc_def; ring
    rw [hd, heq] at h₁
    -- abc | abc + (rest) iff abc | rest
    have : a * b * c ∣ a * b * c + (a * b + b * c + c * a + a + b + c) := h₁
    exact (Int.dvd_add_iff_right (dvd_refl _)).mp this
  -- Now bound. Since abc | S where S = ab+bc+ca+a+b+c.
  -- S < 2abc? Let's see: S/abc = 1/c + 1/a + 1/b + 1/(bc) + 1/(ac) + 1/(ab).
  -- Since 1 ≤ a < b < c, a ≥ 1, b ≥ 2, c ≥ 3.
  -- S = ab + bc + ca + a + b + c.
  -- We want S < 2abc, i.e., ab+bc+ca+a+b+c < 2abc.
  -- Divide by abc: 1/c + 1/a + 1/b + 1/(bc) + 1/(ac) + 1/(ab) < 2.
  -- Since a ≥ 1: 1/a ≤ 1. b ≥ 2: 1/b ≤ 1/2. c ≥ 3: 1/c ≤ 1/3.
  -- 1/(bc) ≤ 1/6, 1/(ac) ≤ 1/3, 1/(ab) ≤ 1/2.
  -- Sum ≤ 1 + 1/2 + 1/3 + 1/6 + 1/3 + 1/2 = 2.833... not < 2.
  -- Hmm, need better. Actually if a = 1, then S = b + bc + c + 1 + b + c = 2b + 2c + bc + 1.
  -- abc = bc. So bc | 2b + 2c + bc + 1, so bc | 2b + 2c + 1.
  -- But 2b + 2c + 1 < 2bc + ... need 2b+2c+1 < bc for b,c large.
  -- For b ≥ 2, c ≥ 3: bc ≥ 6, 2b+2c+1 ≤ ... need bc > 2b+2c+1, i.e., (b-2)(c-2) > 5.
  -- If b=2, c=3: (0)(1)=0, not > 5. bc=6, 2b+2c+1=11, 6∤11. Good, so no.
  -- If b=2, c=4: bc=8, 2b+2c+1=13, 8∤13. No.
  -- If b=2, c=5: bc=10, 2b+2c+1=15, no.
  -- If b=2, c=6: bc=12, 2b+2c+1=17, no.
  -- If b=2, c=7: bc=14, 2b+2c+1=19, no.
  -- If b=2, c=8: bc=16, 2b+2c+1=21, no.
  -- If b=2, c=9: bc=18, 2b+2c+1=23, no.
  -- If b=2, c=10: bc=20, 2b+2c+1=25, no.
  -- If b=2, c=11: bc=22, 2b+2c+1=27, no.
  -- If b=2, c=12: bc=24, 2b+2c+1=29, n
…
```

### imo_2001_p6: Reply cut off before the proof

Attempts ended: refused 27, sorries 2, errors 3.

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
Probe.lean:41:0: error: unexpected end of input
Probe.lean:34:6: error: linarith failed to find a contradiction
case h1
a b c d : ℕ
h₁ : d < c
h₂ : c < b
h₃ : b < a
h₄✝ : a * c + b * d = (b + d + a - c) * (b + d + c - a)
h₄ : a * c + b * d = (b + d + (a - c)) * (b + d - (a - c))
hp : Nat.Prime (a * b + c * d)
ha : 0 < a
hb : 0 < b
hc : 0 < c
hd : 0 < d
hac : c < a
hpos : 0 < b + d + c - a
hlt : a < b + c + d
e1 : b + d + a - c = b + d + (a - c)
e2 : b + d + c - a = b + d - (a - c)
hle : a - c ≤ b + d
this : b + d - (a - c) + (a - c) = b + d
a✝ : (b + d + (a - c)) * (b + d - (a - c)) < (b + d) ^ 2 - (a - c) ^ 2
⊢ False
failed
Probe.lean:38:4: error: linarith failed to find a contradiction
a b c d : ℕ
h₁ : d < c
h₂ : c < b
h₃ : b < a
h₄✝ : a * c + b * d = (b + d + a - c) * (b + d + c - a)
h₄ : a * c + b * d = (b + d) ^ 2 - (a - c) ^ 2
hp : Nat.Prime (a * b + c * d)
ha : 0 < a
hb : 0 < b
hc : 0 < c
hd : 0 < d
hac : c < a
hpos : 0 < b + d + c - a
hlt : a < b + c + d
e1 : b + d + a - c = b + d + (a - c)
e2 : b + d + c - a = b + d - (a - c)
hle : a - c ≤ b + d
e3 : (b + d + (a - c)) * (b + d - (a - c)) = (b + d) ^ 2 - (a - c) ^ 2
hca : c ≤ a
this : a - c + c = a
⊢ False
failed
Probe.lean:14:33: error: unsolved goals
a b c d : ℕ
h₁ : d < c
h₂ : c < b
h₃ : b < a
h₄ : a * c + b * d = (b + d + a - c) * (b + d + c - a)
hp : Nat.Prime (a * b + c * d)
ha : 0 < a
hb : 0 < b
hc : 0 < c
hd : 0 < d
hac : c < a
hpos : 0 < b + d + c - a
hlt : a < b + c + d
hkey : a ^ 2 - a * c + c ^ 2 = b ^ 2 +
…
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
  intro hp
  obtain ⟨ha, hb, hc, hd⟩ := h₀
  have hac : c < a := lt_trans h₂ h₃
  -- b+d+c-a > 0
  have hpos : 0 < b + d + c - a := by
    rcases Nat.eq_zero_or_pos (b + d + c - a) with h | h
    · rw [h, mul_zero] at h₄
      have : 0 < a * c + b * d := by positivity
      omega
    · exact h
  have hlt : a < b + c + d := by omega
  -- key equation: a^2 - a*c + c^2 = b^2 + b*d + d^2
  have hkey : a^2 - a*c + c^2 = b^2 + b*d + d^2 := by
    have e1 : b + d + a - c = b + d + (a - c) := by omega
    have e2 : b + d + c - a = b + d - (a - c) := by omega
    rw [e1, e2] at h₄
    have hle : a - c ≤ b + d := by omega
    have e3 : (b + d + (a - c)) * (b + d - (a - c)) = (b+d)^2 - (a-c)^2 := by
      have := Nat.sub_add_cancel hle
      nlinarith [this]
    rw [e3] at h₄
    have hca : c ≤ a := le_of_lt hac
    have := Nat.sub_add_cancel hca
    nlinarith [h₄, this]
  -- Now show ab+cd is composite
  ...
```

### amc12_2001_p5: Reply cut off before the proof

Attempts ended: errors 9, refused 22.

Run message: No verified proof after 32 attempts. The last model call failed: terminated

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

Attempts ended: refused 28, errors 4.

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

Attempts ended: refused 31, errors 1.

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
