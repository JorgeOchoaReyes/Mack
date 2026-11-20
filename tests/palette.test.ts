import { describe, expect, it } from "vitest";
import { matchCommands, type Command } from "../src/components/CommandPalette";

const cmd = (label: string, hint: string): Command => ({ id: label, label, hint, icon: (() => null) as unknown as Command["icon"], run: () => {} });

describe("the command palette", () => {
  const all = [cmd("Chat", "Talk about the problem"), cmd("Proof attempts", "Every proof attempt"), cmd("Settings", "Spending limits"), cmd("Proof searches", "Long searches for proofs")];

  it("keeps commands holding every typed word, labels starting with it first", () => {
    expect(matchCommands(all, "").map((c) => c.label)).toEqual(["Chat", "Proof attempts", "Settings", "Proof searches"]);
    expect(matchCommands(all, "proof").map((c) => c.label)).toEqual(["Proof attempts", "Proof searches"]);
    expect(matchCommands(all, "spend").map((c) => c.label)).toEqual(["Settings"]);
    expect(matchCommands(all, "proof long").map((c) => c.label)).toEqual(["Proof searches"]);
    expect(matchCommands(all, "zzz")).toEqual([]);
  });
});
