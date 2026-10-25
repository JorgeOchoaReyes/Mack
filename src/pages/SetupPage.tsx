import { CircleCheck, Download, ExternalLink, FolderOpen, KeyRound, RefreshCw, Search, Sigma, Square, Trash2, Cpu } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { SETUP_STEPS, type SetupStep } from "../../core/lean/setup-steps";
import { isCheap, type Price } from "../../core/model/metered";
import { PROVIDERS, providerInfo } from "../../core/model/providers";
import { api, errorText, type Health, type ProviderId, type SetupEvent, type Settings } from "../api";
import { Button, Spinner } from "../components/ui";

type StepState = "pending" | "running" | "done" | "skipped" | "failed";

type Props = { health: Health | null; settings: Settings; onChanged: () => void; saveSettings: (s: Partial<Settings>) => Promise<void> };

export function SetupPage({ health, settings, onChanged, saveSettings }: Props) {
  const leanReady = !!health?.lake && !!health?.hasProject && !!health?.hasMathlib;
  const keyReady = health?.keySource !== "none";
  const modelReady = !!health?.model;
  const done = [leanReady, keyReady, modelReady].filter(Boolean).length;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Setup</h1>
        <p className="muted">Three things, once. Everything stays on this computer.</p>
        <div className="readiness">
          <div className="readiness-bar">
            <span style={{ width: `${(done / 3) * 100}%` }} />
          </div>
          <span className="muted small">{done === 3 ? "Ready to prove" : `${done} of 3 ready`}</span>
        </div>
      </div>
      <LeanStep health={health} settings={settings} ready={leanReady} onChanged={onChanged} saveSettings={saveSettings} />
      <ProviderStep health={health} settings={settings} ready={keyReady} saveSettings={saveSettings} onChanged={onChanged} />
      <ModelStep settings={settings} ready={modelReady} keyReady={keyReady} saveSettings={saveSettings} onChanged={onChanged} />
    </div>
  );
}

function StepCard({ n, icon: Icon, title, ready, children }: { n: number; icon: typeof Sigma; title: string; ready: boolean; children: React.ReactNode }) {
  return (
    <section className={`step-card ${ready ? "ready" : ""}`}>
      <div className="step-rail">
        <span className="step-n">{ready ? <CircleCheck size={18} /> : n}</span>
      </div>
      <div className="step-main">
        <div className="step-title">
          <Icon size={16} /> {title}
          {ready && <span className="step-ok">Ready</span>}
        </div>
        {children}
      </div>
    </section>
  );
}

function LeanStep({ health, settings, ready, onChanged, saveSettings }: { health: Health | null; settings: Settings; ready: boolean; onChanged: () => void; saveSettings: (s: Partial<Settings>) => Promise<void> }) {
  const [states, setStates] = useState<Record<SetupStep, StepState>>({ elan: "pending", project: "pending", cache: "pending", verify: "pending", repl: "pending" });
  const [log, setLog] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [failure, setFailure] = useState("");
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<boolean | null>(null);
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(
    () =>
      api.onSetupEvent((e: SetupEvent) => {
        if (e.type === "log") setLog((l) => (l.length > 400 ? [...l.slice(-300), e.line] : [...l, e.line]));
        else {
          setStates((s) => ({ ...s, [e.step]: e.state }));
          if (e.state === "failed") setFailure(e.message ?? "Setup failed.");
        }
      }),
    [],
  );

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);

  const start = async () => {
    setLog([]);
    setFailure("");
    setStates({ elan: "pending", project: "pending", cache: "pending", verify: "pending", repl: "pending" });
    setRunning(true);
    try {
      await api.startSetup();
    } catch (e) {
      setFailure(errorText(e));
    } finally {
      setRunning(false);
      onChanged();
    }
  };

  const lastLine = useMemo(() => log[log.length - 1] ?? "", [log]);

  return (
    <StepCard n={1} icon={Sigma} title="Lean and Mathlib" ready={ready}>
      <p className="muted">
        Installs Lean's official toolchain and a Mathlib workspace, then downloads Mathlib prebuilt (about 5 GB) so nothing has to compile.
        Takes 5–20 minutes depending on your connection.
      </p>
      <div className="kv">
        <span>Toolchain</span>
        <span>{health?.lake ?? <span className="muted">not installed</span>}</span>
        <span>Workspace</span>
        <span className="row gap-sm">
          <code className="path">{settings.leanWorkspace}</code>
          <Button
            size="sm"
            variant="ghost"
            icon={FolderOpen}
            disabled={running}
            onClick={async () => {
              const p = await api.pickWorkspace();
              if (p) {
                await saveSettings({ leanWorkspace: p });
                onChanged();
              }
            }}
          >
            Change
          </Button>
        </span>
        <span>Mathlib</span>
        <span>{health?.hasMathlib ? "installed" : <span className="muted">not installed</span>}</span>
        <span>Lean REPL</span>
        <span>
          {health?.hasRepl ? (
            "installed: quick checks reuse a loaded Mathlib"
          ) : (
            <span className="muted">not installed{ready ? ": click Repair or update to add it (a few minutes)" : ""}</span>
          )}
        </span>
      </div>

      {(running || log.length > 0) && (
        <div className="setup-steps">
          {SETUP_STEPS.map((s) => (
            <div key={s.id} className={`setup-step st-${states[s.id]}`}>
              <span className="setup-icon">
                {states[s.id] === "running" ? <Spinner size={14} /> : states[s.id] === "done" || states[s.id] === "skipped" ? <CircleCheck size={14} /> : <span className="ring" />}
              </span>
              <div>
                <div>{s.title}</div>
                <div className="muted small">{states[s.id] === "skipped" ? "already done" : s.detail}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      {running && lastLine && <div className="last-line">{lastLine}</div>}
      {log.length > 0 && (
        <details className="log-details">
          <summary>Full log</summary>
          <pre className="console" ref={logRef}>
            {log.join("\n")}
          </pre>
        </details>
      )}
      {failure && <div className="notice notice-bad">{failure} Running setup again resumes where it stopped.</div>}
      {checkResult !== null && !running && (
        <div className={`notice ${checkResult ? "notice-ok" : "notice-bad"}`}>
          {checkResult ? "Lean imports Mathlib in this workspace." : "Lean could not import Mathlib here. Run setup to repair it."}
        </div>
      )}

      <div className="row gap-sm">
        {running ? (
          <Button variant="danger" icon={Square} onClick={() => void api.stopSetup()}>
            Stop
          </Button>
        ) : (
          <Button variant={ready ? "secondary" : "primary"} icon={ready ? RefreshCw : Download} onClick={() => void start()}>
            {ready ? "Repair or update" : "Install Lean and Mathlib"}
          </Button>
        )}
        {ready && !running && (
          <Button
            icon={Search}
            loading={checking}
            onClick={async () => {
              setChecking(true);
              setCheckResult(await api.verifyWorkspace());
              setChecking(false);
            }}
          >
            Test Lean
          </Button>
        )}
      </div>
    </StepCard>
  );
}

function ProviderStep({ health, settings, ready, saveSettings, onChanged }: { health: Health | null; settings: Settings; ready: boolean; saveSettings: (s: Partial<Settings>) => Promise<void>; onChanged: () => void }) {
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [baseUrl, setBaseUrl] = useState(settings.customBaseUrl);
  const info = providerInfo(settings.provider);
  const source = health?.providers.find((p) => p.id === info.id)?.keySource ?? "none";

  const pick = async (id: ProviderId) => {
    setKey("");
    setError("");
    await saveSettings({ provider: id });
    onChanged();
  };

  return (
    <StepCard n={2} icon={KeyRound} title="Model provider and key" ready={ready}>
      <p className="muted">
        Mack calls models with your own account. Keys are encrypted with Windows' credential protection and only sent to the provider they belong to. You can
        set up several and switch per run on the Prove screen.
      </p>
      <div className="provider-tabs">
        {PROVIDERS.map((p) => {
          const st = health?.providers.find((x) => x.id === p.id);
          return (
            <button key={p.id} className={`provider-tab ${settings.provider === p.id ? "active" : ""}`} onClick={() => void pick(p.id)}>
              <span>{p.label}</span>
              {st?.usable && <CircleCheck size={13} className="ok" />}
            </button>
          );
        })}
      </div>
      <p className="muted small">{info.blurb}</p>
      {info.id === "custom" && (
        <form
          className="row gap-sm"
          onSubmit={async (e) => {
            e.preventDefault();
            await saveSettings({ customBaseUrl: baseUrl.trim() });
            onChanged();
          }}
        >
          <input className="input grow mono" placeholder="http://localhost:11434/v1" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          <Button type="submit" disabled={!/^https?:\/\//.test(baseUrl.trim()) || baseUrl.trim() === settings.customBaseUrl}>
            Save endpoint
          </Button>
        </form>
      )}
      {source === "env" ? (
        <div className="notice notice-ok">Using {info.keyEnv} from the .env file.</div>
      ) : source === "saved" ? (
        <div className="row gap-sm">
          <span className="key-saved">{info.label} key ••••••••••••</span>
          <Button
            size="sm"
            variant="ghost"
            icon={Trash2}
            onClick={async () => {
              await api.clearKey(info.id);
              onChanged();
            }}
          >
            Remove
          </Button>
        </div>
      ) : (
        <form
          className="row gap-sm"
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            try {
              await api.setKey(info.id, key);
              setKey("");
              onChanged();
            } catch (err) {
              setError(errorText(err));
            }
          }}
        >
          <input className="input grow" type="password" placeholder={info.keyPlaceholder} value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" />
          <Button variant="primary" type="submit" disabled={key.trim().length < 8}>
            Save key
          </Button>
        </form>
      )}
      {!info.keyRequired && source === "none" && <p className="muted small">No key is needed if your server does not ask for one.</p>}
      {error && <div className="notice notice-bad">{error}</div>}
      {info.keyUrl && source === "none" && (
        <button className="link" onClick={() => void api.openExternal(info.keyUrl!)}>
          Get a key at {new URL(info.keyUrl).hostname} <ExternalLink size={12} />
        </button>
      )}
    </StepCard>
  );
}

function ModelStep({ settings, ready, keyReady, saveSettings, onChanged }: { settings: Settings; ready: boolean; keyReady: boolean; saveSettings: (s: Partial<Settings>) => Promise<void>; onChanged: () => void }) {
  const provider = settings.provider;
  const info = providerInfo(provider);
  const current = settings.models[provider];
  const [models, setModels] = useState<string[]>([]);
  // Listing fills in published prices, so read them back after each load.
  const [prices, setPrices] = useState<Record<string, Price>>(settings.prices);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [custom, setCustom] = useState(current);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      setModels(await api.listModels(provider));
      setPrices((await api.getSettings()).prices);
    } catch (e) {
      setModels([]);
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setModels([]);
    setCustom(settings.models[provider]);
    if (keyReady) void load();
    // Reload when the provider changes or its key appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyReady, provider, settings.customBaseUrl]);

  const choose = async (m: string) => {
    await saveSettings({ models: { ...settings.models, [provider]: m } });
    setCustom(m);
    onChanged();
  };

  const shown = models.filter((m) => m.toLowerCase().includes(query.toLowerCase()));

  return (
    <StepCard n={3} icon={Cpu} title={`Model on ${info.label}`} ready={ready}>
      <p className="muted">Pick a strong reasoning or coding model. Stronger models solve more problems in fewer attempts, at a higher price per attempt. Models marked cheap cost $2 or less per million output tokens.</p>
      {!keyReady ? (
        <p className="muted small">Add your key first to list the models your account can use.</p>
      ) : (
        <>
          <div className="row gap-sm">
            <input className="input grow" placeholder="Filter models" value={query} onChange={(e) => setQuery(e.target.value)} />
            <Button icon={RefreshCw} loading={loading} onClick={() => void load()}>
              Refresh
            </Button>
          </div>
          {error && <div className="notice notice-bad">{error}</div>}
          {models.length > 0 && (
            <div className="model-list">
              {shown.slice(0, 300).map((m) => (
                <button key={m} className={`model-item ${current === m ? "selected" : ""}`} onClick={() => void choose(m)}>
                  <span className="model-name">
                    {m.split("/").pop()}
                    {isCheap(prices[m]) && <span className="badge badge-ok model-cheap">cheap</span>}
                  </span>
                  <span className="muted small">
                    {m}
                    {prices[m] && ` · $${prices[m].input} in / $${prices[m].output} out per M`}
                  </span>
                </button>
              ))}
              {shown.length === 0 && <div className="muted small pad">No model matches “{query}”.</div>}
            </div>
          )}
          <form
            className="row gap-sm"
            onSubmit={(e) => {
              e.preventDefault();
              if (custom.trim()) void choose(custom.trim());
            }}
          >
            <input className="input grow mono" placeholder={`or type a model id: ${info.modelPlaceholder}`} value={custom} onChange={(e) => setCustom(e.target.value)} />
            <Button type="submit" disabled={!custom.trim() || custom.trim() === current}>
              Use
            </Button>
          </form>
          {current && <PriceFields settings={settings} model={current} saveSettings={saveSettings} />}
          {current && provider === "fireworks" && (
            <button className="link small" onClick={() => void api.openExternal("https://fireworks.ai/pricing")}>
              Fireworks prices <ExternalLink size={12} />
            </button>
          )}
        </>
      )}
    </StepCard>
  );
}

/** A price as people type it: `0.14`, `$0.14`, `0,14`, `0.14 /M`. NaN when it is not one. */
export function parsePrice(text: string): number {
  const t = text.trim().replace(/^\$/, "").replace(/\s*(usd|\/\s*m(tok)?|per\s*m(illion)?)\s*$/i, "").replace(",", ".").trim();
  return /^\d*\.?\d+$|^\d+\.$/.test(t) ? Number(t) : NaN;
}

/** The model's price, USD per million tokens: what the spending limits count with. */
function PriceFields({ settings, model, saveSettings }: { settings: Settings; model: string; saveSettings: (s: Partial<Settings>) => Promise<void> }) {
  const price = settings.prices[model];
  const [input, setInput] = useState(price ? String(price.input) : "");
  const [output, setOutput] = useState(price ? String(price.output) : "");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    setInput(price ? String(price.input) : "");
    setOutput(price ? String(price.output) : "");
  }, [model, price?.input, price?.output]);
  const i = parsePrice(input);
  const o = parsePrice(output);
  const problem =
    !input.trim() || !output.trim() ? "" : Number.isNaN(i) || Number.isNaN(o) ? "Enter plain numbers, e.g. 0.14 (dollars per million tokens)." : "";
  const valid = !Number.isNaN(i) && !Number.isNaN(o) && input.trim() !== "" && output.trim() !== "";
  const unchanged = price?.input === i && price?.output === o;
  return (
    <form
      className="price-block"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!valid) return;
        await saveSettings({ prices: { ...settings.prices, [model]: { input: i, output: o } } });
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
      }}
    >
      <div className="small">
        Price of <code>{model.split("/").pop()}</code> in US dollars per million tokens.{" "}
        {price ? "" : `Until you enter it, spend is counted at an assumed $${settings.assumedPrice.input} / $${settings.assumedPrice.output}: high on purpose, so the limits stop early.`}
      </div>
      <div className="price-row">
        <label className="small">
          input $ <input className="input price" inputMode="decimal" value={input} onChange={(e) => setInput(e.target.value)} placeholder={String(settings.assumedPrice.input)} />
        </label>
        <label className="small">
          output $ <input className="input price" inputMode="decimal" value={output} onChange={(e) => setOutput(e.target.value)} placeholder={String(settings.assumedPrice.output)} />
        </label>
        <Button size="sm" variant={price ? "secondary" : "primary"} type="submit" disabled={!valid || unchanged}>
          Save price
        </Button>
        {saved && <span className="ok small">Saved</span>}
        {!saved && price && unchanged && <span className="muted small">Saved: ${price.input} in, ${price.output} out</span>}
      </div>
      {problem && <div className="bad small">{problem}</div>}
    </form>
  );
}
