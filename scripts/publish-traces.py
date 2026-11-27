# Publishes an official benchmark run's full traces to a Hugging Face dataset
# (.github/workflows/benchmark-run.yml): every attempt's whole thinking and
# reply, the Lean it wrote and Lean's verdict, one file per problem at
# runs/<run folder>/<problem>.jsonl. The site links each problem to its file.
#
#   python3 scripts/publish-traces.py <traces dir> <run folder>
#
# Needs HF_TOKEN (write access) and MACK_TRACES_DATASET (owner/name); the
# dataset is created on first use.

import os
import sys

from huggingface_hub import HfApi

CARD = """---
license: mit
pretty_name: Mack benchmark traces
configs:
- config_name: default
  data_files: "runs/*/*.jsonl"
---
# Mack benchmark traces

Every attempt of [Mack](https://github.com/JorgeOchoaReyes/Mack)'s official benchmark runs, in full:
the model's whole thinking and reply, the Lean it wrote, and Lean's verdict.

- One file per problem: `runs/<run>/<problem>.jsonl`, one line per attempt, in order.
- Fields: `problem`, `n` (attempt), `model`, `at`, `outcome`, `kind` (how it ended), `ms`, `tokens`,
  `promptTokens`, `truncated` (the reply hit its token limit), `thinking`, `reply`, `candidate` (the Lean file
  checked), `lean` (Lean's feedback).
- Scores, settings and the verified proofs: https://jorgeochoareyes.github.io/Mack/
- Anything that looked like a credential was masked before upload.
"""


def main() -> None:
    traces, folder = sys.argv[1], sys.argv[2]
    repo = os.environ["MACK_TRACES_DATASET"]
    api = HfApi(token=os.environ["HF_TOKEN"])
    api.create_repo(repo, repo_type="dataset", exist_ok=True)
    api.upload_file(path_or_fileobj=CARD.encode(), path_in_repo="README.md", repo_id=repo, repo_type="dataset", commit_message="Dataset card")
    run_url = os.environ.get("RUN_URL", "")
    api.upload_folder(folder_path=traces, path_in_repo=f"runs/{folder}", repo_id=repo, repo_type="dataset", commit_message=f"Traces of {folder} {run_url}".strip())
    print(f"https://huggingface.co/datasets/{repo}/tree/main/runs/{folder}")


if __name__ == "__main__":
    main()
