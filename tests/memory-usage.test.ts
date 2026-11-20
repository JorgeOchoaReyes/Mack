import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { consolidate, indexLines, matchLine, recordCitations, staleLines } from "../core/chat/memory";
import type { ChatRequest, ModelProvider } from "../core/model/provider";

const INDEX = `# Memory

- OddPerfect/EulerForm.lean proves Euler's form p^α m^2 for an odd perfect number; verified by the strict verifier.
- nlinarith closes the divisor-sum inequalities faster than polyrith in this project.
- The person prefers proofs split into lemmas of at most 30 lines.
`;
const DAY = 24 * 60 * 60 * 1000;

describe("counting which memories are used", () => {
  const lines = indexLines(INDEX);

  it("matches a citation to the index line it names, paraphrased or cut short", () => {
    expect(lines).toHaveLength(3);
    expect(matchLine(lines[1], lines)).toBe(lines[1]);
    expect(matchLine("nlinarith closes the divisor-sum inequalities", lines)).toBe(lines[1]);
    expect(matchLine("Euler's form for an odd perfect number is verified in EulerForm.lean", lines)).toBe(lines[0]);
    expect(matchLine("the weather was nice", lines)).toBeUndefined();
  });

  it("counts each line once per reply, under the line it names, with when it was last used", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mack-mem-"));
    writeFileSync(join(dir, "MEMORY.md"), INDEX);
    await recordCitations({ dir }, ["nlinarith closes the divisor-sum inequalities|note=used it", "- nlinarith closes the divisor-sum inequalities faster than polyrith in this project."], 1000);
    await recordCitations({ dir }, ["Euler's form for an odd perfect number is verified in EulerForm.lean"], 2000);
    const used = JSON.parse(readFileSync(join(dir, "used.json"), "utf8"));
    expect(used[lines[1]]).toEqual({ n: 1, last: 1000 });
    expect(used[lines[0]]).toEqual({ n: 1, last: 2000 });
  });

  it("calls a line stale after a month in the index with no citation in that month", () => {
    const now = 100 * DAY;
    const firstSeen = { [lines[0]]: 10 * DAY, [lines[1]]: 10 * DAY, [lines[2]]: 90 * DAY };
    const used = { [lines[0]]: { n: 4, last: 95 * DAY }, [lines[1]]: { n: 9, last: 20 * DAY } };
    // Line 1 was used, but not this month; line 2 is too new to judge; line 0 is in use.
    expect(staleLines(lines, used, firstSeen, now)).toEqual([lines[1]]);
  });

  it("tells the consolidation what is used and what has gone stale, and dates the new index's lines", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mack-mem-"));
    mkdirSync(join(dir, "sessions"));
    writeFileSync(join(dir, "sessions", "s1.md"), "a record");
    writeFileSync(join(dir, "pending.json"), JSON.stringify(["s1.md"]));
    writeFileSync(join(dir, "MEMORY.md"), INDEX);
    writeFileSync(join(dir, "used.json"), JSON.stringify({ [indexLines(INDEX)[0]]: 3 }));
    writeFileSync(join(dir, "seen.json"), JSON.stringify(Object.fromEntries(indexLines(INDEX).map((l) => [l, 0]))));
    const calls: ChatRequest[] = [];
    const provider = { name: "fake", chat: async (r: ChatRequest) => (calls.push(r), { content: "```memory\n- kept line\n```\n```summary\nabout\n```" }), listModels: async () => [] } as unknown as ModelProvider;
    expect(await consolidate({ dir }, provider, "m", 40 * DAY)).toBe(true);
    const asked = calls[0].messages[1].content;
    expect(asked).toContain("cited 3×");
    expect(asked).toContain("without any session citing them");
    expect(asked).toContain("nlinarith closes");
    expect(JSON.parse(readFileSync(join(dir, "seen.json"), "utf8"))).toEqual({ "- kept line": 40 * DAY });
  });
});
