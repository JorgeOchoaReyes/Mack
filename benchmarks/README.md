# Shared benchmark runs

Runs that Mack users shared from the Benchmark screen ("Share as a PR"), one
folder per run under `runs/`:

- `REPORT.md`: the settings, the solve rate and cost, the unsolved problems
  grouped by reason, and each unsolved problem's statement, last attempt and
  Lean's last feedback.
- `run.json`: the run as Mack saved it (settings, model names, every
  problem's result). No API keys or project files.

They show where Mack loses problems, so the next change can be chosen from
real failures rather than guesses.

## The benchmark site

`.github/workflows/benchmarks-site.yml` builds a leaderboard of every run here
(`core/bench/site.ts`, `scripts/build-bench-site.ts`) and publishes it on
GitHub Pages whenever a run is merged. A run shared with its attempts
(`attempts.jsonl`, one JSON line per attempt: the model, how it ended, why,
Lean's feedback and the candidate) also shows every attempt by reason and the
Lean errors that cost the most attempts.

Pages has to be turned on once: Settings → Pages → Source: GitHub Actions.
