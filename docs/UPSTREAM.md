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
| `program-files/lean` `check` on a resident Lean REPL | `core/lean/runner.ts` (`lake env lean` per call, no REPL) | Simplified |
| `program-files/prover` + `program-files/discovery` + `interfaces/explore` (proof search tree) | — | Planned, step 2 |
| `interfaces/swarm` (Ultramath) | — | Planned, step 3 |
| `program-files/chat-agent`, tools, `program-files/memory`, `program-files/approvals` | — | Planned, step 4 |
| `kernel/` + `platform/` (capability microkernel, bubblewrap confinement) | — | Not ported: Linux-only. Mack restricts each agent's tools in-process instead, which is weaker. |
| `program-files/openrouter` | `core/model/fireworks.ts` behind `core/model/provider.ts` | Replaced: Fireworks |
