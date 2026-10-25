import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LeanRun } from "../core/lean/verify";
import type { ChatRequest, ModelProvider } from "../core/model/provider";
import { SwarmService, type SwarmRecord } from "../core/ultramath/service";

let root = "";
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "mack-swarm-"));
});
afterAll(async () => rm(root, { recursive: true, force: true, maxRetries: 5 }));

const tool = (name: string, args: Record<string, unknown>) => `\`\`\`tool\n${JSON.stringify({ name, args })}\n\`\`\``;

/** A model that answers as the duplicate checker or as a member, by its script. */
function model(member: (name: string, last: string, req: ChatRequest) => string): ModelProvider {
  return {
    name: "fake",
    listModels: async () => [],
    chat: async (r) => {
      const sys = r.messages[0].content;
      if (sys.startsWith("You decide whether")) return { content: r.messages[1].content.includes("also induction") ? "DUPLICATE: 1\nREASON: same method" : "DISTINCT\nREASON: different" };
      const name = /You are member (m\d+)/.exec(sys)?.[1] ?? "?";
      return { content: member(name, r.messages.at(-1)!.content, r) };
    },
  };
}

async function waitFor(cond: () => boolean, ms = 10_000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

const records = async (id: string) => (await readFile(join(root, ".ultramath", id, "records.jsonl"), "utf8")).split("\n").filter(Boolean).map((l) => JSON.parse(l) as SwarmRecord);

describe("Ultramath driven from a chat", () => {
  it("refuses duplicates, enforces registration, wakes the chat with a report and takes its verdict", async () => {
    const woken: string[] = [];
    const provider = model((name, last) => {
      if (name === "m1") {
        if (!last.includes("Tool results")) return tool("ultramath_register", { direction: "induction on n" });
        if (last.includes("[ultramath_register]")) return tool("write_file", { path: "sol.md", content: "By induction..." });
        if (last.includes("[write_file]")) return tool("ultramath_submit", { report: "Proved by induction.", files: [".ultramath/u1/m1/sol.md"] });
        return "done";
      }
      if (!last.includes("Tool results")) return tool("web_search", { query: "x" });
      if (last.includes("refused: register")) return tool("ultramath_register", { direction: "also induction on n" });
      if (last.includes("refused: the same direction")) return "I stop.";
      return "I stop.";
    });
    const svc = new SwarmService({ provider: () => ({ provider, model: "m" }), lean: () => undefined, wake: (_p, _s, text) => woken.push(text) });
    expect(svc.start("p", root, "s1", { problem: "Show that every n satisfies P(n).", members: 2, minutes: 10, member_steps: 10 })).toContain("started swarm u1");
    await waitFor(() => woken.some((w) => w.includes("submitted a solution")));
    const recs = await records("u1");
    expect(recs.some((r) => r.event === "refused" && r.duplicate_of === 1)).toBe(true);
    expect((await readFile(join(root, ".ultramath", "u1", "m1", "sol.md"), "utf8")).startsWith("By induction")).toBe(true);
    expect(svc.status("s1")).toContain("waiting for your verdict");
    expect(() => svc.verdict("s1", { swarm: "u1", member: "m1", accept: true, reason: "" })).toThrow("reasoning");
    expect(svc.verdict("s1", { swarm: "u1", member: "m1", accept: true, reason: "checked every step", finish: true })).toContain("ended solved");
    expect((await records("u1")).at(-1)).toMatchObject({ event: "ended", outcome: "solved" });
    expect(() => svc.status("other-chat")).toThrow("no swarm");
  });

  it("lets the Lean verifier decide a Lean problem", async () => {
    const frozen = "import Mathlib\n\ntheorem demo (n : Nat) : n + 0 = n :=\nsorry\n";
    const run: LeanRun = async (src) => {
      const marker = /#print "(mack-report-[0-9a-f]+)"/.exec(src)?.[1];
      if (!marker) return { kind: "ok", output: "" };
      return { kind: "ok", output: `${marker}\n'demo' depends on axioms: ${src.includes("by simp") ? "[propext]" : "[sorryAx]"}\n@demo : ∀ (n : Nat), n + 0 = n\n` };
    };
    const woken: string[] = [];
    let attempt = 0;
    const provider = model((_name, last) => {
      if (!last.includes("Tool results") && !last.includes("rejected")) return tool("ultramath_register", { direction: "simp" });
      if (last.includes("[ultramath_register]") || last.includes("rejected")) {
        attempt++;
        const proof = attempt === 1 ? "by\n  sorry" : "by simp";
        return tool("write_file", { path: "demo.lean", content: `import Mathlib\n\ntheorem demo (n : Nat) : n + 0 = n := ${proof}\n` });
      }
      if (last.includes("[write_file]")) return tool("ultramath_submit", { report: "simp", files: [".ultramath/u2/m1/demo.lean"] });
      return "done";
    });
    const svc = new SwarmService({ provider: () => ({ provider, model: "m" }), lean: () => ({ run }), wake: (_p, _s, t) => woken.push(t) });
    svc.start("p", root, "s2", { problem: frozen, members: 1, minutes: 10, member_steps: 10 });
    await waitFor(() => woken.length > 0);
    const recs = await records("u2");
    const verdicts = recs.filter((r): r is Extract<SwarmRecord, { event: "verdict" }> => r.event === "verdict");
    expect(verdicts.map((v) => [v.accepted, v.by])).toEqual([
      [false, "verifier"],
      [true, "verifier"],
    ]);
    expect(woken[0]).toContain("verified by Lean");
    expect(() => svc.verdict("s2", { swarm: "u2", member: "m1", accept: true, reason: "x" })).toThrow();
  });

  it("marks a swarm interrupted when Mack stopped, and resumes it from its records", async () => {
    const busy = model((_n, last) => (!last.includes("Tool results") ? tool("ultramath_register", { direction: "a new idea" }) : tool("ultramath_board", {})));
    // A member that keeps working slowly, so Mack quits while it runs.
    const hang: ModelProvider = { ...busy, chat: async (r) => (await new Promise((t) => setTimeout(t, 50)), busy.chat(r)) };
    const first = new SwarmService({ provider: () => ({ provider: hang, model: "m" }), lean: () => undefined, wake: () => {} });
    first.start("p", root, "s3", { problem: "Hard problem.", members: 1, minutes: 10, member_steps: 500 });
    await waitFor(() => false, 300).catch(() => {});
    first.stopAll();
    // A new Mack: the swarm is found running in its records and recorded as interrupted.
    const woken: string[] = [];
    const finish = model((_n, last) => (last.includes("started again") ? tool("ultramath_abandon", { reason: "no way" }) : "I stop."));
    const second = new SwarmService({ provider: () => ({ provider: finish, model: "m" }), lean: () => undefined, wake: (_p, _s, t) => woken.push(t) });
    second.markInterrupted(root);
    expect((await records("u3")).at(-1)?.event).toBe("interrupted");
    expect(second.resume("p", root, "s3", { swarm: "u3" })).toContain("resumed swarm u3");
    await waitFor(() => woken.some((w) => w.includes("ended")));
    const recs = await records("u3");
    expect(recs.some((r) => r.event === "resumed")).toBe(true);
    expect(recs.some((r) => r.event === "direction" && r.state === "abandoned")).toBe(true);
  });
});
