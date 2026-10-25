// A project's repository and its uncommitted changes, for the Review panel
// (upstream `interfaces/diffs`, Apache-2.0). Upstream projects are git
// repositories; Mack makes a new project one (`git init`) when git is
// installed, and reviews any project folder that is one. Reading changes
// never writes to the repository: `changes` compares the working tree,
// staged or not, with HEAD (with nothing before the first commit) and adds
// the untracked files git does not ignore; `fileDiff` gives one file's diff.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export type ChangedFile = { path: string; status: "added" | "modified" | "deleted" | "renamed" | "untracked"; binary: boolean; added: number; removed: number };

const MAX_OUTPUT = 4_000_000;

function git(root: string, args: string[]): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = spawn("git", ["-C", root, "-c", "core.quotepath=false", ...args], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } });
    let out = "";
    let err = "";
    child.stdout.on("data", (d: Buffer) => {
      if (out.length < MAX_OUTPUT) out += d.toString("utf8");
    });
    child.stderr.on("data", (d: Buffer) => (err += d.toString("utf8")));
    child.on("error", (e) => resolve({ code: null, out, err: e.message }));
    child.on("close", (code) => resolve({ code, out, err }));
  });
}

export function isRepo(root: string): boolean {
  return existsSync(join(root, ".git"));
}

/** Make the folder a repository, if git is installed and it is not one; a failure leaves the project without Review. */
export async function initRepo(root: string): Promise<boolean> {
  if (isRepo(root)) return true;
  return (await git(root, ["init", "-q"])).code === 0;
}

async function hasHead(root: string): Promise<boolean> {
  return (await git(root, ["rev-parse", "--verify", "-q", "HEAD"])).code === 0;
}

/** The empty tree's id: what a repository with no commit is compared against. */
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

export async function changes(root: string): Promise<ChangedFile[]> {
  if (!isRepo(root)) throw new Error("this project folder is not a git repository");
  const base = (await hasHead(root)) ? "HEAD" : EMPTY_TREE;
  const numstat = await git(root, ["diff", "--numstat", "-z", "-M", base]);
  if (numstat.code !== 0) throw new Error(`git diff failed: ${numstat.err.trim()}`);
  const status = await git(root, ["diff", "--name-status", "-z", "-M", base]);
  const kinds = new Map<string, ChangedFile["status"]>();
  const parts = status.out.split("\0").filter(Boolean);
  for (let i = 0; i < parts.length; ) {
    const code = parts[i++];
    if (code.startsWith("R")) {
      i++;
      kinds.set(parts[i++], "renamed");
    } else kinds.set(parts[i++], code === "A" ? "added" : code === "D" ? "deleted" : "modified");
  }
  const out: ChangedFile[] = [];
  const ns = numstat.out.split("\0");
  for (let i = 0; i < ns.length; i++) {
    const line = ns[i];
    if (!line) continue;
    const [a, r, path] = line.split("\t");
    // A rename's numstat names the paths in the next two fields.
    const name = path === "" ? (i += 2, ns[i]) : path;
    out.push({ path: name, status: kinds.get(name) ?? "modified", binary: a === "-", added: Number(a) || 0, removed: Number(r) || 0 });
  }
  const untracked = await git(root, ["ls-files", "--others", "--exclude-standard", "-z"]);
  for (const p of untracked.out.split("\0").filter(Boolean)) out.push({ path: p, status: "untracked", binary: false, added: 0, removed: 0 });
  return out.sort((x, y) => x.path.localeCompare(y.path));
}

/** One file's unified diff against HEAD; an untracked file is shown whole as added. */
export async function fileDiff(root: string, path: string): Promise<string> {
  if (path.includes("..") || /^[a-zA-Z]:|^[\\/]/.test(path)) throw new Error("bad path");
  const tracked = (await git(root, ["ls-files", "--error-unmatch", "--", path])).code === 0;
  if (!tracked) {
    const r = await git(root, ["diff", "--no-index", "--no-color", "--", process.platform === "win32" ? "NUL" : "/dev/null", path]);
    return r.out || "(binary or empty file)";
  }
  const base = (await hasHead(root)) ? "HEAD" : EMPTY_TREE;
  const r = await git(root, ["diff", "--no-color", "-M", base, "--", path]);
  return r.out || "(no textual change)";
}
