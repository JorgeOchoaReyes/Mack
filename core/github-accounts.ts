// Several GitHub accounts, one chosen for publishing: accounts signed in
// through the browser (GitHub's device flow) or with a pasted token, kept by
// Mack (encrypted, in electron/main.ts), and every account the GitHub CLI is
// logged in to. Pull requests (shared benchmark runs, community proofs,
// project PRs) go out under the chosen one.

import { spawn } from "node:child_process";

/** Where an account's token comes from: Mack's own store (browser sign-in or pasted token), or the GitHub CLI. */
export type AccountSource = "mack" | "gh";
export type GitHubAccount = { login: string; source: AccountSource };

/** The OAuth app Mack signs in with (its client ID is public; the device flow needs no secret). Empty until the app is registered. */
export const GITHUB_CLIENT_ID = process.env.MACK_GITHUB_CLIENT_ID ?? "";
/** What a browser sign-in asks for: repositories and pull requests (to share runs, proofs and projects), and the account name. */
export const GITHUB_SCOPES = "repo read:user";

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

export type DeviceCode = { deviceCode: string; userCode: string; verificationUri: string; interval: number; expiresIn: number };

/** Start a browser sign-in: GitHub gives a code for the person to enter at `verificationUri`. */
export async function startDeviceFlow(clientId = GITHUB_CLIENT_ID, f: typeof fetch = fetch): Promise<DeviceCode> {
  if (!clientId) throw new Error("Sign-in through the browser is not set up in this build of Mack: paste a token instead.");
  const res = await f("https://github.com/login/device/code", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "Mack" },
    body: JSON.stringify({ client_id: clientId, scope: GITHUB_SCOPES }),
  });
  const j = (await res.json().catch(() => ({}))) as { device_code?: string; user_code?: string; verification_uri?: string; interval?: number; expires_in?: number; error_description?: string };
  if (!res.ok || !j.device_code || !j.user_code) throw new Error(`GitHub did not start the sign-in${j.error_description ? `: ${j.error_description}` : ` (HTTP ${res.status})`}`);
  return { deviceCode: j.device_code, userCode: j.user_code, verificationUri: j.verification_uri ?? "https://github.com/login/device", interval: j.interval ?? 5, expiresIn: j.expires_in ?? 900 };
}

/**
 * Wait for the person to approve the sign-in in the browser, then return the
 * token. GitHub answers "authorization_pending" until then and "slow_down"
 * when asked too often; anything else ends the wait.
 */
export async function finishDeviceFlow(code: DeviceCode, o: { clientId?: string; signal?: AbortSignal; fetch?: typeof fetch; sleep?: (ms: number) => Promise<void> } = {}): Promise<string> {
  const f = o.fetch ?? fetch;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const clientId = o.clientId ?? GITHUB_CLIENT_ID;
  let interval = Math.max(1, code.interval);
  const deadline = Date.now() + code.expiresIn * 1000;
  while (Date.now() < deadline) {
    if (o.signal?.aborted) throw new Error("Sign-in cancelled.");
    await sleep(interval * 1000);
    if (o.signal?.aborted) throw new Error("Sign-in cancelled.");
    const res = await f("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "Mack" },
      body: JSON.stringify({ client_id: clientId, device_code: code.deviceCode, grant_type: "urn:ietf:params:oauth:grant-type:device_code" }),
    });
    const j = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string; error_description?: string; interval?: number };
    if (j.access_token) return j.access_token;
    if (j.error === "authorization_pending") continue;
    if (j.error === "slow_down") {
      interval = Math.max(interval + 5, j.interval ?? 0);
      continue;
    }
    if (j.error === "expired_token") break;
    if (j.error === "access_denied") throw new Error("The sign-in was declined on GitHub.");
    throw new Error(`GitHub refused the sign-in: ${j.error_description ?? j.error ?? `HTTP ${res.status}`}`);
  }
  throw new Error("The sign-in code expired before it was approved: start again.");
}

/** Which account publishes: the chosen one when it is still connected, else the first one there is. */
export function activeAccount(accounts: GitHubAccount[], chosen: string | undefined): GitHubAccount | undefined {
  return accounts.find((a) => a.login.toLowerCase() === chosen?.toLowerCase()) ?? accounts[0];
}
