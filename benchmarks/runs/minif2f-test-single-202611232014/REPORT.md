# Mack benchmark: miniF2F test, 13/20 solved (65.0%)

- Run 1795464848382, 2026-11-23T20:14:08.382Z, Mack 0.2.18, done
- Method: single; model us/gpt-6-luna; no prover model
- 8 attempts, 1 at once, revisions before starting over 4; automation on; premise selection off; easier versions first off
- Spent $0.215 in 269 min; 0 solved by Lean's automation alone; budget $5

## Failures by reason

None.

## Results

| Problem | Outcome | Attempts | Time | Cost | Reason |
|---|---|---|---|---|---|
| mathd_algebra_598 | solved | 2 | 792s | $0.003 |  |
| imo_1992_p1 | failed | 8 | 1542s | $0.027 |  |
| imo_2001_p6 | failed | 8 | 1237s | $0.035 |  |
| amc12a_2019_p12 | solved | 3 | 543s | $0.005 |  |
| aime_1997_p9 | solved | 3 | 892s | $0.007 |  |
| mathd_algebra_513 | solved | 1 | 451s | $0.000 |  |
| mathd_numbertheory_618 | failed | 8 | 1189s | $0.025 |  |
| amc12_2001_p5 | failed | 8 | 1173s | $0.016 |  |
| amc12b_2020_p22 | solved | 5 | 815s | $0.006 |  |
| amc12b_2020_p21 | failed | 8 | 1268s | $0.024 |  |
| imo_1969_p2 | failed | 8 | 1322s | $0.023 |  |
| numbertheory_notEquiv2i2jasqbsqdiv8 | solved | 1 | 415s | $0.001 |  |
| amc12b_2020_p13 | solved | 2 | 600s | $0.004 |  |
| induction_sumkexp3eqsumksq | solved | 1 | 312s | $0.002 |  |
| imo_1963_p5 | solved | 3 | 670s | $0.009 |  |
| aime_1988_p8 | solved | 1 | 396s | $0.003 |  |
| imo_1983_p6 | solved | 2 | 439s | $0.004 |  |
| induction_pord1p1on2powklt5on2 | failed | 8 | 1224s | $0.021 |  |
| mathd_numbertheory_728 | solved | 1 | 495s | $0.000 |  |
| aime_1989_p8 | solved | 1 | 342s | $0.001 |  |

## Unsolved problems

### imo_1992_p1: failed

Run message: No verified proof after 8 attempts.

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


### imo_2001_p6: failed

Run message: No verified proof after 8 attempts.

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


### mathd_numbertheory_618: failed

Run message: No verified proof after 8 attempts.

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


### amc12_2001_p5: failed

Run message: No verified proof after 8 attempts.

Statement:
```lean
import Mathlib

set_option maxHeartbeats 400000

open BigOperators Real Nat Topology Rat

theorem amc12_2001_p5 :
  Finset.prod (Finset.filter (λ x => ¬ Even x) (Finset.range 10000)) (id : ℕ → ℕ) = (10000!) / ((2^5000) * (5000!)) := by sorry
```


### amc12b_2020_p21: failed

Run message: No verified proof after 8 attempts.

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


### imo_1969_p2: failed

Run message: No verified proof after 8 attempts.

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


### induction_pord1p1on2powklt5on2: failed

Run message: No verified proof after 8 attempts.

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

