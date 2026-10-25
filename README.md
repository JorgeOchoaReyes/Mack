# Mack ⚡

A Windows desktop app for Lean-checked math research. Open models (through
[Fireworks](https://fireworks.ai), [OpenRouter](https://openrouter.ai) or any
OpenAI-compatible server) propose proofs; **Lean decides** whether they hold.

Mack follows the methodology of
[Open Math Harness](https://github.com/openmathmodel/open-math-harness), the
runtime of Open Math OS, which is Linux-only and needs the Open Math OS
deployment to run. Mack ports its methods into an app that runs on a personal
Windows machine. See [docs/UPSTREAM.md](docs/UPSTREAM.md) for what is ported
and how Mack keeps up with upstream.

## What it does today

- **Prove.** Write or open a Lean statement, press Prove, and watch each
  attempt: the model writes a proof, Lean's errors go back to it, and it
  revises until the strict verifier accepts or attempts run out.
- **Proof search tree.** Switch Prove to *Search tree* and several workers
  branch out from the statement in parallel. Each hands back one file, which
  may keep `sorry` gaps; Lean scores it, and later rounds continue the most
  promising nodes instead of starting over, until the verifier accepts one.
- **Ultramath.** Several members attack one hard problem, each on a
  direction no other holds (a duplicate is refused), sharing a board of
  lemmas, counterexamples and dead ends. With a Lean statement the strict
  verifier judges submissions; for a problem written in plain words, a
  coordinating agent referees them, as upstream's does.
- **Research chat.** Projects are folders. The assistant reads and searches
  project files and PDFs, checks and verifies Lean, searches and reads the
  web, and, once you approve each exact call, writes files or starts proof
  runs. What it can do is listed in the app and is nothing more.
- **Project memory.** When you leave a chat, Mack (not the assistant) writes a
  record of it and folds the records into a short index that later chats
  are given as notes about the past. No chat can write memory by asking.
- **Fast checks.** A resident Lean REPL keeps Mathlib loaded, so checking a
  partial proof takes seconds and shows the goal left at each `sorry`. The
  final verification still runs in a fresh Lean process.
- **Strict verification**, ported from upstream. A proof counts only if:
  - the frozen theorem statement appears word for word and the preamble is
    unchanged;
  - it contains no `sorry`, `axiom`, `native_decide`, `pp`/`debug` options or
    metaprogramming;
  - Lean elaborates it;
  - it depends only on `propext`, `Classical.choice` and `Quot.sound`;
  - its fully elaborated type matches the original statement exactly.
- **Your choice of model provider.** Fireworks, OpenRouter, or any
  OpenAI-compatible endpoint (Ollama, LM Studio, vLLM), each with its own key
  and model, switchable per run from the Prove screen.
- **One-click setup.** Mack installs Lean (elan) and a Mathlib workspace with
  its prebuilt cache, with progress shown in the app.
- **History.** Every run is kept locally, with each attempt and what Lean said.
- **Upstream tracking.** On launch, Mack checks whether Open Math Harness
  changed its methodology. The check is optional, and you can stay on your
  current version.

## Roadmap

Each step ports one part of Open Math Harness; docs/UPSTREAM.md maps the
upstream module each comes from.

- [x] **1. Verified proving.** Strict Lean verifier, single-agent prove loop,
  one-click Lean setup, run history, upstream tracking, Windows installer.
- [x] **2. Proof search tree.** Keep partial proofs (with `sorry`) as a tree,
  let parallel workers extend the most promising branches, and let later
  rounds build on earlier ones instead of starting over. From upstream
  `program-files/prover`, `program-files/discovery`, `interfaces/explore`.
  Includes a resident Lean REPL for fast checks of partial proofs, replacing
  one `lake env lean` run per check.
- [x] **3. Ultramath.** Several agents attack one hard problem from different
  directions: a duplicate check on proposed directions, a shared board of
  lemmas, counterexamples and dead ends, and a coordinating agent that
  reviews reports and accepts a solution. From upstream `interfaces/swarm`.
- [x] **4. Chat with tools and memory.** A research chat whose agent can read
  and write project files, run Lean, search the web and PDFs, and keep a
  per-project memory across sessions, with protected actions waiting for
  your approval. From upstream `program-files/chat-agent`,
  `program-files/memory`, `program-files/approvals`.
- [x] **5. More model providers.** OpenRouter and other OpenAI-compatible
  endpoints next to Fireworks, chosen per run.
- [ ] **6. Distribution.** A code-signed installer (no SmartScreen warning),
  GitHub Releases with auto-update, and the upstream check comparing against
  the installed version.

Not planned: upstream's capability microkernel and bubblewrap sandboxing are
Linux-only. Mack limits each agent's tools inside the app instead, which is
weaker. The chat's *What it can do* panel states exactly what its agent can
do: its file tools resolve every path inside the project folder (links
included), writes and proof runs wait for your approval, and memory is kept
outside the project folder where no tool reaches.

## Install

You need Windows 10 or 11, [Git](https://git-scm.com) (Lake fetches Mathlib
with it), about 10 GB of free disk, and **your own model provider key**
(Fireworks or OpenRouter), or a local OpenAI-compatible server. No key or
credential ships with Mack.

From source:

```powershell
git clone https://github.com/JorgeOchoaReyes/Mack.git
cd Mack
npm install
npm run dist        # builds release\Mack Setup <version>.exe
```

Run the installer. It installs Mack for your user and adds Start-menu and
desktop shortcuts. Then open Mack and follow **Setup**:

1. **Lean and Mathlib**: click *Install*. It takes 5–20 minutes and about
   5 GB, mostly Mathlib's prebuilt cache.
2. **Model provider and key**: pick Fireworks, OpenRouter or a custom
   endpoint and paste your key. It is encrypted with Windows' credential
   protection and only sent to that provider. For development you can instead
   copy `.env.example` to `.env` and set `FIREWORKS_API_KEY`,
   `OPENROUTER_API_KEY` or `CUSTOM_API_KEY`; `.env` is gitignored.
3. **Model**: pick one from your account's list.

## Development

```powershell
npm start            # build and run without installing
npm test             # verifier rules and upstream check; no Lean or key needed
npm run typecheck
$env:MACK_LEAN_WORKSPACE="$env:USERPROFILE\mack-lean"; npm test   # also run the verifier against real Lean
npm run setup:lean   # the same Lean setup as the app, from the terminal
```

## License

Apache-2.0. Adapts code from Open Math Harness (Apache-2.0); see NOTICE.
