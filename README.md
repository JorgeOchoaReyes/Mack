# Mack

A desktop app for Lean-checked math research on Windows. Open models (through
[Fireworks](https://fireworks.ai)) propose proofs; **Lean decides** whether
they hold.

Mack follows the methodology of
[Open Math Harness](https://github.com/openmathmodel/open-math-harness), the
runtime of Open Math OS, which is Linux-only and needs the Open Math OS
deployment to run. Mack ports its methods into an app that runs on a personal
Windows machine. See [docs/UPSTREAM.md](docs/UPSTREAM.md) for what is ported
and how Mack keeps up with upstream.

## What works today (v0.1)

- **Strict proof verification**, ported from upstream. A proof counts only if:
  - the frozen theorem statement appears word for word and the preamble is
    unchanged;
  - it contains no `sorry`, `axiom`, `native_decide`, `pp`/`debug` options or
    metaprogramming;
  - Lean elaborates it;
  - it depends only on `propext`, `Classical.choice` and `Quot.sound`;
  - its fully elaborated type matches the original statement exactly.
- **A single-agent prove loop**: the model proposes a file, Lean's errors are
  fed back, and this repeats until the verifier accepts or attempts run out.
- **Upstream tracking**: on launch, Mack checks whether Open Math Harness
  changed its methodology (optional, and you can choose to stay on your
  current version).

Planned: a proof search tree, Ultramath (parallel agents), chat with tools,
project memory. See the module map in docs/UPSTREAM.md.

## Setup

You need Windows, [Node.js](https://nodejs.org) 22+, about 10 GB of disk for
Lean and Mathlib, and **your own Fireworks API key**. No key or credential
ships with this repository.

```powershell
git clone https://github.com/JorgeOchoaReyes/Mack.git
cd Mack
npm install
npm run setup:lean      # installs elan + a Mathlib workspace at %USERPROFILE%\mack-lean (~5 GB download)
npm start
```

Then, in Settings:

1. **Fireworks API key**: paste it and click *Save key*. It is stored
   encrypted with your OS keystore. Alternatively copy `.env.example` to
   `.env` and set `FIREWORKS_API_KEY` there. `.env` is gitignored.
2. **Model**: click *Load models* and pick one, or type a Fireworks model id.
3. **Lean workspace**: the folder `setup:lean` printed.

## Development

```powershell
npm test          # verifier rules and upstream check; no Lean or key needed
npm run typecheck
```

## License

Apache-2.0. Adapts code from Open Math Harness (Apache-2.0); see NOTICE.
