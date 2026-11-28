# Mack benchmark: miniF2F test, 12/20 solved (60.0%)

- Run 1795850810042, 2026-11-28T07:26:50.042Z, done; run with Mack 0.2.62, report by Mack 0.2.62
- Ran on 20 machines in parallel, each GitHub Actions ubuntu-latest, 16 GB, 4 CPUs, Lake version 5.0.0-src+c9afcdd (Lean version 4.36.0-rc1); Lean REPL on; Lean deadline 600s; 2 Lean processes
- Harness: Mack 0.2.62, Open Math Harness 687f2a2; procedures: strict verifier, linters off, pass@32: independent samples, checked as written, replies up to 64k tokens, thinking high
- Method: Attempts (Mack); model claude-opus-5.5; no prover model
- Thinking level: high
- 32 attempts, 8 at once, revisions before starting over 1; automation off; premise selection off; easier versions first off
- Spent $9.785 in 117 min; 0 solved by Lean's automation alone; budget $300

## Failures by reason

- **Model call failed**: 8 (imo_1992_p1, amc12a_2019_p12, amc12b_2020_p22, imo_1969_p2, numbertheory_notEquiv2i2jasqbsqdiv8, amc12b_2020_p13, induction_sumkexp3eqsumksq, imo_1963_p5). the provider refused or failed: the key, the model id or the provider's limits.

## All 190 attempts by how they ended

- Model call failed: 157 (83%)
- Verified: 12 (6%)
- Type mismatch: 7 (4%)
- Wrong lemma names: 6 (3%)
- Lean timed out: 4 (2%)
- Other Lean errors: 1 (1%)
- Tactics after the goal was closed: 1 (1%)
- Tactics did not close goals: 1 (1%)
- Statement changed or forbidden: 1 (1%)

## Commonest Lean errors

| Error | Attempts | Problems |
|---|---|---|
| Cheaper Inference returned N: {"error":{"message":"Wallet too low: this prompt could cost more than the wallet that pays for this key holds. Nothing was charged. Add funds in the dashboard, then sen | 122 | 13 |
| Cheaper Inference: The request timed out before the stream completed. | 35 | 4 |
| Unknown constant `…` | 7 | 2 |
| Type mismatch: After simplification, term | 3 | 1 |
| Application type mismatch: The argument | 3 | 1 |
| omega could not prove the goal: | 2 | 2 |
| Tactic `…` failed: Did not find an occurrence of the pattern | 1 | 1 |
| unsolved goals | 1 | 1 |
| expected interpolated string | 1 | 1 |
| unexpected token `…`; expected `…` | 1 | 1 |
| No goals to be solved | 1 | 1 |
| forbidden token `…` | 1 | 1 |

## Results

| Problem | Outcome | Attempts | Time | Cost | Reason |
|---|---|---|---|---|---|
| mathd_algebra_598 | solved | 1 | 1009s | $0.351 |  |
| imo_1992_p1 | failed | 0 | 1594s | $0.000 | Model call failed |
| imo_2001_p6 | solved | 1 | 1153s | $1.971 |  |
| amc12a_2019_p12 | failed | 0 | 5s | $0.000 | Model call failed |
| aime_1997_p9 | solved | 8 | 638s | $2.280 |  |
| mathd_algebra_513 | solved | 1 | 26s | $0.018 |  |
| mathd_numbertheory_618 | solved | 1 | 268s | $0.266 |  |
| amc12_2001_p5 | solved | 12 | 531s | $1.876 |  |
| amc12b_2020_p22 | failed | 0 | 5s | $0.000 | Model call failed |
| amc12b_2020_p21 | solved | 3 | 256s | $1.463 |  |
| imo_1969_p2 | failed | 0 | 5s | $0.000 | Model call failed |
| numbertheory_notEquiv2i2jasqbsqdiv8 | failed | 0 | 4s | $0.000 | Model call failed |
| amc12b_2020_p13 | failed | 0 | 5s | $0.000 | Model call failed |
| induction_sumkexp3eqsumksq | failed | 0 | 5s | $0.000 | Model call failed |
| imo_1963_p5 | failed | 0 | 5s | $0.000 | Model call failed |
| aime_1988_p8 | solved | 1 | 237s | $0.369 |  |
| imo_1983_p6 | solved | 1 | 963s | $0.232 |  |
| induction_pord1p1on2powklt5on2 | solved | 2 | 217s | $0.834 |  |
| mathd_numbertheory_728 | solved | 1 | 28s | $0.036 |  |
| aime_1989_p8 | solved | 1 | 36s | $0.089 |  |

## Unsolved problems

### imo_1992_p1: Model call failed

Attempts ended: model error 11.

Run message: No verified proof after 11 attempts. The last model call failed: Cheaper Inference: The request timed out before the stream completed.

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
Cheaper Inference: The request timed out before the stream completed.
```


### amc12a_2019_p12: Model call failed

Attempts ended: model error 11.

Run message: No verified proof after 11 attempts. The last model call failed: Cheaper Inference returned 400: {"error":{"message":"Wallet too low: this prompt could cost more than the wallet that pays for this key holds. Nothing was charged. Add funds in the dashboard, then send the prompt again. Rejected as an improperly formed request so routers do not send it elsewhere.","type":"invalid_request_error","para
…

Statement:
```lean
import Mathlib

set_option maxHeartbeats 400000

open BigOperators Real Nat Topology Rat

theorem amc12a_2019_p12 (x y : ℝ) (h : x > 0 ∧ y > 0) (h₀ : x ≠ 1 ∧ y ≠ 1)
    (h₁ : Real.log x / Real.log 2 = Real.log 16 / Real.log y) (h₂ : x * y = 64) :
    (Real.log (x / y) / Real.log 2) ^ 2 = 20 := by sorry
```

Lean's last feedback:
```
Cheaper Inference returned 400: {"error":{"message":"Wallet too low: this prompt could cost more than the wallet that pays for this key holds. Nothing was charged. Add funds in the dashboard, then send the prompt again. Rejected as an improperly formed request so routers do not send it elsewhere.","type":"invalid_request_error","param":"wallet","code":"wallet_too_low"}}
```


### amc12b_2020_p22: Model call failed

Attempts ended: model error 11.

Run message: No verified proof after 11 attempts. The last model call failed: Cheaper Inference returned 400: {"error":{"message":"Wallet too low: this prompt could cost more than the wallet that pays for this key holds. Nothing was charged. Add funds in the dashboard, then send the prompt again. Rejected as an improperly formed request so routers do not send it elsewhere.","type":"invalid_request_error","para
…

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
Cheaper Inference returned 400: {"error":{"message":"Wallet too low: this prompt could cost more than the wallet that pays for this key holds. Nothing was charged. Add funds in the dashboard, then send the prompt again. Rejected as an improperly formed request so routers do not send it elsewhere.","type":"invalid_request_error","param":"wallet","code":"wallet_too_low"}}
```


### imo_1969_p2: Model call failed

Attempts ended: model error 11.

Run message: No verified proof after 11 attempts. The last model call failed: Cheaper Inference returned 400: {"error":{"message":"Wallet too low: this prompt could cost more than the wallet that pays for this key holds. Nothing was charged. Add funds in the dashboard, then send the prompt again. Rejected as an improperly formed request so routers do not send it elsewhere.","type":"invalid_request_error","para
…

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
Cheaper Inference returned 400: {"error":{"message":"Wallet too low: this prompt could cost more than the wallet that pays for this key holds. Nothing was charged. Add funds in the dashboard, then send the prompt again. Rejected as an improperly formed request so routers do not send it elsewhere.","type":"invalid_request_error","param":"wallet","code":"wallet_too_low"}}
```


### numbertheory_notEquiv2i2jasqbsqdiv8: Model call failed

Attempts ended: model error 11.

Run message: No verified proof after 11 attempts. The last model call failed: Cheaper Inference returned 400: {"error":{"message":"Wallet too low: this prompt could cost more than the wallet that pays for this key holds. Nothing was charged. Add funds in the dashboard, then send the prompt again. Rejected as an improperly formed request so routers do not send it elsewhere.","type":"invalid_request_error","para
…

Statement:
```lean
import Mathlib

set_option maxHeartbeats 400000

open BigOperators Real Nat Topology Rat

theorem numbertheory_notEquiv2i2jasqbsqdiv8 :
  ¬ (∀ a b : ℤ, (∃ i j, a = 2*i ∧ b=2*j) ↔ (∃ k, a^2 + b^2 = 8*k)) := by sorry
```

Lean's last feedback:
```
Cheaper Inference returned 400: {"error":{"message":"Wallet too low: this prompt could cost more than the wallet that pays for this key holds. Nothing was charged. Add funds in the dashboard, then send the prompt again. Rejected as an improperly formed request so routers do not send it elsewhere.","type":"invalid_request_error","param":"wallet","code":"wallet_too_low"}}
```


### amc12b_2020_p13: Model call failed

Attempts ended: model error 11.

Run message: No verified proof after 11 attempts. The last model call failed: Cheaper Inference returned 400: {"error":{"message":"Wallet too low: this prompt could cost more than the wallet that pays for this key holds. Nothing was charged. Add funds in the dashboard, then send the prompt again. Rejected as an improperly formed request so routers do not send it elsewhere.","type":"invalid_request_error","para
…

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
Cheaper Inference returned 400: {"error":{"message":"Wallet too low: this prompt could cost more than the wallet that pays for this key holds. Nothing was charged. Add funds in the dashboard, then send the prompt again. Rejected as an improperly formed request so routers do not send it elsewhere.","type":"invalid_request_error","param":"wallet","code":"wallet_too_low"}}
```


### induction_sumkexp3eqsumksq: Model call failed

Attempts ended: model error 11.

Run message: No verified proof after 11 attempts. The last model call failed: Cheaper Inference returned 400: {"error":{"message":"Wallet too low: this prompt could cost more than the wallet that pays for this key holds. Nothing was charged. Add funds in the dashboard, then send the prompt again. Rejected as an improperly formed request so routers do not send it elsewhere.","type":"invalid_request_error","para
…

Statement:
```lean
import Mathlib

set_option maxHeartbeats 400000

open BigOperators Real Nat Topology Rat

theorem induction_sumkexp3eqsumksq
  (n : ℕ) :
  ∑ k ∈ Finset.range n, k^3 = (∑ k ∈ Finset.range n, k)^2 := by sorry
```

Lean's last feedback:
```
Cheaper Inference returned 400: {"error":{"message":"Wallet too low: this prompt could cost more than the wallet that pays for this key holds. Nothing was charged. Add funds in the dashboard, then send the prompt again. Rejected as an improperly formed request so routers do not send it elsewhere.","type":"invalid_request_error","param":"wallet","code":"wallet_too_low"}}
```


### imo_1963_p5: Model call failed

Attempts ended: model error 11.

Run message: No verified proof after 11 attempts. The last model call failed: Cheaper Inference returned 400: {"error":{"message":"Wallet too low: this prompt could cost more than the wallet that pays for this key holds. Nothing was charged. Add funds in the dashboard, then send the prompt again. Rejected as an improperly formed request so routers do not send it elsewhere.","type":"invalid_request_error","para
…

Statement:
```lean
import Mathlib

set_option maxHeartbeats 400000

open BigOperators Real Nat Topology Rat

theorem imo_1963_p5 :
  Real.cos (π / 7) - Real.cos (2 * π / 7) + Real.cos (3 * π / 7) = 1 / 2 := by sorry
```

Lean's last feedback:
```
Cheaper Inference returned 400: {"error":{"message":"Wallet too low: this prompt could cost more than the wallet that pays for this key holds. Nothing was charged. Add funds in the dashboard, then send the prompt again. Rejected as an improperly formed request so routers do not send it elsewhere.","type":"invalid_request_error","param":"wallet","code":"wallet_too_low"}}
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
