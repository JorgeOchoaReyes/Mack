import { describe, expect, it } from "vitest";
import { activeAccount, parseGhAccounts } from "../core/github-accounts";

describe("GitHub accounts", () => {
  it("lists every account the GitHub CLI is logged in to, from JSON or text", () => {
    const json = JSON.stringify({ hosts: { "github.com": [{ state: "success", active: true, host: "github.com", login: "alice" }, { state: "success", active: false, host: "github.com", login: "alice-work" }, { state: "error", login: "stale" }], "ghe.example.com": [{ state: "success", login: "corp" }] } });
    expect(parseGhAccounts(json)).toEqual(["alice", "alice-work"]);
    const text = "github.com\n  ✓ Logged in to github.com account alice (keyring)\n  - Active account: true\n  ✓ Logged in to github.com account alice-work (keyring)\n  - Active account: false\n";
    expect(parseGhAccounts(text)).toEqual(["alice", "alice-work"]);
    expect(parseGhAccounts("You are not logged into any GitHub hosts.")).toEqual([]);
  });

  it("publishes as the chosen account while it is connected, else the first", () => {
    const accounts = [{ login: "alice", source: "mack" as const }, { login: "Alice-Work", source: "gh" as const }];
    expect(activeAccount(accounts, "alice-work")?.login).toBe("Alice-Work");
    expect(activeAccount(accounts, "gone")?.login).toBe("alice");
    expect(activeAccount([], "alice")).toBeUndefined();
  });
});
