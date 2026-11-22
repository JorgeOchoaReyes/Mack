import { ArrowRight, ExternalLink } from "lucide-react";
import { UPSTREAM } from "../../core/upstream";
import { PROVIDERS, type ProviderId } from "../../core/model/providers";
import { api, errorText, type Settings } from "../api";
import { Button, Field, Toggle } from "../components/ui";
import { useEffect, useState } from "react";
import type { GitHubStatus, LedgerState, UpdateState } from "../api";
import { formatUsd } from "../../core/model/metered";
import type { Limits } from "../../core/search/tree";
import type { UltramathLimits } from "../../core/ultramath/swarm";

type Props = {
  settings: Settings;
  saveSettings: (s: Partial<Settings>) => Promise<void>;
  onGo: (page: "upstream" | "setup") => void;
};

const SEARCH_FIELDS: { key: keyof Limits; label: string; hint: string; min: number; max: number }[] = [
  { key: "w", label: "Workers per round", hint: "How many nodes are continued at once.", min: 1, max: 8 },
  { key: "k1", label: "Rounds", hint: "Most rounds of continuations.", min: 1, max: 20 },
  { key: "fanout", label: "Fan-out", hint: "Most continuations of one node.", min: 1, max: 8 },
  { key: "callsPerContinuation", label: "Calls per worker", hint: "Model calls one worker may make, revising after each check.", min: 1, max: 10 },
  { key: "modelCalls", label: "Model-call budget", hint: "Most model calls in the whole search.", min: 1, max: 500 },
];

const ULTRA_FIELDS: { key: keyof UltramathLimits; label: string; hint: string; min: number; max: number }[] = [
  { key: "members", label: "Members", hint: "Agents working at once, each on its own direction (upstream allows up to 16).", min: 1, max: 16 },
  { key: "rounds", label: "Rounds", hint: "In each round every active member takes one turn.", min: 1, max: 50 },
  { key: "modelCalls", label: "Model-call budget", hint: "Most model calls in the whole swarm.", min: 1, max: 1000 },
];

export function SettingsPage({ settings, saveSettings, onGo }: Props) {
  return (
    <div className="page">
      <div className="page-head">
        <h1>Settings</h1>
      </div>

      <section className="settings-group">
        <h2>Chat</h2>
        <Toggle
          checked={settings.autopilotNewChats}
          onChange={(v) => void saveSettings({ autopilotNewChats: v })}
          label="Start new chats on Autopilot: tell the assistant what to solve and it works end to end on its own, using whichever features it needs. Its file writes, proof runs and commands then run without asking, until the work is done or your spending limit is reached. Each chat's Autopilot button turns it off."
        />
      </section>

      <section className="settings-group">
        <h2>Prover</h2>
        <div className="grid-2">
          <Field label="Attempts per run" hint="Model calls a run may make in all, shared by its chains. Labs make dozens to thousands per hard problem; with a cheap prover model 64 or more is affordable.">
            <input
              className="input"
              type="number"
              min={1}
              max={1000}
              value={settings.maxAttempts}
              onChange={(e) => void saveSettings({ maxAttempts: Math.max(1, Math.min(1000, Number(e.target.value) || 1)) })}
            />
          </Field>
          <Field label="Lean deadline (seconds)" hint="A check that runs longer counts as a failed attempt, never a pass.">
            <input
              className="input"
              type="number"
              min={10}
              value={Math.round(settings.timeoutMs / 1000)}
              onChange={(e) => void saveSettings({ timeoutMs: Math.max(10, Number(e.target.value) || 10) * 1000 })}
            />
          </Field>
          <Field label="Attempts at once" hint="Independent chains of attempts side by side, sharing the attempts above; the first verified proof stops the others. Their Lean checks wait for the Lean processes allowed below, so more chains cost no more memory.">
            <input
              className="input"
              type="number"
              min={1}
              max={32}
              value={settings.parallelAttempts}
              onChange={(e) => void saveSettings({ parallelAttempts: Math.max(1, Math.min(32, Number(e.target.value) || 1)) })}
            />
          </Field>
          <Field label="Revisions before starting over" hint="After this many rounds of Lean feedback a chain starts again from a clean conversation: fresh tries explore, long revisions only patch. 0 never starts over.">
            <input
              className="input"
              type="number"
              min={0}
              max={50}
              value={settings.revisionsPerChain}
              onChange={(e) => void saveSettings({ revisionsPerChain: Math.max(0, Math.min(50, Math.floor(Number(e.target.value)) || 0)) })}
            />
          </Field>
        </div>
        <ProverModel settings={settings} saveSettings={saveSettings} />
        <Toggle
          checked={settings.leanAutomation}
          onChange={(v) => void saveSettings({ leanAutomation: v })}
          label="Try Lean's automation first: before any model call, and on every sorry an attempt leaves, Mack tries omega, norm_num, simp, linarith, nlinarith, positivity, aesop, grind and exact?. What closes is put in; only the rest goes back to the model."
        />
        <Toggle
          checked={settings.reuseProofs}
          onChange={(v) => void saveSettings({ reuseProofs: v })}
          label="Learn from earlier proofs: every proof Lean verifies is kept, and attempts on a new statement are shown the verified proofs of the most similar ones."
        />
        <Toggle
          checked={settings.checkStatement}
          onChange={(v) => void saveSettings({ checkStatement: v })}
          label="Try to break the statement first: Lean's random tester looks for a counterexample before any model call. A counterexample stops the run, since no proof can exist."
        />
        <Toggle
          checked={settings.proofIdea}
          onChange={(v) => void saveSettings({ proofIdea: v })}
          label="Plan the proof in words first: one model call writes the proof as small steps, and every attempt is given that plan."
        />
      </section>

      <section className="settings-group">
        <h2>Spending</h2>
        <p className="muted">
          Each session — a chat, a proof run, a search run, an Ultramath swarm — stops when its model calls have cost this much. Cost is the tokens your
          provider reports times the model's price in Setup. A call already running when the cap is reached still finishes.
        </p>
        <GlobalSpend settings={settings} saveSettings={saveSettings} />
        <div className="grid-2">
          <Field label="Assumed price, input ($ per million tokens)" hint="Counted for a model whose price you have not entered. Keep it high: limits then stop early, never late.">
            <input
              className="input"
              type="number"
              min={0}
              step={0.5}
              value={settings.assumedPrice.input}
              onChange={(e) => void saveSettings({ assumedPrice: { ...settings.assumedPrice, input: Math.max(0, Number(e.target.value) || 0) } })}
            />
          </Field>
          <Field label="Assumed price, output ($ per million tokens)">
            <input
              className="input"
              type="number"
              min={0}
              step={0.5}
              value={settings.assumedPrice.output}
              onChange={(e) => void saveSettings({ assumedPrice: { ...settings.assumedPrice, output: Math.max(0, Number(e.target.value) || 0) } })}
            />
          </Field>
        </div>
        <div className="grid-2">
          <Field label="Max cost per run (USD)" hint="Each proof run, search and swarm. Chats are bounded only by the global limit. 0 turns the cap off.">
            <input
              className="input"
              type="number"
              min={0}
              step={0.5}
              value={settings.maxCostPerSession}
              onChange={(e) => void saveSettings({ maxCostPerSession: Math.max(0, Number(e.target.value) || 0) })}
            />
          </Field>
        </div>
      </section>

      <section className="settings-group">
        <h2>Search tree</h2>
        <p className="muted">
          Used when the Prove screen is set to Search tree. The whole search makes at most the model-call budget of billed calls.
        </p>
        <div className="grid-2">
          {SEARCH_FIELDS.map((f) => (
            <Field key={f.key} label={f.label} hint={f.hint}>
              <input
                className="input"
                type="number"
                min={f.min}
                max={f.max}
                value={settings.search[f.key]}
                onChange={(e) =>
                  void saveSettings({ search: { ...settings.search, [f.key]: Math.max(f.min, Math.min(f.max, Number(e.target.value) || f.min)) } })
                }
              />
            </Field>
          ))}
        </div>
        <div className="grid-2">
          <Field label="Workers" hint="Fixed loop: one prompt per attempt (upstream's putnam template). Tool loop: workers with their own workspace, file tools, Lean checks and a shared plan board.">
            <select className="input" value={settings.searchWorker} onChange={(e) => void saveSettings({ searchWorker: e.target.value as "fixed" | "tool" })}>
              <option value="fixed">Fixed loop</option>
              <option value="tool">Tool loop with plan board</option>
            </select>
          </Field>
          <Field label="Problems at once" hint="For runs over several problems (Runs screen, or the chat's discovery_start).">
            <input className="input" type="number" min={1} max={4} value={settings.runConcurrency} onChange={(e) => void saveSettings({ runConcurrency: Math.max(1, Math.min(4, Number(e.target.value) || 1)) })} />
          </Field>
        </div>
        <Toggle
          checked={settings.searchAnalysis}
          onChange={(v) => void saveSettings({ searchAnalysis: v })}
          label="Score partial proofs with Lean (scoring v3): try to finish each with automation, then credit only real closed steps and catch hollow sorries"
        />
        <Toggle
          checked={settings.useRepl}
          onChange={(v) => void saveSettings({ useRepl: v })}
          label="Use the resident Lean REPL for quick checks (keeps Mathlib loaded between checks; the final verification always uses a fresh Lean)"
        />
        <LeanLimit value={settings.maxLeanProcesses ?? 0} onChange={(n) => void saveSettings({ maxLeanProcesses: n })} />
        <RemoteLeanFields settings={settings} saveSettings={saveSettings} />
      </section>

      <section className="settings-group">
        <h2>Ultramath</h2>
        <p className="muted">
          Used when the Prove screen is set to Ultramath. Duplicate checks and the judge's reviews count toward the model-call budget.
        </p>
        <div className="grid-2">
          {ULTRA_FIELDS.map((f) => (
            <Field key={f.key} label={f.label} hint={f.hint}>
              <input
                className="input"
                type="number"
                min={f.min}
                max={f.max}
                value={settings.ultramath[f.key]}
                onChange={(e) =>
                  void saveSettings({ ultramath: { ...settings.ultramath, [f.key]: Math.max(f.min, Math.min(f.max, Number(e.target.value) || f.min)) } })
                }
              />
            </Field>
          ))}
        </div>
      </section>

      <section className="settings-group">
        <h2>Lean, key and model</h2>
        <p className="muted">The Lean workspace, your model provider keys and models are managed in Setup.</p>
        <div className="row gap-sm">
          <Button icon={ArrowRight} onClick={() => onGo("setup")}>
            Open Setup
          </Button>
        </div>
      </section>

      <section className="settings-group">
        <h2>Upstream methodology</h2>
        <p className="muted">
          Automatic checks of Open Math Harness are {settings.upstreamCheck ? "on" : "off"}. Change this and see what changed upstream in Harness updates.
        </p>
        <div className="row gap-sm">
          <Button icon={ArrowRight} onClick={() => onGo("upstream")}>
            Open Harness updates
          </Button>
        </div>
      </section>

      <GitHubSection />

      <UpdatesSection settings={settings} saveSettings={saveSettings} />

      <section className="settings-group">
        <h2>About</h2>
        <p className="muted">Mack · Apache-2.0 · adapts Open Math Harness (Apache-2.0).</p>
        <div className="row gap-sm">
          <button className="link" onClick={() => void api.openExternal("https://github.com/JorgeOchoaReyes/Mack")}>
            Mack on GitHub <ExternalLink size={12} />
          </button>
          <button className="link" onClick={() => void api.openExternal(`https://github.com/${UPSTREAM.repo}`)}>
            Open Math Harness <ExternalLink size={12} />
          </button>
        </div>
      </section>
    </div>
  );
}

const GITHUB_SOURCE: Record<GitHubStatus["source"], string> = {
  env: "from GITHUB_TOKEN in the environment",
  saved: "with the token saved in Mack",
  gh: "with the GitHub CLI's login",
  none: "",
};

function GitHubSection() {
  const [status, setStatus] = useState<GitHubStatus | null>(null);
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  useEffect(() => void api.githubStatus().then(setStatus), []);
  return (
    <section className="settings-group">
      <h2>GitHub</h2>
      <p className="muted">
        A chat's work can go to GitHub as a pull request: each project gets its own private repository, so you can review proofs and documents, and pull them, from
        any computer. Open one from a chat's Review panel, or let the chat open one (it asks first).
      </p>
      {status?.login ? (
        <div className="row gap-sm">
          <span className="badge badge-ok">Connected as {status.login}</span>
          <span className="muted small">{GITHUB_SOURCE[status.source]}</span>
          {status.source === "saved" && (
            <button className="link small" onClick={() => void api.githubClearToken().then(setStatus)}>
              Remove token
            </button>
          )}
        </div>
      ) : (
        <>
          {status?.error && <div className="notice notice-bad">GitHub refused the token {GITHUB_SOURCE[status.source]}: {status.error}</div>}
          <p className="muted small">
            Log in with the GitHub CLI (<code>gh auth login</code>), or paste a token with access to create repositories and pull requests (a classic token with the{" "}
            <code>repo</code> scope).{" "}
            <button className="link small" onClick={() => void api.openExternal("https://github.com/settings/tokens/new?scopes=repo&description=Mack")}>
              Create one <ExternalLink size={11} />
            </button>
          </p>
          <form
            className="row gap-sm"
            onSubmit={async (e) => {
              e.preventDefault();
              setError("");
              try {
                setStatus(await api.githubSetToken(token));
                setToken("");
              } catch (err) {
                setError(errorText(err));
              }
            }}
          >
            <input className="input grow mono" type="password" placeholder="ghp_…" value={token} onChange={(e) => setToken(e.target.value)} />
            <Button type="submit" disabled={!token.trim()}>
              Save token
            </Button>
          </form>
          {error && <div className="notice notice-bad">{error}</div>}
        </>
      )}
    </section>
  );
}

function UpdatesSection({ settings, saveSettings }: { settings: Settings; saveSettings: (s: Partial<Settings>) => Promise<void> }) {
  const [state, setState] = useState<UpdateState | null>(null);
  const [version, setVersion] = useState("");
  useEffect(() => {
    void api.subscribeUpdates().then((s) => {
      setVersion(s.appVersion);
      setState(s);
    });
    return api.onUpdateEvent(setState);
  }, []);
  const line =
    !state || state.state === "idle"
      ? ""
      : state.state === "dev"
        ? "This is a development build; only an installed Mack updates itself."
        : state.state === "checking"
          ? "Checking GitHub Releases…"
          : state.state === "none"
            ? "Mack is up to date."
            : state.state === "available"
              ? `Mack ${state.version} is available; downloading…`
              : state.state === "downloading"
                ? `Downloading Mack ${state.version}: ${state.percent}%`
                : state.state === "ready"
                  ? `Mack ${state.version} is ready and installs when you quit Mack.`
                  : state.state === "manual"
                    ? state.newer
                      ? `Mack ${state.latest} is out. This copy cannot update itself, since it was not installed from a Mack release installer (those are built for Windows): update it the way you installed it.`
                      : `${state.latest ? `Mack ${state.latest} is the latest release, so this copy is current. ` : ""}This copy cannot update itself, since it was not installed from a Mack release installer (those are built for Windows).`
                    : `Could not check for updates: ${state.message}`;
  return (
    <section className="settings-group">
      <h2>Updates</h2>
      <p className="muted">
        You have Mack {version}. New versions come from{" "}
        <button className="link" onClick={() => void api.openExternal("https://github.com/JorgeOchoaReyes/Mack/releases")}>
          GitHub Releases
        </button>
        .
      </p>
      <Toggle checked={settings.autoUpdate} onChange={(v) => void saveSettings({ autoUpdate: v })} label="Download and install updates automatically" />
      <div className="row gap-sm">
        <Button size="sm" onClick={() => void api.checkUpdates().then(setState)}>
          Check now
        </Button>
        {state?.state === "manual" && state.newer && (
          <Button size="sm" variant="primary" onClick={() => void api.openExternal(state.url)}>
            See Mack {state.latest}
          </Button>
        )}
        {state?.state === "ready" && (
          <Button size="sm" variant="primary" onClick={() => void api.installUpdate()}>
            Restart and update
          </Button>
        )}
        {line && <span className="muted small">{line}</span>}
      </div>
    </section>
  );
}

function GlobalSpend({ settings, saveSettings }: { settings: Settings; saveSettings: (s: Partial<Settings>) => Promise<void> }) {
  const [state, setState] = useState<LedgerState | null>(null);
  useEffect(() => {
    void api.globalSpend().then(setState);
    return api.onGlobalSpend(setState);
  }, []);
  const period = settings.globalPeriod === "total" ? "since the last reset" : settings.globalPeriod === "day" ? "today" : "this month";
  return (
    <div className="global-spend">
      <div className="grid-2">
        <Field label="Global limit (USD)" hint="Everything Mack does together: every chat, run, swarm, memory update and suggestion. 0 turns it off.">
          <input className="input" type="number" min={0} step={1} value={settings.globalLimit} onChange={(e) => void saveSettings({ globalLimit: Math.max(0, Number(e.target.value) || 0) })} />
        </Field>
        <Field label="Per" hint="When the global total starts again from zero.">
          <select className="input" value={settings.globalPeriod} onChange={(e) => void saveSettings({ globalPeriod: e.target.value as Settings["globalPeriod"] })}>
            <option value="month">month</option>
            <option value="day">day</option>
            <option value="total">all time (until I reset it)</option>
          </select>
        </Field>
      </div>
      {state && (
        <div className="row gap-sm">
          <span className={`spend-chip ${state.limit > 0 && state.spent >= state.limit * 0.8 ? "warn" : ""}`}>
            {state.estimated ? "≈" : ""}
            {formatUsd(state.spent)} spent {period}
            {state.limit > 0 ? ` of ${formatUsd(state.limit)}` : ""}
          </span>
          <button className="link small" onClick={() => void api.resetGlobalSpend().then(setState)}>
            Reset to $0
          </button>
        </div>
      )}
    </div>
  );
}

/** How many Lean processes may run at once: each holds Mathlib in memory, so this caps how much of the computer Mack takes. */
function LeanLimit({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const [mem, setMem] = useState<{ totalGb: number; auto: number } | null>(null);
  useEffect(() => {
    void api.leanMemory().then(setMem).catch(() => undefined);
  }, []);
  const n = value > 0 ? value : (mem?.auto ?? 0);
  return (
    <Field
      label="Lean processes at once (0 = automatic)"
      hint={`Each Lean process with Mathlib uses about 5–6 GB of memory, so this caps Mack at about ${n ? `${n * 6} GB` : "half your memory"}${mem ? ` of this computer's ${mem.totalGb} GB` : ""}. Checks beyond it wait their turn. Automatic uses about half the memory${mem ? ` (${mem.auto} here)` : ""}; an idle Lean REPL is closed after 5 minutes.`}
    >
      <input className="input" type="number" min={0} max={16} value={value} onChange={(e) => onChange(Math.max(0, Math.min(16, Math.floor(Number(e.target.value)) || 0)))} />
    </Field>
  );
}

/** The model trained for Lean that writes the attempts, on any provider, with its price for the spending limits. */
function ProverModel({ settings, saveSettings }: { settings: Settings; saveSettings: (p: Partial<Settings>) => Promise<unknown> }) {
  const model = settings.proverModel.trim();
  const price = settings.prices[model];
  const setPrice = (k: "input" | "output", v: number) => void saveSettings({ prices: { ...settings.prices, [model]: { input: price?.input ?? 0, output: price?.output ?? 0, [k]: Math.max(0, v) } } });
  return (
    <div className="grid-2">
      <Field
        label="Prover model (optional)"
        hint="A model trained only to write Lean proofs (DeepSeek-Prover-V2, Kimina-Prover, Goedel-Prover-V2) proves far more competition problems per dollar than a general model. When set, it writes every attempt and your main model only plans. Its provider needs a key in Setup."
      >
        <div className="inline-fields">
          <select className="input" style={{ width: 150, flex: "none" }} value={settings.proverProvider} onChange={(e) => void saveSettings({ proverProvider: e.target.value as ProviderId })}>
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <input className="input" placeholder="e.g. deepseek/deepseek-prover-v2 (empty: off)" value={settings.proverModel} onChange={(e) => void saveSettings({ proverModel: e.target.value })} />
        </div>
      </Field>
      {model && (
        <Field label="Prover price ($ per million tokens, input / output)" hint={price ? "Counted against your spending limits." : "Not set: the high assumed price is counted, so limits stop early."}>
          <div className="inline-fields">
            <input className="input" type="number" min={0} step={0.1} value={price?.input ?? ""} placeholder="input" onChange={(e) => setPrice("input", Number(e.target.value) || 0)} />
            <input className="input" type="number" min={0} step={0.1} value={price?.output ?? ""} placeholder="output" onChange={(e) => setPrice("output", Number(e.target.value) || 0)} />
          </div>
        </Field>
      )}
    </div>
  );
}

/** Lean on another machine over SSH: a cloud box with more memory runs every check. */
function RemoteLeanFields({ settings, saveSettings }: { settings: Settings; saveSettings: (p: Partial<Settings>) => Promise<unknown> }) {
  const r = settings.remoteLean;
  const set = (patch: Partial<Settings["remoteLean"]>) => void saveSettings({ remoteLean: { ...r, ...patch } });
  return (
    <details className="settings-details" open={!!r.host}>
      <summary>Run Lean on another machine (SSH)</summary>
      <p className="muted small">
        A rented cloud machine or a workstation with more memory runs every Lean check, and this computer only sends the proof text. The machine needs Lean and Mathlib in the folder below, with Mack&apos;s REPL built in <span className="mono">.mack/repl</span> for quick checks (copy this computer&apos;s Lean workspace there), and <span className="mono">ssh</span> must log in with a key, without a password prompt. Leave the host empty to run Lean here.
      </p>
      <div className="grid-2">
        <Field label="SSH host" hint="As you would type it after ssh: user@machine, or a name from your SSH config.">
          <input className="input" placeholder="ubuntu@203.0.113.7" value={r.host} onChange={(e) => set({ host: e.target.value })} />
        </Field>
        <Field label="Lean workspace on that machine">
          <input className="input" value={r.workspace} onChange={(e) => set({ workspace: e.target.value })} />
        </Field>
        <Field label="Lean processes at once there" hint="About 6 GB of that machine's memory each: a 128 GB machine runs about 18.">
          <input className="input" type="number" min={1} max={64} value={r.processes} onChange={(e) => set({ processes: Math.max(1, Math.min(64, Math.floor(Number(e.target.value)) || 1)) })} />
        </Field>
      </div>
      <Toggle checked={r.repl} onChange={(v) => set({ repl: v })} label="That machine has Mack's REPL built (.mack/repl), for quick checks with Mathlib kept loaded" />
    </details>
  );
}
