// Several GitHub accounts, one chosen for publishing: accounts added with a
// pasted token, kept by Mack (encrypted, in electron/main.ts), and every
// account the GitHub CLI is logged in to. Pull requests (shared benchmark runs, community proofs,
// project PRs) go out under the chosen one.

import { spawn } from "node:child_process";

/** Where an account's token comes from: Mack's own store (a pasted token), or the GitHub CLI. */
export type AccountSource = "mack" | "gh";
export type GitHubAccount = { login: string; source: AccountSource };

function run(cmd: string, args: string[]): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString("utf8")));
    child.stderr.on("data", (d: Buffer) => (out += d.toString("utf8")));
    child.on("error", () => resolve({ code: null, out: "" }));
    child.on("close", (code) => resolve({ code, out }));
  });
}

/** The github.com accounts in `gh auth status` output, as JSON (`--json hosts`) or as text (older gh). */
export function parseGhAccounts(output: string): string[] {
  try {
    const j = JSON.parse(output) as { hosts?: Record<string, { login?: string; state?: string }[]> };
    const list = j.hosts?.["github.com"] ?? [];
    return [...new Set(list.filter((a) => a.login && (a.state ?? "success") === "success").map((a) => a.login!))];
  } catch {
    // Not JSON: the text form, "Logged in to github.com account <login> (…)".
  }
  const out = new Set<string>();
  for (const m of output.matchAll(/Logged in to github\.com (?:account |as )([A-Za-z0-9-]+)/g)) out.add(m[1]);
  return [...out];
}

/** Every github.com account the GitHub CLI is logged in to; none when it is not installed. */
export async function ghAccounts(): Promise<string[]> {
  const json = await run("gh", ["auth", "status", "--hostname", "github.com", "--json", "hosts"]);
  if (json.code !== null) {
    const found = parseGhAccounts(json.out);
    if (found.length) return found;
  }
  const text = await run("gh", ["auth", "status", "--hostname", "github.com"]);
  return text.code === null ? [] : parseGhAccounts(text.out);
}

/** The GitHub CLI's token for one of its accounts, or "" when it has none. */
export async function ghToken(login: string): Promise<string> {
  const r = await run("gh", ["auth", "token", "--hostname", "github.com", "--user", login]);
  return r.code === 0 ? r.out.trim().split("\n")[0] : "";
}

/** Which account publishes: the chosen one when it is still connected, else the first one there is. */
export function activeAccount(accounts: GitHubAccount[], chosen: string | undefined): GitHubAccount | undefined {
  return accounts.find((a) => a.login.toLowerCase() === chosen?.toLowerCase()) ?? accounts[0];
}
