# Community proofs

Results that Mack users proved in Lean and shared. Each entry is machine-checked: the repo's
**Community proofs** check builds it against Mathlib and runs Mack's strict verifier on it again
before it can be merged, so nothing here rests on anyone's word, the AI's included.

## What an entry is

```
community/proofs/<entry>/
  Statement.lean   the theorem, proved by `sorry`: what is claimed
  Proof.lean       the same file with the proof filled in
  README.md        what it says in plain words, where it came from, who shared it
  entry.json       the same facts for tools
```

The check accepts an entry when:

- `Proof.lean` contains the statement of `Statement.lean` exactly, with the same preamble;
- Lean checks it with no errors, no `sorry`, and only the standard axioms
  (`propext`, `Classical.choice`, `Quot.sound`);
- the folder holds only the four files above.

The Lean and Mathlib versions are pinned in [`lean/`](lean/). A change there re-checks every entry.

## Sharing a proof

**From Mack:** on a problem's plan, every result under *Proved by Lean* has a **Share** button.
It shows you exactly what will be published, then opens the pull request from your GitHub account,
forking this repo for you if needed. Connect GitHub in Settings first.

**By hand:** add a folder as above in a pull request. To run the check locally:

```sh
cd community/lean && lake exe cache get && cd ../..
npx tsc -p tsconfig.electron.json
node dist-electron/scripts/verify-community.js community/lean community/proofs/<entry>
```

## For maintainers

Make **Community proofs / verify** a required check on `main`. Merge an entry only when it passes,
and when the statement is worth keeping: it should say what its README says. Lean checks the proof,
not whether the statement means what was intended. Merging an entry does not publish an app release.
