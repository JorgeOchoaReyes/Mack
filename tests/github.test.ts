import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prBody, verifiedPairs } from "../core/chat/pr";
import type { StoredMessage } from "../core/chat/agent";
import { openProjectPr, parseGitHubRemote, prBranch, repoName } from "../core/github";

const hasGit = (() => {
  try {
    execFileSync("git", ["--version"]);
    return true;
  } catch {
    return false;
  }
})();

afterEach(() => vi.unstubAllGlobals());

describe.skipIf(!hasGit)("opening project pull requests (git for real, GitHub faked)", () => {
  it("creates the repository once, opens PRs from the working tree, and never switches branches", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "mack-pr-"));
    try {
      const bare = join(tmp, "remote.git");
      execFileSync("git", ["init", "-q", "--bare", bare]);
      const root = join(tmp, "Odd Perfect");
      await mkdir(join(root, "Proofs"), { recursive: true });
      await writeFile(join(root, "Proofs", "T.lean"), "theorem t : 1 + 1 = 2 := rfl\n");
      execFileSync("git", ["init", "-q", root]);
      // Pushes to the repository Mack creates land in the local bare repository.
      execFileSync("git", ["-C", root, "config", "url.file:///" + bare.replace(/\\/g, "/") + ".insteadOf", "https://github.com/me/odd-perfect.git"]);
      execFileSync("git", ["-C", root, "config", "user.email", "t@example.com"]);
      execFileSync("git", ["-C", root, "config", "user.name", "T"]);

      let exists = false;
      const pulls: { head: string; base: string; title: string }[] = [];
      vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
        const path = new URL(url).pathname;
        const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
        if (path === "/user") return json({ login: "me", id: 7 });
        if (path === "/user/repos") return (exists = true), json({}, 201);
        if (path === "/repos/me/odd-perfect") return exists ? json({ default_branch: "main", html_url: "https://github.com/me/odd-perfect" }) : json({ message: "Not Found" }, 404);
        if (path === "/repos/me/odd-perfect/pulls") return pulls.push(JSON.parse(String(init?.body))), json({ html_url: `https://github.com/me/odd-perfect/pull/${pulls.length}` }, 201);
        return json({ message: `unexpected ${path}` }, 500);
      });

      const first = await openProjectPr(root, "tok", { title: "First proof", body: "b" });
      expect(first).toMatchObject({ url: "https://github.com/me/odd-perfect/pull/1", repo: "me/odd-perfect", createdRepo: true });
      await writeFile(join(root, "NOTES.md"), "# notes\n");
      const second = await openProjectPr(root, "tok", { title: "Notes", body: "b" });
      expect(second.createdRepo).toBe(false);
      await expect(openProjectPr(root, "tok", { title: "Nothing", body: "b" })).rejects.toThrow("nothing new");

      expect(pulls.map((p) => [p.base, p.title])).toEqual([
        ["main", "First proof"],
        ["main", "Notes"],
      ]);
      const git = (...a: string[]) => execFileSync("git", ["--git-dir", bare, ...a], { encoding: "utf8" }).trim();
      expect(git("log", "--format=%s", "main")).toBe("Start odd-perfect");
      expect(git("show", "--name-only", "--format=", first.branch)).toBe("Proofs/T.lean");
      expect(git("show", "--name-only", "--format=", second.branch)).toBe("NOTES.md");
      expect(execFileSync("git", ["-C", root, "branch", "--show-current"], { encoding: "utf8" }).trim()).toBe("main");
      // The token was only ever a per-command header.
      expect(execFileSync("git", ["-C", root, "config", "--list"], { encoding: "utf8" })).not.toContain("tok");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("project pull requests", () => {
  it("names the repository after the project folder", () => {
    expect(repoName("C:\\Users\\J\\MackProjects\\Odd Perfect Numbers")).toBe("odd-perfect-numbers");
    expect(repoName("/x/...")).toBe("mack-project");
  });

  it("reads GitHub remotes over https and ssh, and nothing else", () => {
    expect(parseGitHubRemote("https://github.com/me/proofs.git\n")).toEqual({ owner: "me", repo: "proofs" });
    expect(parseGitHubRemote("git@github.com:me/proofs.git")).toEqual({ owner: "me", repo: "proofs" });
    expect(parseGitHubRemote("https://gitlab.com/me/proofs.git")).toBeUndefined();
  });

  it("makes a branch per PR from its title and time", () => {
    expect(prBranch("Odd perfect numbers: not a prime power!", new Date(2026, 9, 25, 22, 5))).toBe("mack/odd-perfect-numbers-not-a-prime-power-20261025-2205");
    expect(prBranch("???", new Date(2026, 0, 2, 3, 4))).toBe("mack/work-20260102-0304");
  });

  it("re-verifies each statement/proof pair the chat verified, once", () => {
    const verify = (statement: string, proof: string, at: number): StoredMessage => ({
      role: "tool",
      at,
      results: [{ name: "verify_lean", args: { statement_path: statement, proof_path: proof }, ok: true, output: "accepted", protected: false }],
    });
    const msgs = [verify("S.lean", "P.lean", 1), verify("T.lean", "Q.lean", 2), verify("S.lean", "P.lean", 3)];
    expect(verifiedPairs(msgs)).toEqual([
      { statement: "T.lean", proof: "Q.lean" },
      { statement: "S.lean", proof: "P.lean" },
    ]);
  });

  it("says what Lean accepted and that the rest is unchecked", () => {
    const files = [
      { path: "OddPerfect/Basic.lean", status: "untracked" as const, binary: false, added: 0, removed: 0 },
      { path: "REVIEW.md", status: "modified" as const, binary: false, added: 3, removed: 1 },
    ];
    const body = prBody({ chat: "Odd perfect numbers", files, lean: true, verdicts: [{ statement: "S.lean", proof: "OddPerfect/Basic.lean", result: "accepted: the strict verifier accepts the proof (axioms: propext)" }] });
    expect(body).toContain("`OddPerfect/Basic.lean` proves `S.lean`: **accepted**");
    expect(body).toContain("not checked");
    expect(body).toContain("- added `OddPerfect/Basic.lean`");
    expect(body).toContain("- changed `REVIEW.md`");
    expect(prBody({ files, lean: true, verdicts: [] })).toContain("Treat every claim in it as unverified");
  });
});
