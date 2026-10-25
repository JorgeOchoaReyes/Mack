import { ArrowRight, ExternalLink } from "lucide-react";
import { UPSTREAM } from "../../core/upstream";
import { api, type Settings } from "../api";
import { Button, Field, Toggle } from "../components/ui";
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
        <h2>Prover</h2>
        <div className="grid-2">
          <Field label="Attempts per run" hint="How many times the model may revise its proof. Each attempt is one billed model call.">
            <input
              className="input"
              type="number"
              min={1}
              max={50}
              value={settings.maxAttempts}
              onChange={(e) => void saveSettings({ maxAttempts: Math.max(1, Math.min(50, Number(e.target.value) || 1)) })}
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
        <Toggle
          checked={settings.useRepl}
          onChange={(v) => void saveSettings({ useRepl: v })}
          label="Use the resident Lean REPL for quick checks (keeps Mathlib loaded between checks; the final verification always uses a fresh Lean)"
        />
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
          Automatic checks of Open Math Harness are {settings.upstreamCheck ? "on" : "off"}. Change this and see what changed upstream in Upstream.
        </p>
        <div className="row gap-sm">
          <Button icon={ArrowRight} onClick={() => onGo("upstream")}>
            Open Upstream
          </Button>
        </div>
      </section>

      <section className="settings-group">
        <h2>About</h2>
        <p className="muted">Mack 0.1 · Apache-2.0 · adapts Open Math Harness (Apache-2.0).</p>
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
