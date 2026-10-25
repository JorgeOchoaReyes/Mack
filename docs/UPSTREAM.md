# Following Open Math Harness

Mack follows the methodology of
[Open Math Harness](https://github.com/openmathmodel/open-math-harness). This
file maps their modules to ours. `upstream.json` records the upstream commit
Mack is aligned with (`baseline`) and the paths that count as methodology
(`watched`).

## How updates reach Mack

1. **In the app.** Each time Mack opens, it asks GitHub what changed in the
   watched paths since `baseline`. If something did, a banner lists the
   files and links to the diff. Users can turn the check off in Settings, or
   click **Stay on this version** to stay on their current methodology until
   upstream changes again. The check only reports changes; it never changes
   Mack's behaviour.
2. **In the repo.** `.github/workflows/upstream-watch.yml` runs weekly and
   opens an issue when watched paths changed.
3. **Porting.** A maintainer ports the change, updates the mapping below,
   and bumps `baseline` in `upstream.json` in the same commit.

## Module map

| Upstream | Mack | Status |
|---|---|---|
| `interfaces/lean/src/rules.rs` (forbidden tokens, frozen statement, preamble) | `core/lean/rules.ts` | Ported |
| `program-files/lean/src/verify.rs` (strict verify: axioms, `pp.all` type match, report marker) | `core/lean/verify.ts` | Ported |
| `program-files/lean` `check` on a resident Lean REPL | `core/lean/runner.ts` (`lake env lean` per call, no REPL) | Simplified |
| `program-files/prover` + `program-files/discovery` + `interfaces/explore` (proof search tree) | — | Planned, step 2 |
| `interfaces/swarm` (Ultramath) | — | Planned, step 3 |
| `program-files/chat-agent`, tools, `program-files/memory`, `program-files/approvals` | — | Planned, step 4 |
| `kernel/` + `platform/` (capability microkernel, bubblewrap confinement) | — | Not ported: Linux-only. Mack restricts each agent's tools in-process instead, which is weaker. |
| `program-files/openrouter` | `core/model/fireworks.ts` behind `core/model/provider.ts` | Replaced: Fireworks |
