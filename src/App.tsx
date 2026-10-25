import { useEffect, useState } from "react";
import type { ProveEvent } from "../core/prove";
import type { UpstreamReport } from "../core/upstream";
import type { Settings } from "../electron/main";
import type { MackApi } from "../electron/preload";

declare global {
  interface Window {
    mack: MackApi;
  }
}

const EXAMPLE = `import Mathlib

theorem add_comm_example (a b : ℕ) : a + b = b + a :=
sorry
`;

type Attempt = Extract<ProveEvent, { type: "attempt" }>;
type Upstream = (UpstreamReport & { dismissed?: boolean }) | { kind: "off" };

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [keySource, setKeySource] = useState("none");
  const [keyInput, setKeyInput] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [frozen, setFrozen] = useState(EXAMPLE);
  const [status, setStatus] = useState("");
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [solved, setSolved] = useState<Extract<ProveEvent, { type: "solved" }> | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [upstream, setUpstream] = useState<Upstream | null>(null);

  useEffect(() => {
    void window.mack.getSettings().then((r: { settings: Settings; keySource: string }) => {
      setSettings(r.settings);
      setKeySource(r.keySource);
    });
    void window.mack.checkUpstream().then(setUpstream);
    return window.mack.onProveEvent((raw) => {
      const e = raw as ProveEvent;
      if (e.type === "status") setStatus(e.message);
      if (e.type === "attempt") setAttempts((a) => [...a, e]);
      if (e.type === "solved") {
        setSolved(e);
        setStatus(`Verified by Lean on attempt ${e.n}.`);
      }
      if (e.type === "failed") setStatus(e.message);
    });
  }, []);

  const save = async (patch: Partial<Settings>) => setSettings(await window.mack.setSettings(patch));

  const run = async () => {
    setError("");
    setAttempts([]);
    setSolved(null);
    setRunning(true);
    try {
      await window.mack.startProve(frozen);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  if (!settings) return <main className="app">Loading…</main>;

  return (
    <main className="app">
      <header>
        <h1>Mack</h1>
        <p className="sub">Models propose. Lean decides.</p>
      </header>

      {upstream?.kind === "changed" && !upstream.dismissed && (
        <section className="panel banner">
          <strong>Open Math Harness changed its methodology.</strong>{" "}
          {upstream.commits} new upstream commit{upstream.commits === 1 ? "" : "s"} since Mack&apos;s baseline (
          <code>{upstream.baseline.slice(0, 7)}</code>) touch {upstream.files.length} file{upstream.files.length === 1 ? "" : "s"} Mack follows. Mack
          keeps working as it is until those changes are ported.
          <details>
            <summary>Changed files</summary>
            <ul>
              {upstream.files.map((f) => (
                <li key={f.path}>
                  <code>{f.path}</code> <span className="muted">{f.status}</span>
                </li>
              ))}
            </ul>
          </details>
          <div className="row">
            <button onClick={() => void window.mack.openGithub(upstream.compareUrl)}>View changes on GitHub</button>
            <button
              onClick={async () => {
                await save({ upstreamDismissed: upstream.head });
                setUpstream({ ...upstream, dismissed: true });
              }}
            >
              Stay on this version
            </button>
          </div>
        </section>
      )}

      <section className="panel settings">
        <h2>Settings</h2>
        <label>
          Fireworks API key <span className="muted">({keySource === "env" ? "from .env" : keySource === "saved" ? "saved, encrypted" : "not set"})</span>
          <div className="row">
            <input type="password" value={keyInput} onChange={(e) => setKeyInput(e.target.value)} placeholder="fw_…" disabled={keySource === "env"} />
            <button
              disabled={!keyInput || keySource === "env"}
              onClick={async () => {
                await window.mack.setKey(keyInput);
                setKeyInput("");
                setKeySource("saved");
              }}
            >
              Save key
            </button>
          </div>
        </label>
        <label>
          Model
          <div className="row">
            <input list="models" value={settings.model} onChange={(e) => void save({ model: e.target.value })} placeholder="accounts/fireworks/models/…" />
            <button onClick={async () => setModels(await window.mack.listModels().catch((e: Error) => (setError(e.message), [])))}>Load models</button>
          </div>
          <datalist id="models">
            {models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </label>
        <label>
          Lean workspace (a Lake project with Mathlib)
          <input value={settings.leanWorkspace} onChange={(e) => void save({ leanWorkspace: e.target.value })} placeholder="C:\\Users\\you\\mack-lean" />
        </label>
        <div className="row">
          <label>
            Attempts
            <input type="number" min={1} max={50} value={settings.maxAttempts} onChange={(e) => void save({ maxAttempts: Number(e.target.value) })} />
          </label>
          <label>
            Lean deadline (s)
            <input type="number" min={10} value={settings.timeoutMs / 1000} onChange={(e) => void save({ timeoutMs: Number(e.target.value) * 1000 })} />
          </label>
        </div>
        <label className="check">
          <input type="checkbox" checked={settings.upstreamCheck} onChange={(e) => void save({ upstreamCheck: e.target.checked })} />
          Check Open Math Harness for methodology updates each time Mack opens
          <span className="muted">
            {" "}
            ({upstream?.kind === "current" ? "up to date" : upstream?.kind === "changed" ? (upstream.dismissed ? "staying on current version" : "updates available") : upstream?.kind === "error" ? `check failed: ${upstream.message}` : "off"})
          </span>
        </label>
      </section>

      <section className="panel">
        <h2>Problem</h2>
        <p className="muted">A Lean file that starts with <code>import Mathlib</code> and states one theorem proved by <code>sorry</code>. The statement is frozen: a proof only counts against it word for word.</p>
        <textarea spellCheck={false} value={frozen} onChange={(e) => setFrozen(e.target.value)} rows={10} />
        <div className="row">
          <button className="primary" disabled={running} onClick={() => void run()}>
            {running ? "Proving…" : "Prove"}
          </button>
          {running && <button onClick={() => void window.mack.stopProve()}>Stop</button>}
          <span className="status">{status}</span>
        </div>
        {error && <p className="error">{error}</p>}
      </section>

      {solved && (
        <section className="panel solved">
          <h2>Verified proof</h2>
          <p className="muted">Axioms used: {solved.axioms.length ? solved.axioms.join(", ") : "none"}</p>
          <pre>{solved.proof}</pre>
        </section>
      )}

      {attempts.length > 0 && (
        <section className="panel">
          <h2>Attempts</h2>
          {attempts.map((a, i) => (
            <details key={i} open={i === attempts.length - 1}>
              <summary>
                #{a.n} <span className={`tag ${a.outcome.replace(" ", "-")}`}>{a.outcome}</span>
              </summary>
              <pre>{a.candidate}</pre>
              {a.detail && <pre className="detail">{a.detail}</pre>}
            </details>
          ))}
        </section>
      )}
    </main>
  );
}
