import { CircleCheck, ExternalLink, GitCommitHorizontal, GitCompare, RefreshCw, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { UPSTREAM } from "../../core/upstream";
import { api, type Settings, type Upstream } from "../api";
import { Badge, Button, Toggle, timeAgo } from "../components/ui";

type Props = {
  settings: Settings;
  saveSettings: (s: Partial<Settings>) => Promise<void>;
  upstream: Upstream | null;
  recheckUpstream: () => Promise<void>;
};

export function UpstreamPage({ settings, saveSettings, upstream, recheckUpstream }: Props) {
  const [checking, setChecking] = useState(false);
  const check = async () => {
    setChecking(true);
    await recheckUpstream();
    setChecking(false);
  };
  const changed = upstream?.kind === "changed" ? upstream : null;
  const byArea = new Map<string, NonNullable<typeof changed>["files"]>();
  for (const f of changed?.files ?? []) byArea.set(f.area, [...(byArea.get(f.area) ?? []), f]);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Upstream methodology</h1>
        <p className="muted">
          Mack follows Open Math Harness, the runtime of Open Math OS. This screen shows whether upstream has changed how it checks, searches or
          prompts since the version Mack implements. Mack itself does not change until a change is ported.
        </p>
      </div>

      <section className="settings-group">
        <div className="status-line">
          {upstream === null || checking ? (
            <>
              <RefreshCw size={18} className="spin" /> Checking GitHub…
            </>
          ) : upstream.kind === "off" ? (
            <span className="muted">Automatic checks are off.</span>
          ) : upstream.kind === "error" ? (
            <>
              <TriangleAlert size={18} className="bad" /> Could not reach GitHub: {upstream.message}
            </>
          ) : upstream.kind === "current" ? (
            <>
              <CircleCheck size={18} className="ok" /> Mack is aligned with upstream. No methodology changes since <code>{upstream.baseline.slice(0, 7)}</code>.
            </>
          ) : (
            <>
              <GitCompare size={18} className="accent" />
              <span>
                <strong>{upstream.files.length}</strong> methodology file{upstream.files.length === 1 ? "" : "s"} changed in <strong>{upstream.commits}</strong> upstream commit
                {upstream.commits === 1 ? "" : "s"}.
                {upstream.dismissed && <span className="muted"> You chose to stay on the current version.</span>}
              </span>
            </>
          )}
        </div>
        <div className="kv">
          <span>Upstream</span>
          <span>
            <button className="link" onClick={() => void api.openExternal(`https://github.com/${UPSTREAM.repo}`)}>
              {UPSTREAM.repo} <ExternalLink size={12} />
            </button>
          </span>
          <span>Mack implements</span>
          <span>
            <code>{UPSTREAM.baseline.slice(0, 7)}</code>
          </span>
          {upstream && upstream.kind !== "off" && (
            <>
              <span>Last checked</span>
              <span>{timeAgo(upstream.checkedAt)}</span>
            </>
          )}
        </div>
        <Toggle
          checked={settings.upstreamCheck}
          onChange={async (v) => {
            await saveSettings({ upstreamCheck: v });
            await recheckUpstream();
          }}
          label="Check automatically when Mack opens and every 6 hours while it runs"
        />
        <div className="row gap-sm">
          <Button icon={RefreshCw} loading={checking} disabled={!settings.upstreamCheck} onClick={() => void check()}>
            Check now
          </Button>
          {changed && (
            <Button icon={GitCompare} onClick={() => void api.openExternal(changed.compareUrl)}>
              Full diff on GitHub
            </Button>
          )}
          {changed && !changed.dismissed && (
            <Button
              variant="ghost"
              onClick={async () => {
                await saveSettings({ upstreamDismissed: changed.head });
                await recheckUpstream();
              }}
            >
              Stay on the current version
            </Button>
          )}
          {changed?.dismissed && (
            <Button
              variant="ghost"
              onClick={async () => {
                await saveSettings({ upstreamDismissed: "" });
                await recheckUpstream();
              }}
            >
              Show update notices again
            </Button>
          )}
        </div>
      </section>

      {changed && (
        <section className="settings-group">
          <h2>What changed, by area</h2>
          <div className="area-list">
            {[...byArea].map(([area, files]) => (
              <div key={area} className="area">
                <div className="area-head">
                  <strong>{area}</strong>
                  <span className="muted small">in Mack: {files[0].mack}</span>
                </div>
                {files.map((f) => (
                  <button key={f.path} className="file-row" onClick={() => void api.openExternal(f.url)}>
                    <Badge tone={f.status === "removed" ? "bad" : f.status === "added" ? "ok" : "warn"}>{f.status}</Badge>
                    <code>{f.path}</code>
                    <ExternalLink size={12} className="muted" />
                  </button>
                ))}
              </div>
            ))}
          </div>
        </section>
      )}

      {changed && changed.recent.length > 0 && (
        <section className="settings-group">
          <h2>Recent upstream commits</h2>
          <div className="commit-list">
            {changed.recent.map((c) => (
              <button key={c.sha} className="commit-row" onClick={() => void api.openExternal(c.url)}>
                <GitCommitHorizontal size={15} className={c.touchesWatched ? "accent" : "muted"} />
                <code className="muted">{c.sha.slice(0, 7)}</code>
                <span className="commit-msg">{c.message}</span>
                {c.touchesWatched && <Badge tone="warn">methodology</Badge>}
                <span className="muted small">{c.date ? new Date(c.date).toLocaleDateString() : ""}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="settings-group">
        <h2>How an upgrade happens</h2>
        <ol className="plain-steps">
          <li>Mack, or a weekly GitHub job on the Mack repo, notices that upstream changed a methodology file.</li>
          <li>
            A maintainer runs <code>npm run upstream</code> to see the changes grouped by Mack module, then ports the ones that apply.
          </li>
          <li>
            <code>npm run upstream -- --accept</code> records the new upstream version, committed together with the port.
          </li>
          <li>You update Mack. Until then, Mack keeps working exactly as it does now.</li>
        </ol>
      </section>
    </div>
  );
}
