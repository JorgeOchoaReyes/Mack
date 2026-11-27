import { describe, expect, it } from "vitest";
import { closest, editDistance } from "../scripts/check-model";

describe("checking a model id against the provider's list", () => {
  it("suggests the ids most like the one asked for", () => {
    const ids = ["deepseek-v4.1-flash", "glm-5.3", "openai/gpt-6.1-sol", "qwen3-coder"];
    expect(closest("gpt-6.1-sol", ids)[0]).toBe("openai/gpt-6.1-sol");
    expect(closest("glm-5", ids)[0]).toBe("glm-5.3");
    expect(closest("deepseek-v4-flash", ids)[0]).toBe("deepseek-v4.1-flash");
    expect(editDistance("kitten", "sitting")).toBe(3);
  });
});
