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
