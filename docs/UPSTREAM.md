# Following Open Math Harness

Mack follows the methodology of
[Open Math Harness](https://github.com/openmathmodel/open-math-harness). This
file maps their modules to ours. `upstream.json` records the upstream commit
Mack is aligned with (`baseline`) and the paths that count as methodology
(`watched`).

## How updates reach Mack

1. **In the app.** Mack asks GitHub what changed in the watched paths since
   `baseline` when it opens and every 6 hours while it runs. If something
   changed, a yellow banner appears, and the **Upstream** screen lists the
   changed files by area, shows which Mack module each maps to, and lists the
   recent upstream commits. Users can turn the checks off, or choose **Stay on
   the current version** to hide the notice until upstream changes again.
   The check only reports changes; it never changes Mack's behaviour.
2. **In the repo.** `.github/workflows/upstream-watch.yml` runs weekly and
   opens an issue when watched paths changed.
3. **Porting.** A maintainer runs `npm run upstream` to see the changes
   grouped by Mack module, ports what applies, runs
   `npm run upstream -- --accept` to move `baseline` to the upstream head,
   and commits that together with the port and any update to the map below.

`upstream.json` lists each watched upstream path with its area and the Mack
module it maps to. Add an entry there when Mack starts following a new
upstream module.

## Module map

| Upstream | Mack | Status |
|---|---|---|
| `interfaces/lean/src/rules.rs` (forbidden tokens, frozen statement, preamble) | `core/lean/rules.ts` | Ported |
| `program-files/lean/src/verify.rs` (strict verify: axioms, `pp.all` type match, report marker) | `core/lean/verify.ts` | Ported |
| `program-files/lean` `check` on a resident Lean REPL | `core/lean/repl.ts` (leanprover-community/repl, built by setup) and `core/lean/check.ts`; `core/lean/runner.ts` as the fallback | Adapted: the community REPL instead of upstream's own |
| `program-files/discovery` (rollout, `admit`, `InitialPolicy`) + `interfaces/explore` (CONTINUE(v)) | `core/search/tree.ts`, `core/search/search.ts` | Adapted: in-process workers; no plan board or resume yet |
| `interfaces/discovery/src/scoring.rs` (scoring v3) | `core/search/tree.ts` (`scoreOf`, `partialScore`) | Simplified: closed `have` steps count without the automation-suite and hollow-leaf analysis |
| `program-files/prover/prompts/putnam.j2` (fixed-loop worker prompt) | `core/search/search.ts` (`workerSystem`) | Ported, competition framing made general |
| `interfaces/swarm` (Ultramath) | — | Planned, roadmap step 3 |
| `program-files/chat-agent`, tools, `program-files/memory`, `program-files/approvals` | — | Planned, roadmap step 4 |
| `kernel/` + `platform/` (capability microkernel, bubblewrap confinement) | — | Not ported: Linux-only. Mack restricts each agent's tools in-process instead, which is weaker. |
| `program-files/openrouter` | `core/model/fireworks.ts` behind `core/model/provider.ts` | Replaced: Fireworks |
