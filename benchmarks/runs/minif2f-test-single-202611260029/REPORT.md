# Mack benchmark: miniF2F test, 20/20 solved (100.0%)

- Run 1795652956762, 2026-11-26T00:29:16.762Z, done; run with Mack 0.2.29, report by Mack 0.2.29
- Ran on macOS 25.5.0, 16 GB, Lake version 5.0.0-src+611c117 (Lean version 4.36.0); Lean REPL on; Lean deadline 600s; 1 Lean processes
- Harness: Mack 0.2.29, Open Math Harness 687f2a2; procedures: strict verifier, linters off, dead-tactic repair, name repair, automation sweep, premise selection, thinking medium, restart after 4 revisions, run-wide lemma pool
- Method: Attempts (Mack); model us/gpt-6.1-sol; no prover model
- Thinking level: medium
- 8 attempts, 1 at once, revisions before starting over 4; automation on; premise selection on; easier versions first off
- Spent $0.677 in 107 min; 3 solved by Lean's automation alone; budget $5

## Failures by reason

None.

## All 27 attempts by how they ended

- Verified: 20 (74%)
- Tactics did not close goals: 2 (7%)
- Lean timed out: 2 (7%)
- Type mismatch: 2 (7%)
- Gaps automation could not close: 1 (4%)

## Commonest Lean errors

| Error | Attempts | Problems |
|---|---|---|
| unsolved goals | 2 | 2 |
| failed to prove positivity/nonnegativity/nonzeroness | 1 | 1 |
| Unknown constant `…` | 1 | 1 |
| Application type mismatch: The argument | 1 | 1 |
| sorry left open | 1 | 1 |
| Tactic `…` failed: Did not find an occurrence of the pattern | 1 | 1 |

## Results

| Problem | Outcome | Attempts | Time | Cost | Reason |
|---|---|---|---|---|---|
| mathd_algebra_598 | solved | 1 | 340s | $0.024 |  |
| imo_1992_p1 | solved | 2 | 436s | $0.076 |  |
| imo_2001_p6 | solved | 2 | 507s | $0.103 |  |
| amc12a_2019_p12 | solved | 1 | 311s | $0.025 |  |
| aime_1997_p9 | solved | 2 | 404s | $0.046 |  |
| mathd_algebra_513 | solved | 0 | 221s | $0.002 | automation |
| mathd_numbertheory_618 | solved | 1 | 256s | $0.021 |  |
| amc12_2001_p5 | solved | 2 | 325s | $0.040 |  |
| amc12b_2020_p22 | solved | 1 | 283s | $0.018 |  |
| amc12b_2020_p21 | solved | 3 | 499s | $0.091 |  |
| imo_1969_p2 | solved | 2 | 357s | $0.071 |  |
| numbertheory_notEquiv2i2jasqbsqdiv8 | solved | 1 | 313s | $0.011 |  |
| amc12b_2020_p13 | solved | 1 | 285s | $0.021 |  |
| induction_sumkexp3eqsumksq | solved | 1 | 266s | $0.016 |  |
| imo_1963_p5 | solved | 1 | 282s | $0.021 |  |
| aime_1988_p8 | solved | 1 | 297s | $0.021 |  |
| imo_1983_p6 | solved | 1 | 326s | $0.027 |  |
| induction_pord1p1on2powklt5on2 | solved | 1 | 300s | $0.031 |  |
| mathd_numbertheory_728 | solved | 0 | 242s | $0.007 | automation |
| aime_1989_p8 | solved | 0 | 169s | $0.006 | automation |

## How to read this report

- **Solved.** Lean's strict verifier accepted the proof: the statement is unchanged, no sorry or extra axiom is used, and Lean's kernel checks it. Nothing else counts, whatever the model says.
- **The problems.** miniF2F has 244 competition problems (AIME, AMC, IMO, MATH exercises); PutnamBench has Putnam problems since 1962 and is much harder. The same number of problems always picks the same ones, so runs compare.
- **Methods.** Attempts: the model writes whole proofs and fixes them from Lean's errors. Decompose: if that fails, the statement is split into lemmas that are proved separately and put back together. Step by step: the proof is built one tactic at a time on Lean's live proof states, keeping only steps Lean accepts.
- **Solve rate and cost.** In the app, solved problems out of those tried; on the public site, out of the whole sample, so a skipped problem counts as unsolved. Per solve is the run's whole cost divided by the problems solved. Cost, time and tokens are as the run reported them.
- **Attempts.** One attempt is one proof the model wrote and Lean checked. Attempts per solve is how many the solved problems took on average; fewer means the model gets there sooner.
- **By automation alone.** Problems Lean's own tactics (omega, simp, linarith, aesop, …) closed before any model call: free, and a floor every model starts from.
- **Why not solved.** Each failed attempt is labelled from Lean's errors: wrong lemma names, type mismatch, goals left open, timeouts, and so on. A problem's reason is its most common one; its timeline shows every attempt.
- **Range.** The 95% range of a solve rate: with few problems it is wide (13 of 20 is 43–82%), so two runs are only told apart when their ranges barely overlap. Only runs on the whole set are ranked.
- **Solved within k.** How many problems were solved within 1, 4, 16 or 64 model attempts. Like the labs' pass@k, but Mack's attempts learn from Lean's errors where pass@k samples independently, so compare with care.
- **Recent problems.** The latest Putnam competitions, as a contamination check: a model trained before they were set cannot have memorized their proofs. A big drop from older problems suggests memory helped there.
- **Mack's own failures.** If Lean could not start, crashed or lost its connection, the attempt is labelled "Mack or Lean failed to run", never blamed on the model. Many of these mean something to fix in Mack or the setup, not in the model.
