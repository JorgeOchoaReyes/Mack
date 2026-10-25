import { describe, expect, it } from "vitest";
import { issueUrl, openIssues } from "../core/feedback";

const d = { app: "0.2.0", os: "Windows 10.0", lean: "Lake 5 (Lean 4.36.0-rc1)", provider: "Fireworks", mode: "search", repl: true };

describe("feedback", () => {
  it("prefills GitHub's form with the person's text and diagnostics, secrets masked", () => {
    const key = ["fw", "3x4mpl3K3yAbCdEfGh12345"].join("_");
    const u = new URL(issueUrl("bug", "Search stops", `It stopped. My key is ${key}`, d));
    expect(u.origin + u.pathname).toBe("https://github.com/JorgeOchoaReyes/Mack/issues/new");
    expect(u.searchParams.get("labels")).toBe("bug");
    const body = u.searchParams.get("body")!;
    expect(body).toContain("It stopped.");
    expect(body).toContain("Lean: Lake 5 (Lean 4.36.0-rc1) (with REPL)");
    expect(body).not.toContain(key);
    expect(body).toContain("****");
    expect(new URL(issueUrl("idea", "x", "y", d)).searchParams.get("labels")).toBe("idea");
  });

  it("lists open issues without pull requests, by kind", async () => {
    const fake = (async () =>
      new Response(
        JSON.stringify([
          { number: 3, title: "Idea", html_url: "u3", labels: [{ name: "idea" }], comments: 1, created_at: "2026-10-25T00:00:00Z" },
          { number: 2, title: "PR", html_url: "u2", labels: [], comments: 0, created_at: "2026-10-25T00:00:00Z", pull_request: {} },
          { number: 1, title: "Bug", html_url: "u1", labels: [{ name: "bug" }], comments: 0, created_at: "2026-10-24T00:00:00Z" },
        ]),
      )) as unknown as typeof fetch;
    expect((await openIssues(fake)).map((i) => [i.number, i.kind])).toEqual([
      [3, "idea"],
      [1, "bug"],
    ]);
  });
});

describe("price input", () => {
  it("reads prices as people type them", async () => {
    const { parsePrice } = await import("../src/pages/SetupPage");
    expect([parsePrice("0.14"), parsePrice("$0.14"), parsePrice("0,14"), parsePrice(" 2 "), parsePrice("0.9 /M"), parsePrice(".5")]).toEqual([0.14, 0.14, 0.14, 2, 0.9, 0.5]);
    expect(Number.isNaN(parsePrice("abc"))).toBe(true);
    expect(Number.isNaN(parsePrice("-1"))).toBe(true);
  });
});
