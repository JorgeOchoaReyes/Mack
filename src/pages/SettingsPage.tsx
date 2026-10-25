import { ArrowRight, ExternalLink } from "lucide-react";
import { UPSTREAM } from "../../core/upstream";
import { api, type Settings } from "../api";
import { Button, Field } from "../components/ui";

type Props = {
  settings: Settings;
  saveSettings: (s: Partial<Settings>) => Promise<void>;
  onGo: (page: "upstream" | "setup") => void;
};

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
        <h2>Lean, key and model</h2>
        <p className="muted">The Lean workspace, your Fireworks key and the model are managed in Setup.</p>
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
