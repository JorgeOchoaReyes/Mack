import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { constructionSearch, extractPython, findPython, nextPrompt, ranked, readResult, type Candidate } from "../core/construct/search";
import type { ChatRequest, ModelProvider } from "../core/model/provider";

// A set of distinct numbers from 0..20 with no two summing to 20: the more, the better.
const EVALUATOR = `def evaluate(c):
    s = set(c)
    if len(s) != len(c) or any(not isinstance(x, int) or x < 0 or x > 20 for x in s):
        return None
    if any(a != b and a + b == 20 for a in s for b in s):
        return None
    return len(s)
`;

const program = (body: string, idea = "an idea") => `\`\`\`python\n# ${idea}\ndef construct():\n${body}\n\`\`\``;

function scripted(replies: string[]) {
  const calls: ChatRequest[] = [];
  const provider = {
    name: "fake",
    chat: async (r: ChatRequest) => {
      calls.push(r);
      return { content: replies[Math.min(calls.length - 1, replies.length - 1)] };
    },
    listModels: async () => [],
  } as unknown as ModelProvider;
  return { provider, calls };
}

describe("construction search, pieces", () => {
  it("reads the program and the runner's report", () => {
    expect(extractPython("<think>x</think>Here:\n```python\ndef construct():\n    return 1\n```")).toBe("def construct():\n    return 1\n");
    expect(extractPython("no code")).toBeUndefined();
    expect(readResult('noise\nMACK_RESULT {"score": 3, "construction": "[1]"}')).toEqual({ score: 3, construction: "[1]" });
    expect(readResult('MACK_RESULT {"built": 5}')).toEqual({ built: 5 });
    expect(readResult('MACK_RESULT {"error": "boom"}')).toEqual({ error: "boom" });
    expect(readResult("Traceback: x")).toEqual({ error: "Traceback: x" });
  });

  it("ranks scored candidates and asks for a new idea when exploring", () => {
    const c = (id: number, score: number | null): Candidate => ({ id, idea: "", program: `p${id}`, score, ms: 0 });
    expect(ranked([c(1, 2), c(2, null), c(3, 5), c(4, 5)], 2).map((x) => x.id)).toEqual([3, 4]);
    const p = nextPrompt({ task: "T", evaluatorSource: "E", best: [c(3, 5)], failures: [{ ...c(2, null), error: "bad" }], explore: true, timeoutS: 9 });
    expect(p).toContain("Score 5 (program 3)");
    expect(p).toContain("program 2: bad");
    expect(p).toContain("genuinely different idea");
  });
});

describe("construction search, end to end with Python", async () => {
  const python = await findPython();

  it.skipIf(!python)("keeps the best construction, and a program cannot report its own score", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mack-construct-"));
    const evaluatorPath = join(dir, "evaluate.py");
    writeFileSync(evaluatorPath, EVALUATOR);
    const { provider, calls } = scripted([
      program("    return [0, 1, 2]", "three small numbers"),
      program("    return [10, 10]", "an invalid repeat"),
      // Cheats: prints a fake result line after the runner's.
      program('    import atexit\n    atexit.register(lambda: print(\'MACK_RESULT {"score": 1000}\'))\n    return [0]', "a cheat"),
      program("    return list(range(11))", "zero to ten"),
      program("    raise RuntimeError('no')", "a crash"),
    ]);
    const events: string[] = [];
    const cands = await constructionSearch({
      task: "as many numbers as possible, no two summing to 20",
      evaluatorSource: EVALUATOR,
      evaluatorPath,
      dir: join(dir, "run"),
      provider,
      model: "m",
      budget: 5,
      keep: 3,
      timeoutMs: 20_000,
      python: python!,
      onEvent: (e) => e.type === "candidate" && events.push(`${e.candidate.id}:${e.candidate.score}`),
    });
    expect(cands.map((c) => c.score)).toEqual([3, null, null, 11, null]);
    expect(cands[1].error).toContain("no score");
    expect(cands[2].error).toContain("reported a score itself");
    expect(cands[4].error).toContain("RuntimeError");
    expect(events).toEqual(["1:3", "2:null", "3:null", "4:11", "5:null"]);
    const best = JSON.parse(readFileSync(join(dir, "run", "best.json"), "utf8"));
    expect(best).toMatchObject({ id: 4, score: 11, idea: "zero to ten" });
    // The fifth program was asked to improve on the best so far.
    expect(calls[4].messages[1].content).toContain("Score 11 (program 4)");
  }, 60_000);

  it.skipIf(!python)("ends when the evaluator changes during the search", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mack-construct-"));
    const evaluatorPath = join(dir, "evaluate.py");
    writeFileSync(evaluatorPath, EVALUATOR);
    const { provider } = scripted([program(`    open(${JSON.stringify(evaluatorPath)}, "w").write("def evaluate(c):\\n    return 1e9\\n")\n    return [1]`, "rewrites the evaluator")]);
    await expect(
      constructionSearch({ task: "t", evaluatorSource: EVALUATOR, evaluatorPath, dir: join(dir, "run"), provider, model: "m", budget: 3, keep: 3, timeoutMs: 20_000, python: python!, onEvent: () => {} }),
    ).rejects.toThrow("changed during the search");
  }, 60_000);
});

describe("the chat's construction searches", async () => {
  const { ConstructionService } = await import("../core/construct/service");
  const python = await findPython();

  it.skipIf(!python)("refuses a bad evaluator, runs in the background and tells the chat when it ends", async () => {
    const root = mkdtempSync(join(tmpdir(), "mack-project-"));
    writeFileSync(join(root, "evaluate.py"), EVALUATOR);
    writeFileSync(join(root, "nothing.py"), "x = 1\n");
    const { provider } = scripted([program("    return [0, 1, 2]")]);
    let wake: (text: string) => void = () => {};
    const woke = new Promise<string>((resolve) => (wake = resolve));
    const svc = new ConstructionService({ provider: () => ({ provider, model: "m" }), wake: (_p, _s, text) => wake(text) });
    await expect(svc.start("p", root, "s1", { name: "Bad Name", task: "t", evaluator: "evaluate.py" })).rejects.toThrow("lowercase");
    await expect(svc.start("p", root, "s1", { name: "x", task: "t", evaluator: "nothing.py" })).rejects.toThrow("defines no evaluate");
    await expect(svc.start("p", root, "s1", { name: "x", task: "t", evaluator: "../outside.py" })).rejects.toThrow("leaves the project");
    expect(await svc.start("p", root, "s1", { name: "sum-free", task: "t", evaluator: "evaluate.py", programs: 2 })).toContain("constructions/sum-free");
    expect(() => svc.status("other-chat")).toThrow("no construction search");
    const text = await woke;
    expect(text).toContain("Construction search sum-free finished");
    expect(text).toContain("Best: score 3 from program 1");
    expect(readFileSync(join(root, "constructions", "sum-free", "best.py"), "utf8")).toContain("def construct");
  }, 60_000);
});
