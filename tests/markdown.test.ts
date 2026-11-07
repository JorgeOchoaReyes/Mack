import { describe, expect, it } from "vitest";
import { blocks, cells } from "../src/components/chat/Markdown";

describe("chat markdown", () => {
  it("reads a table the model writes, with code and escaped pipes in cells", () => {
    const text = [
      "Twelve sections:",
      "",
      "| § | Content |",
      "|---|:---:|",
      "| 0–1 | One-paragraph status; σ(n) = 2n |",
      "| 2 | Even perfect numbers: `a|b` and a \\| pipe |",
      "",
      "After.",
    ].join("\n");
    const b = blocks(text);
    expect(b.map((x) => x.kind)).toEqual(["p", "table", "p"]);
    expect(b[1]).toMatchObject({ lines: ["§", "Content"], align: [undefined, "center"], rows: [["0–1", "One-paragraph status; σ(n) = 2n"], ["2", "Even perfect numbers: `a|b` and a | pipe"]] });
  });

  it("leaves a lone pipe and a plain rule alone", () => {
    expect(blocks("a | b\n\n---").map((x) => x.kind)).toEqual(["p", "hr"]);
    expect(cells("a | b | c")).toEqual(["a", "b", "c"]);
  });
});

describe("splitChoices", () => {
  it("takes the options out of a choices block and leaves the rest", async () => {
    const { splitChoices } = await import("../src/components/chat/Markdown");
    const r = splitChoices("Which first?\n\n```choices\n- Read the existing formalization first\n2. Build the API from scratch\n```");
    expect(r.body).toBe("Which first?");
    expect(r.choices).toEqual(["Read the existing formalization first", "Build the API from scratch"]);
  });
  it("leaves a message without one alone", async () => {
    const { splitChoices } = await import("../src/components/chat/Markdown");
    expect(splitChoices("Just text.")).toEqual({ body: "Just text.", choices: [] });
  });
});
