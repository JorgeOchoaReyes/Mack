import { describe, expect, it } from "vitest";
import { blocks, visible } from "../src/components/chat/Markdown";

const fence = "```";

describe("chat markdown", () => {
  it("splits replies into blocks, an unclosed fence (still streaming) included", () => {
    const text = ["## Plan", "", "First line", "second line", "", "1. one", "2. two", "- a", "> quote", "---", `${fence}lean`, "theorem t : True := trivial", fence, `${fence}py`, "print(1)"].join("\n");
    const b = blocks(text);
    expect(b.map((x) => x.kind)).toEqual(["h", "p", "ol", "ul", "quote", "hr", "code", "code"]);
    expect(b[1].lines).toEqual(["First line", "second line"]);
    expect(b[6]).toMatchObject({ lang: "lean", open: false });
    expect(b[7]).toMatchObject({ lang: "py", open: true });
  });

  it("hides reasoning, tool calls and citations", () => {
    expect(visible(`<think>x</think>Hi\n${fence}tool\n{}\n${fence}\n<citation_entries>a</citation_entries>`)).toBe("Hi");
  });
});
