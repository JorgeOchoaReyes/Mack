// Against real Lean + Mathlib. Opt-in, because it needs the ~5 GB workspace:
//   MACK_LEAN_WORKSPACE=%USERPROFILE%\mack-lean npm test
import { describe, expect, it } from "vitest";
import { leanRunner } from "../core/lean/runner";
import { pristineType, verifyText } from "../core/lean/verify";

const workspace = process.env.MACK_LEAN_WORKSPACE;
const run = workspace ? leanRunner({ workspace, timeoutMs: 600_000 }) : undefined;

const FROZEN = "import Mathlib\n\ntheorem demo (a b : ℕ) : a + b = b + a :=\nsorry\n";

describe.skipIf(!workspace)("verify against real Lean", () => {
  let pristine = "";

  it("elaborates the pristine statement", async () => {
    const p = await pristineType(FROZEN, run!);
    expect(p.ok, p.ok ? "" : p.reason).toBe(true);
    if (p.ok) pristine = p.type;
    expect(pristine).toContain("demo");
  }, 600_000);

  it("accepts a real proof", async () => {
    const v = await verifyText(FROZEN, pristine, "import Mathlib\n\ntheorem demo (a b : ℕ) : a + b = b + a :=\nNat.add_comm a b\n", run!);
    expect(v).toMatchObject({ ok: true });
  }, 600_000);

  it("rejects a proof that Lean refuses", async () => {
    const v = await verifyText(FROZEN, pristine, "import Mathlib\n\ntheorem demo (a b : ℕ) : a + b = b + a :=\nrfl\n", run!);
    expect(v).toMatchObject({ ok: false, rejection: { kind: "elaboration" } });
  }, 600_000);

  it("rejects a theorem moved into a namespace", async () => {
    // The statement text is kept verbatim, but the root `demo` is never proved.
    const moved = "import Mathlib\n\nnamespace X\ntheorem demo (a b : ℕ) : a + b = b + a :=\nNat.add_comm a b\nend X\n";
    const v = await verifyText(FROZEN, pristine, moved, run!);
    expect(v.ok).toBe(false);
  }, 600_000);
});
