import { describe, expect, it } from "vitest";
import { parseWalkthrough, proofHash, showmeRequest } from "../core/showme";

describe("show me", () => {
  it("keeps a valid walkthrough and clamps what the player cannot show", () => {
    const reply = `<think>plan</think>Here it is:
{"idea":"Induction on n.","steps":[
  {"title":"The claim","explain":"Sum of squares.","lines":[1,3],"visual":{"type":"grid","n":40,"k":2}},
  {"title":"Base case","explain":"n = 0.","lines":[9,2],"goal":"the step","visual":{"type":"bars","values":[1,4,"x",9],"highlight":[1,7]}},
  {"title":"","explain":"dropped"},
  {"title":"Weird","explain":"unknown visual","visual":{"type":"three-js","code":"alert(1)"}},
  {"title":"Table","explain":"t","visual":{"type":"table","columns":["n","sum"],"rows":[[1,1],[2,5]]}}
],"takeaway":"Induct."}`;
    const w = parseWalkthrough(reply, 5);
    expect(w.idea).toBe("Induction on n.");
    expect(w.steps.map((s) => s.title)).toEqual(["The claim", "Base case", "Weird", "Table"]);
    expect(w.steps[0].visual).toEqual({ type: "grid", n: 10, k: 2, caption: undefined });
    expect(w.steps[1].lines).toEqual([2, 5]);
    expect(w.steps[1].visual).toMatchObject({ type: "bars", values: [1, 4, 9], highlight: [1] });
    expect(w.steps[2].visual).toEqual({ type: "none" });
    expect(w.steps[3].visual).toMatchObject({ type: "table", rows: [["1", "1"], ["2", "5"]] });
    expect(() => parseWalkthrough("no json here", 5)).toThrow();
    expect(() => parseWalkthrough('{"steps":[]}', 5)).toThrow();
  });

  it("numbers the proof lines for the model and hashes proofs regardless of line endings", () => {
    expect(showmeRequest({ proof: "a\nb" })).toContain("  1  a\n  2  b");
    expect(proofHash("a\r\nb")).toBe(proofHash("a\nb"));
  });
});

describe("show me the whole proof", () => {
  it("ties each step and map node to a known file and drops the rest", () => {
    const files = { "Grid/A.lean": 10, "Grid/B.lean": 4 };
    const reply = JSON.stringify({
      idea: "B builds on A.",
      map: [
        { file: "Grid/A.lean", title: "Sum of squares", role: "the engine", uses: [] },
        { file: "Grid/B.lean", title: "Squares in a grid", role: "the answer", uses: ["Grid/A.lean", "Grid/Nope.lean", "Grid/B.lean"] },
        { file: "Grid/Nope.lean", title: "x", role: "y", uses: [] },
      ],
      steps: [
        { file: "Grid/A.lean", title: "Claim", explain: "e", lines: [1, 30], visual: { type: "none" } },
        { file: "Grid/B.lean", title: "Use it", explain: "e", lines: [2, 3], visual: { type: "none" } },
        { file: "Grid/Gone.lean", title: "Lost", explain: "e", lines: [1, 2], visual: { type: "none" } },
      ],
    });
    const w = parseWalkthrough(reply, files);
    expect(w.map?.map((m) => `${m.file}<${m.uses.join(",")}`)).toEqual(["Grid/A.lean<", "Grid/B.lean<Grid/A.lean"]);
    expect(w.steps.map((s) => [s.file, s.lines])).toEqual([["Grid/A.lean", [1, 10]], ["Grid/B.lean", [2, 3]], [undefined, undefined]]);
  });
});
