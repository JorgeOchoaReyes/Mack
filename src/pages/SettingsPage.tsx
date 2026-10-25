import { ExternalLink, GitCompare, RefreshCw } from "lucide-react";
import { useState } from "react";
import { UPSTREAM } from "../../core/upstream";
import { api, type Settings, type Upstream } from "../api";
import { Button, Field, Toggle } from "../components/ui";

type Props = {
  settings: Settings;
  saveSettings: (s: Partial<Settings>) => Promise<void>;
  upstream: Upstream | null;
  recheckUpstream: () => Promise<void>;
};

export function SettingsPage({ settings, saveSettings, upstream, recheckUpstream }: Props) {
  const [checking, setChecking] = useState(false);
  const status =
    upstream === null
      ? "Checking…"
      : upstream.kind === "off"
        ? "Off"
        : upstream.kind === "current"
          ? "Up to date with upstream"
          : upstream.kind === "changed"
            ? upstream.dismissed
              ? "Staying on the current methodology"
              : `${upstream.files.length} upstream change${upstream.files.length === 1 ? "" : "s"} not yet in Mack`
            : `Could not check: ${upstream.message}`;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Settings</h1>
      </div>

      <section className="settings-group">
        <h2>Prover</h2>
        <div className="grid-2">
          <Field label="Attempts per run" hint="How many times the model may revise its proof.">
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
        <h2>Methodology updates</h2>
        <p className="muted">
          Mack follows the methodology of Open Math Harness. On launch it can check whether upstream changed its Lean rules, verification, proof search,
          Ultramath, prompts or memory. The check only reports changes; Mack keeps its current behaviour until they are ported.
        </p>
        <Toggle
          checked={settings.upstreamCheck}
          onChange={async (v) => {
            await saveSettings({ upstreamCheck: v });
            await recheckUpstream();
          }}
          label="Check for upstream methodology changes each time Mack opens"
        />
        <div className="kv">
          <span>Status</span>
          <span>{status}</span>
          <span>Aligned with</span>
          <span>
            <code>{UPSTREAM.repo}</code> at <code>{UPSTREAM.baseline.slice(0, 7)}</code>
          </span>
        </div>
        <div className="row gap-sm">
          <Button
            icon={RefreshCw}
            loading={checking}
            disabled={!settings.upstreamCheck}
            onClick={async () => {
              setChecking(true);
              await recheckUpstream();
              setChecking(false);
            }}
          >
            Check now
          </Button>
          {upstream?.kind === "changed" && (
            <Button icon={GitCompare} onClick={() => void api.openExternal(upstream.compareUrl)}>
              View upstream changes
            </Button>
          )}
          {upstream?.kind === "changed" && upstream.dismissed && (
            <Button
              variant="ghost"
              onClick={async () => {
                await saveSettings({ upstreamDismissed: "" });
                await recheckUpstream();
              }}
            >
              Show the update banner again
            </Button>
          )}
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
