// A project's work as GitHub pull requests, so it can be reviewed and pulled
// from any computer. The first time, the project gets a private repository
// under the person's account (`origin`). Each pull request commits the
// working tree on the local branch and pushes that commit to a new
// `mack/…` branch, then opens a PR against the repository's default branch:
// the folder never switches branches, so the chat keeps working on the same
// files while a PR waits. The token is sent as an HTTP header for that one
// push, never written into the remote URL or git's config.

import { spawn } from "node:child_process";
import { basename } from "node:path";
import { git, initRepo } from "./git";

export type GitHubTokenSource = "env" | "saved" | "gh" | "none";

/** The token the GitHub CLI is logged in with, or "" when it is not installed or not logged in. */
export function ghCliToken(): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn("gh", ["auth", "token"], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString("utf8")));
    child.on("error", () => resolve(""));
    child.on("close", (code) => resolve(code === 0 ? out.trim() : ""));
  });
}

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function api<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "Mack", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { message?: string; errors?: { message?: string }[] };
    const detail = [j.message, ...(j.errors ?? []).map((e) => e.message)].filter(Boolean).join("; ");
    throw new GitHubError(`GitHub returned ${res.status}${detail ? `: ${detail}` : ""}`, res.status);
  }
  return (await res.json()) as T;
}

/** The account a token belongs to; throws when GitHub refuses it. */
export async function githubLogin(token: string): Promise<string> {
  return (await api<{ login: string }>(token, "GET", "/user")).login;
}

/** A repository name from a project folder: `odd-perfect-numbers`. */
export function repoName(folder: string): string {
  return (
    basename(folder)
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "")
      .slice(0, 90) || "mack-project"
  );
}

/** `owner/repo` of a GitHub remote URL (https or ssh), or undefined. */
export function parseGitHubRemote(url: string): { owner: string; repo: string } | undefined {
  const m = /github\.com[/:]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(url.trim());
  return m ? { owner: m[1], repo: m[2] } : undefined;
}

/** A branch for one PR: `mack/<title words>-<yyyymmdd-hhmm>`. */
export function prBranch(title: string, now = new Date()): string {
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
  return `mack/${words || "work"}-${stamp}`;
}

const auth = (token: string) => ["-c", `http.https://github.com/.extraheader=AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`, "-c", "credential.helper="];

async function must(root: string, args: string[], what: string): Promise<string> {
  const r = await git(root, args);
  if (r.code !== 0) throw new Error(`${what} failed: ${(r.err || r.out).trim().split("\n").slice(-3).join(" ")}`);
  return r.out.trim();
}

export type PullRequest = { url: string; repo: string; repoUrl: string; createdRepo: boolean; branch: string };

/** Commit the project's changes and open a PR with them; creates the private repository the first time. */
export async function openProjectPr(root: string, token: string, o: { title: string; body: string }): Promise<PullRequest> {
  if (!(await initRepo(root))) throw new Error("Git is not installed: install it from https://git-scm.com");
  const me = await api<{ login: string; id: number; name?: string | null }>(token, "GET", "/user");
  // Commits are authored as the GitHub account when the folder has no identity of its own.
  const identity = (await git(root, ["config", "user.email"])).code === 0 ? [] : ["-c", `user.name=${me.name || me.login}`, "-c", `user.email=${me.id}+${me.login}@users.noreply.github.com`];

  let createdRepo = false;
  // The URL as configured, before any `insteadOf` rewriting.
  const origin = await git(root, ["config", "--get", "remote.origin.url"]);
  let target = origin.code === 0 ? parseGitHubRemote(origin.out) : undefined;
  if (origin.code === 0 && !target) throw new Error(`this project's origin is not on GitHub: ${origin.out.trim()}`);
  if (!target) {
    const name = repoName(root);
    try {
      await api(token, "GET", `/repos/${me.login}/${name}`);
    } catch (e) {
      if (!(e instanceof GitHubError) || e.status !== 404) throw e;
      await api(token, "POST", "/user/repos", { name, private: true, description: "A Mack project", auto_init: false });
      createdRepo = true;
    }
    target = { owner: me.login, repo: name };
    await must(root, ["remote", "add", "origin", `https://github.com/${target.owner}/${target.repo}.git`], "git remote add");
  }
  const repo = await api<{ default_branch: string; html_url: string }>(token, "GET", `/repos/${target.owner}/${target.repo}`);
  const base = repo.default_branch || "main";

  // A first commit to open PRs against: empty, so the first PR holds all the work.
  if ((await git(root, ["rev-parse", "--verify", "-q", "HEAD"])).code !== 0) {
    await must(root, ["symbolic-ref", "HEAD", `refs/heads/${base}`], "git symbolic-ref");
    await must(root, [...identity, "commit", "--allow-empty", "-q", "-m", `Start ${target.repo}`], "git commit");
  }
  const remoteBase = await git(root, [...auth(token), "ls-remote", "--heads", "origin", base]);
  if (remoteBase.code !== 0) throw new Error(`could not reach GitHub: ${remoteBase.err.trim().split("\n").pop()}`);
  if (!remoteBase.out.trim()) await must(root, [...auth(token), "push", "-q", "origin", `HEAD:refs/heads/${base}`], "git push");

  await must(root, ["add", "-A"], "git add");
  if ((await git(root, ["diff", "--cached", "--quiet"])).code === 0) throw new Error("there is nothing new to put in a pull request: no changes since the last commit");
  await must(root, [...identity, "commit", "-q", "-m", o.title], "git commit");
  const branch = prBranch(o.title);
  await must(root, [...auth(token), "push", "-q", "origin", `HEAD:refs/heads/${branch}`], "git push");
  const pr = await api<{ html_url: string }>(token, "POST", `/repos/${target.owner}/${target.repo}/pulls`, { title: o.title, head: branch, base, body: o.body });
  return { url: pr.html_url, repo: `${target.owner}/${target.repo}`, repoUrl: repo.html_url, createdRepo, branch };
}
