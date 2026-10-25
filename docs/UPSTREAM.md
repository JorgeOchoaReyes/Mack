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
| `interfaces/swarm` (Ultramath) + `prompts/templates/agents/swarm/*`, `roles/swarm-member.toml` | `core/ultramath/swarm.ts` | Adapted: a tagged text protocol instead of tools; the Lean verifier judges Lean problems, the coordinating agent judges informal ones; no resume |
| `program-files/chat-agent` (agent loop and tools: fs, lean, web, pdf) | `core/chat/agent.ts`, `core/chat/tools.ts`, `core/chat/web.ts`, `electron/chat.ts` | Adapted: a text tool protocol so any model works; tools confined to the project folder in-process |
| `program-files/chat-agent` `stream.rs`, `retry.rs`, nudge, "Between steps", `reminders.rs`, `attachments.rs`, `images.rs`, `reply_images.rs`, `jobs.rs` | `core/chat/agent.ts`, `core/model/openai-compatible.ts`, `core/chat/shell.ts`, `electron/chat.ts`, `src/pages/ChatPage.tsx` | Adapted |
| `interfaces/shell` (`exec`, background jobs) | `core/chat/shell.ts` (PowerShell in the project folder; every command approved) | Adapted |
| `interfaces/web` `request` | `core/chat/executor.ts` `http_request` (protected) | Ported |
| `interfaces/skills` + `program-files/skills` | `core/chat/skills.ts`; `/skill` in `electron/chat.ts` | Adapted: load from a SKILL.md URL; no catalogs yet |
| `interfaces/suggestions` + `prompts/templates/suggest/*` | `core/chat/suggestions.ts` | Ported |
| `prompts/templates/compact/*` (context checkpoint) | `core/chat/suggestions.ts`, `core/chat/agent.ts` | Ported |
| `interfaces/memory` `used` (citations) | `core/chat/memory.ts` `recordCitations` | Adapted: counts feed consolidation |
| `program-files/mcp` (stdio + Streamable HTTP adapter) | `core/mcp/client.ts` | Ported: mapped tools only, 1 MiB bounds, no OAuth |
| `program-files/chat-agent/src/plugins.rs` + `program-files/plugin-development` | `core/mcp/plugins.ts`, `plugin_*` and `mcp_connect` tools | Adapted: plugins are stdio MCP servers; instances belong to one chat and end with it |
| `interfaces/diffs` (Review of uncommitted changes) | `core/git.ts`, Review panel in `src/pages/ChatPage.tsx` | Ported: read-only |
| `interfaces/publish` + `program-files/publish` rules v1 (secret scan) | `core/secrets.ts` | Adapted: no platform; marks messages, masks memory input and exports |
| `interfaces/approvals` + `program-files/approvals` (guard runs the recorded call) | `core/chat/executor.ts` | Adapted: per-tool ask/allow policy; approvals are single-use and bound to the recorded call |
| `program-files/memory` + `memories/write` and `memories/read` templates (extract, consolidate, read path) | `core/chat/memory.ts` | Adapted: extraction and consolidation are model calls returning files |
| `kernel/` + `platform/` (capability microkernel, bubblewrap confinement) | — | Not ported: Linux-only. Mack restricts each agent's tools in-process instead, which is weaker. |
| `program-files/openrouter` | `core/model/openai-compatible.ts` behind `core/model/provider.ts`; `core/model/providers.ts` lists Fireworks, OpenRouter and a custom endpoint | Adapted: any OpenAI-compatible provider, OpenRouter among them |
