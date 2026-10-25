import { describe, expect, it } from "vitest";
import { checkUpstream, isWatched, UPSTREAM } from "../core/upstream";

const fakeFetch = (body: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("upstream methodology check", () => {
  it("watches the methodology paths only", () => {
    expect(isWatched("interfaces/lean/src/rules.rs")).toBe(true);
    expect(isWatched("AGENTS.md")).toBe(true);
    expect(isWatched("program-files/ui/src/lib.rs")).toBe(false);
  });

  it("reports watched changes and ignores the rest", async () => {
    const r = await checkUpstream(
      fakeFetch({
        ahead_by: 3,
        commits: [{ sha: "aaa" }, { sha: "bbb" }],
        files: [
          { filename: "program-files/lean/src/verify.rs", status: "modified" },
          { filename: "README.md", status: "modified" },
        ],
      }),
    );
    expect(r).toMatchObject({ kind: "changed", head: "bbb", commits: 3, files: [{ path: "program-files/lean/src/verify.rs" }] });
  });

  it("is current when nothing watched changed", async () => {
    const r = await checkUpstream(fakeFetch({ ahead_by: 1, commits: [{ sha: "c" }], files: [{ filename: "README.md", status: "modified" }] }));
    expect(r).toEqual({ kind: "current", baseline: UPSTREAM.baseline, head: "c" });
  });

  it("reports an error instead of guessing when GitHub refuses", async () => {
    expect((await checkUpstream(fakeFetch({}, 403))).kind).toBe("error");
  });
});
