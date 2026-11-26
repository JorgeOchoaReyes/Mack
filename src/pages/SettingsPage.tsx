import { Download, ExternalLink } from "lucide-react";
import { UPSTREAM } from "../../core/upstream";
import { PROVIDERS, type ProviderId } from "../../core/model/providers";
import { api, errorText, type Settings } from "../api";
import { Button, Field, InfoTip, Toggle } from "../components/ui";
import { useEffect, useState } from "react";
import type { LedgerState, UpdateState } from "../api";
import { GitHubAccounts } from "../components/GitHubAccounts";
import { ModelSelect, useModelLists } from "../components/ModelSelect";
import { formatUsd } from "../../core/model/metered";
import { EFFORT_LABELS, PROOF_EFFORTS, type ProofEffort } from "../../core/model/provider";
import type { Limits } from "../../core/search/tree";
import type { UltramathLimits } from "../../core/ultramath/swarm";

type Props = {
  settings: Settings;
  saveSettings: (s: Partial<Settings>) => Promise<void>;
};

const SEARCH_FIELDS: { key: keyof Limits; label: string; hint: string; min: number; max: number }[] = [
  { key: "w", label: "Workers per round", hint: "Nodes continued at once.", min: 1, max: 8 },
  { key: "k1", label: "Rounds", hint: "Most rounds of continuations.", min: 1, max: 20 },
  { key: "fanout", label: "Fan-out", hint: "Most continuations of one node.", min: 1, max: 8 },
  { key: "callsPerContinuation", label: "Calls per worker", hint: "Model calls per worker.", min: 1, max: 10 },
  { key: "modelCalls", label: "Model-call budget", hint: "Most model calls in the whole search.", min: 1, max: 500 },
];

const ULTRA_FIELDS: { key: keyof UltramathLimits; label: string; hint: string; min: number; max: number }[] = [
  { key: "members", label: "Members", hint: "Agents working at once.", min: 1, max: 16 },
  { key: "rounds", label: "Rounds", hint: "One turn per member each round.", min: 1, max: 50 },
  { key: "modelCalls", label: "Model-call budget", hint: "Most model calls in the whole swarm.", min: 1, max: 1000 },
];

export function SettingsPage({ settings, saveSettings }: Props) {
  return (
    <div className="page settings-page">
      <section className="settings-group">
        <h2>Chat</h2>
        <Toggle
          checked={settings.autopilotNewChats}
          onChange={(v) => void saveSettings({ autopilotNewChats: v })}
          label="Start new chats on Autopilot" tip="The assistant works end to end without asking, until done or the spending limit."
        />
      </section>

      <section className="settings-group">
        <h2>Prover</h2>
        <div className="grid-2">
          <Field label="Attempts per run" tip="Model calls a run may make in all.">
            <input
              className="input"
              type="number"
              min={1}
              max={1000}
              value={settings.maxAttempts}
              onChange={(e) => void saveSettings({ maxAttempts: Math.max(1, Math.min(1000, Number(e.target.value) || 1)) })}
            />
          </Field>
          <Field label="Lean deadline (seconds)" tip="A slower check counts as a failed attempt.">
            <input
              className="input"
              type="number"
              min={10}
              value={Math.round(settings.timeoutMs / 1000)}
              onChange={(e) => void saveSettings({ timeoutMs: Math.max(10, Number(e.target.value) || 10) * 1000 })}
            />
          </Field>
          <Field label="Attempts at once" tip="Parallel chains sharing the attempts; the first proof stops the rest.">
            <input
              className="input"
              type="number"
              min={1}
              max={32}
              value={settings.parallelAttempts}
              onChange={(e) => void saveSettings({ parallelAttempts: Math.max(1, Math.min(32, Number(e.target.value) || 1)) })}
            />
          </Field>
          <Field label="Revisions before starting over" tip="0 never starts over.">
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
        <Field
          label="Thinking level for proofs"
          tip="Reasoning effort for proof attempts and benchmark runs. Model default sends none."
        >
          <select className="input" style={{ width: 200 }} value={settings.proofEffort ?? "default"} onChange={(e) => void saveSettings({ proofEffort: e.target.value as ProofEffort })}>
            {PROOF_EFFORTS.map((e) => (
              <option key={e} value={e}>
                {EFFORT_LABELS[e]}
              </option>
            ))}
          </select>
        </Field>
        <Toggle
          checked={settings.leanAutomation}
          onChange={(v) => void saveSettings({ leanAutomation: v })}
          label="Try Lean's automation first" tip="omega, simp, linarith, aesop, grind… before any model call and on every sorry."
        />
        <Toggle
          checked={settings.reuseProofs}
          onChange={(v) => void saveSettings({ reuseProofs: v })}
          label="Learn from earlier proofs" tip="Attempts see your verified proofs of similar statements."
        />
        <ProofExport />
        <Toggle
          checked={settings.premiseSelection}
          onChange={(v) => void saveSettings({ premiseSelection: v })}
          label="Premise selection" tip="Attempts are given the Mathlib theorems the statement likely needs."
        />
        <Toggle
          checked={settings.easierFirst}
          onChange={(v) => void saveSettings({ easierFirst: v })}
          label="Prove easier versions first" tip="Special cases and the key lemma first; the verified ones are offered to every attempt."
        />
        <h3 className="settings-sub">Decompose mode</h3>
        <div className="grid-2">
          <Field label="Attempts before splitting">
            <input className="input" type="number" min={1} max={200} value={settings.decomposeAttempts} onChange={(e) => void saveSettings({ decomposeAttempts: Math.max(1, Math.min(200, Math.floor(Number(e.target.value)) || 1)) })} />
          </Field>
          <Field label="Split depth">
            <input className="input" type="number" min={1} max={4} value={settings.decomposeDepth} onChange={(e) => void saveSettings({ decomposeDepth: Math.max(1, Math.min(4, Math.floor(Number(e.target.value)) || 1)) })} />
          </Field>
          <Field label="Splits per statement">
            <input className="input" type="number" min={1} max={6} value={settings.decomposeRounds} onChange={(e) => void saveSettings({ decomposeRounds: Math.max(1, Math.min(6, Math.floor(Number(e.target.value)) || 1)) })} />
          </Field>
        </div>
        <Toggle
          checked={settings.checkStatement}
          onChange={(v) => void saveSettings({ checkStatement: v })}
          label="Look for a counterexample first" tip="Lean's random tester; a counterexample stops the run."
        />
        <Toggle
          checked={settings.proofIdea}
          onChange={(v) => void saveSettings({ proofIdea: v })}
          label="Plan the proof in words first"
        />
      </section>

      <section className="settings-group">
        <h2>Spending</h2>
        <GlobalSpend settings={settings} saveSettings={saveSettings} />
        <div className="grid-2">
          <Field label="Assumed price ($/M tokens, in / out)" tip="Used for models without a price. Keep it high so limits stop early.">
            <div className="inline-fields">
              <input
                className="input"
                type="number"
                min={0}
                step={0.5}
                aria-label="Assumed input price"
                value={settings.assumedPrice.input}
                onChange={(e) => void saveSettings({ assumedPrice: { ...settings.assumedPrice, input: Math.max(0, Number(e.target.value) || 0) } })}
              />
              <input
                className="input"
                type="number"
                min={0}
                step={0.5}
                aria-label="Assumed output price"
                value={settings.assumedPrice.output}
                onChange={(e) => void saveSettings({ assumedPrice: { ...settings.assumedPrice, output: Math.max(0, Number(e.target.value) || 0) } })}
              />
            </div>
          </Field>
        </div>
        <div className="grid-2">
          <Field label="Max cost per run (USD)" tip="0 = no cap. Chats use the global limit only.">
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
        <div className="grid-2">
          {SEARCH_FIELDS.map((f) => (
            <Field key={f.key} label={f.label} tip={f.hint}>
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
          <Field label="Workers">
            <select className="input" value={settings.searchWorker} onChange={(e) => void saveSettings({ searchWorker: e.target.value as "fixed" | "tool" })}>
              <option value="fixed">Fixed loop</option>
              <option value="tool">Tool loop with plan board</option>
            </select>
          </Field>
          <Field label="Problems at once">
            <input className="input" type="number" min={1} max={4} value={settings.runConcurrency} onChange={(e) => void saveSettings({ runConcurrency: Math.max(1, Math.min(4, Number(e.target.value) || 1)) })} />
          </Field>
        </div>
        <Toggle
          checked={settings.searchAnalysis}
          onChange={(v) => void saveSettings({ searchAnalysis: v })}
          label="Score partial proofs with Lean" tip="Credits only steps Lean really closes (scoring v3)."
        />
        <Toggle
          checked={settings.useRepl}
          onChange={(v) => void saveSettings({ useRepl: v })}
          label="Use the Lean REPL for quick checks" tip="Keeps Mathlib loaded. The final check always uses a fresh Lean."
        />
        <LeanLimit value={settings.maxLeanProcesses ?? 0} onChange={(n) => void saveSettings({ maxLeanProcesses: n })} />
        <RemoteLeanFields settings={settings} saveSettings={saveSettings} />
      </section>

      <section className="settings-group">
        <h2>Ultramath</h2>
        <div className="grid-2">
          {ULTRA_FIELDS.map((f) => (
            <Field key={f.key} label={f.label} tip={f.hint}>
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

function GitHubSection() {
  return (
    <section className="settings-group">
      <h2>GitHub</h2>
      <GitHubAccounts />
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
                      ? `Mack ${state.latest} is out. This copy cannot update itself, since it was not installed from a Mack release installer (the Windows installer and the Linux AppImage): update it the way you installed it.`
                      : `${state.latest ? `Mack ${state.latest} is the latest release, so this copy is current. ` : ""}This copy cannot update itself, since it was not installed from a Mack release installer (the Windows installer and the Linux AppImage).`
                    : `Could not check for updates: ${state.message}`;
  return (
    <section className="settings-group">
      <h2>Updates</h2>
      <div className="field">
        <span className="field-label">
          Mack {version}
          <button className="link small" style={{ marginLeft: 8 }} onClick={() => void api.openExternal("https://github.com/JorgeOchoaReyes/Mack/releases")}>
            Releases
          </button>
        </span>
        <div className="row gap-sm">
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
          <Button size="sm" onClick={() => void api.checkUpdates().then(setState)}>
            Check now
          </Button>
        </div>
        {line && <span className="field-hint">{line}</span>}
      </div>
      <Toggle checked={settings.autoUpdate} onChange={(v) => void saveSettings({ autoUpdate: v })} label="Download and install updates automatically" />
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
      <Field label="Global limit (USD)" tip="Everything Mack spends together. 0 = off.">
        <div className="inline-fields">
          <input className="input" type="number" min={0} step={1} aria-label="Global limit" value={settings.globalLimit} onChange={(e) => void saveSettings({ globalLimit: Math.max(0, Number(e.target.value) || 0) })} />
          <select className="input" aria-label="Per" value={settings.globalPeriod} onChange={(e) => void saveSettings({ globalPeriod: e.target.value as Settings["globalPeriod"] })}>
            <option value="month">per month</option>
            <option value="day">per day</option>
            <option value="total">all time</option>
          </select>
        </div>
      </Field>
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
      label="Lean processes at once"
      tip={`0 = automatic. About 6 GB of memory each${mem ? `; this computer has ${mem.totalGb} GB, automatic uses ${mem.auto}` : ""}.`}
    >
      <input className="input" type="number" min={0} max={16} value={value} onChange={(e) => onChange(Math.max(0, Math.min(16, Math.floor(Number(e.target.value)) || 0)))} />
    </Field>
  );
}

/** The models trained for Lean that write the attempts, on any provider, each with its price for the spending limits. */
function ProverModel({ settings, saveSettings }: { settings: Settings; saveSettings: (p: Partial<Settings>) => Promise<unknown> }) {
  const lists = useModelLists([settings.proverProvider]);
  const models = settings.proverModel
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  const setPrice = (model: string, k: "input" | "output", v: number) => {
    const price = settings.prices[model];
    void saveSettings({ prices: { ...settings.prices, [model]: { input: price?.input ?? 0, output: price?.output ?? 0, [k]: Math.max(0, v) } } });
  };
  return (
    <>
      <Field
        label="Prover models"
        tip="Models trained for Lean proofs write the attempts; your main model plans."
      >
        <div className="inline-fields">
          <select className="input" style={{ width: 150, flex: "none" }} value={settings.proverProvider} onChange={(e) => void saveSettings({ proverProvider: e.target.value as ProviderId })}>
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <ModelSelect
            label="Prover models"
            placeholder="e.g. deepseek/deepseek-prover-v2"
            none="No prover model"
            value={settings.proverModel}
            onChange={(v) => void saveSettings({ proverModel: v })}
            list={lists[settings.proverProvider]}
          />
        </div>
      </Field>
      {models.map((model) => {
        const price = settings.prices[model];
        return (
          <Field key={model} label={`${model} ($/M tokens, in / out)`} tip={price ? undefined : "Not set: the assumed price is counted."}>
            <div className="inline-fields">
              <input className="input" type="number" min={0} step={0.1} value={price?.input ?? ""} placeholder="input" onChange={(e) => setPrice(model, "input", Number(e.target.value) || 0)} />
              <input className="input" type="number" min={0} step={0.1} value={price?.output ?? ""} placeholder="output" onChange={(e) => setPrice(model, "output", Number(e.target.value) || 0)} />
            </div>
          </Field>
        );
      })}
    </>
  );
}

/** Lean on another machine over SSH: a cloud box with more memory runs every check. */
function RemoteLeanFields({ settings, saveSettings }: { settings: Settings; saveSettings: (p: Partial<Settings>) => Promise<unknown> }) {
  const r = settings.remoteLean;
  const set = (patch: Partial<Settings["remoteLean"]>) => void saveSettings({ remoteLean: { ...r, ...patch } });
  return (
    <details className="settings-details" open={!!r.host}>
      <summary>Run Lean on another machine (SSH)</summary>
      <div className="grid-2">
        <Field label="SSH host" tip="user@machine, or a name from your SSH config.">
          <input className="input" placeholder="ubuntu@203.0.113.7" value={r.host} onChange={(e) => set({ host: e.target.value })} />
        </Field>
        <Field label="Lean workspace on that machine">
          <input className="input" value={r.workspace} onChange={(e) => set({ workspace: e.target.value })} />
        </Field>
        <Field label="Lean processes at once there" tip="About 6 GB of memory each.">
          <input className="input" type="number" min={1} max={64} value={r.processes} onChange={(e) => set({ processes: Math.max(1, Math.min(64, Math.floor(Number(e.target.value)) || 1)) })} />
        </Field>
      </div>
      <Toggle checked={r.repl} onChange={(v) => set({ repl: v })} label="That machine has the Lean REPL built" />
    </details>
  );
}

/** How many verified proofs are kept, and an export of them as fine-tuning data. */
function ProofExport() {
  const [count, setCount] = useState<number | null>(null);
  const [note, setNote] = useState("");
  useEffect(() => {
    void api.proofStats().then((x) => setCount(x.count)).catch(() => undefined);
  }, []);
  const run = async () => {
    setNote("");
    try {
      const r = await api.exportProofs();
      if (r) setNote(`Saved ${r.count} proofs to ${r.path}`);
    } catch (e) {
      setNote(errorText(e));
    }
  };
  return (
    <div className="field">
      <span className="field-label">
        Training data
        <InfoTip text="Your verified proofs as JSON Lines in the chat format OpenAI-compatible fine-tuning services accept. Worth it after a few thousand proofs." />
        {count !== null && <span className="muted small" style={{ marginLeft: 8 }}>{count} kept</span>}
      </span>
      <Button size="sm" icon={Download} onClick={() => void run()} disabled={!count}>
        Export
      </Button>
      {note && <span className="field-hint">{note}</span>}
    </div>
  );
}
