import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { changes, fileDiff, initRepo } from "../core/git";

let root = "";
afterAll(async () => root && rm(root, { recursive: true, force: true }));

describe("Review of a real git repository", () => {
  it("lists changes against HEAD and untracked files, and diffs one", async () => {
    root = await mkdtemp(join(tmpdir(), "mack-git-"));
    expect(await initRepo(root)).toBe(true);
    await writeFile(join(root, "a.lean"), "theorem a : True := trivial\n");
    // Before the first commit everything is new.
    expect((await changes(root)).map((f) => [f.path, f.status])).toEqual([["a.lean", "untracked"]]);
    const g = (...a: string[]) => execFileSync("git", ["-C", root, "-c", "user.name=t", "-c", "user.email=t@t", ...a]);
    g("add", ".");
    g("commit", "-qm", "first");
    await writeFile(join(root, "a.lean"), "theorem a : True := by trivial\n");
    await writeFile(join(root, "b.md"), "notes\n");
    const files = await changes(root);
    expect(files.map((f) => [f.path, f.status, f.added, f.removed])).toEqual([
      ["a.lean", "modified", 1, 1],
      ["b.md", "untracked", 0, 0],
    ]);
    expect(await fileDiff(root, "a.lean")).toContain("+theorem a : True := by trivial");
    expect(await fileDiff(root, "b.md")).toContain("+notes");
    await expect(fileDiff(root, "../x")).rejects.toThrow("bad path");
  });
});
