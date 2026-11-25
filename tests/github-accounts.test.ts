import { describe, expect, it } from "vitest";
import { activeAccount, finishDeviceFlow, parseGhAccounts, startDeviceFlow } from "../core/github-accounts";

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

  it("signs in through the browser: a code, then a token once approved", async () => {
    const calls: { url: string; body: Record<string, string> }[] = [];
    const answers = [{ error: "authorization_pending" }, { error: "slow_down", interval: 10 }, { access_token: "gho_abc" }];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      const j = url.endsWith("/device/code") ? { device_code: "dc", user_code: "ABCD-1234", verification_uri: "https://github.com/login/device", interval: 5, expires_in: 900 } : answers.shift();
      return new Response(JSON.stringify(j), { status: 200 });
    }) as unknown as typeof fetch;
    const code = await startDeviceFlow("client123", fake);
    expect(code).toMatchObject({ userCode: "ABCD-1234", verificationUri: "https://github.com/login/device" });
    expect(calls[0].body).toMatchObject({ client_id: "client123", scope: "repo read:user" });
    const waits: number[] = [];
    const token = await finishDeviceFlow(code, { clientId: "client123", fetch: fake, sleep: async (ms) => void waits.push(ms) });
    expect(token).toBe("gho_abc");
    // Asked to slow down, it waits longer.
    expect(waits).toEqual([5000, 5000, 10000]);
    expect(calls[1].body).toMatchObject({ device_code: "dc", grant_type: "urn:ietf:params:oauth:grant-type:device_code" });
  });

  it("says why a sign-in ended without a token", async () => {
    const code = { deviceCode: "dc", userCode: "X", verificationUri: "u", interval: 1, expiresIn: 60 };
    const denied = (async () => new Response(JSON.stringify({ error: "access_denied" }))) as unknown as typeof fetch;
    await expect(finishDeviceFlow(code, { clientId: "c", fetch: denied, sleep: async () => {} })).rejects.toThrow("declined");
    await expect(startDeviceFlow("", denied)).rejects.toThrow("not set up in this build");
    const ctl = new AbortController();
    ctl.abort();
    await expect(finishDeviceFlow(code, { clientId: "c", fetch: denied, sleep: async () => {}, signal: ctl.signal })).rejects.toThrow("cancelled");
  });
});
