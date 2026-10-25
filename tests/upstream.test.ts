import { describe, expect, it } from "vitest";
import { checkUpstream, isWatched, UPSTREAM, watchedFor } from "../core/upstream";

/** A fake GitHub: the compare endpoint returns `compare`; each commit endpoint returns `commitFiles[sha]`. */
const fakeGithub =
  (compare: unknown, status = 200, commitFiles: Record<string, string[]> = {}) =>
  (async (url: string) => {
    const m = /\/commits\/(\w+)$/.exec(url);
    if (m) return new Response(JSON.stringify({ files: (commitFiles[m[1]] ?? []).map((filename) => ({ filename })) }));
    return new Response(JSON.stringify(compare), { status });
  }) as unknown as typeof fetch;

describe("upstream methodology check", () => {
  it("maps watched paths to Mack modules and ignores the rest", () => {
    expect(watchedFor("interfaces/lean/src/rules.rs")?.mack).toBe("core/lean/rules.ts");
    expect(isWatched("AGENTS.md")).toBe(true);
    expect(isWatched("program-files/ui/src/lib.rs")).toBe(false);
  });

  it("reports watched changes with their Mack module and the commits that touched them", async () => {
    const r = await checkUpstream(
      fakeGithub(
        {
          ahead_by: 2,
          commits: [
            { sha: "aaa", commit: { message: "Tidy README\n\nbody" } },
            { sha: "bbb", commit: { message: "Stricter preamble rule" } },
          ],
          files: [
            { filename: "program-files/lean/src/verify.rs", status: "modified" },
            { filename: "README.md", status: "modified" },
          ],
        },
        200,
        { bbb: ["program-files/lean/src/verify.rs"], aaa: ["README.md"] },
      ),
    );
    expect(r).toMatchObject({
      kind: "changed",
      head: "bbb",
      commits: 2,
      files: [{ path: "program-files/lean/src/verify.rs", area: "Lean verification" }],
      recent: [
        { sha: "bbb", message: "Stricter preamble rule", touchesWatched: true },
        { sha: "aaa", message: "Tidy README", touchesWatched: false },
      ],
    });
  });

  it("is current when nothing watched changed", async () => {
    const r = await checkUpstream(fakeGithub({ ahead_by: 1, commits: [{ sha: "c" }], files: [{ filename: "README.md", status: "modified" }] }));
    expect(r).toMatchObject({ kind: "current", baseline: UPSTREAM.baseline, head: "c" });
  });

  it("reports an error instead of guessing when GitHub refuses", async () => {
    expect((await checkUpstream(fakeGithub({}, 403))).kind).toBe("error");
  });
});
