import { BookOpen, FlaskConical, GitCompare, History, Settings as SettingsIcon, Wrench, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, type Health, type Settings, type Upstream } from "./api";
import { Logo } from "./components/Logo";
import { Button, Dot } from "./components/ui";
import { EXAMPLES } from "./examples";
import { GuidePage } from "./pages/GuidePage";
import { HistoryPage } from "./pages/HistoryPage";
import { ProvePage } from "./pages/ProvePage";
import { SettingsPage } from "./pages/SettingsPage";
import { SetupPage } from "./pages/SetupPage";
import { UpstreamPage } from "./pages/UpstreamPage";

type Page = "prove" | "history" | "upstream" | "setup" | "settings" | "guide";

const DRAFT_KEY = "mack.draft";
const SEEN_GUIDE_KEY = "mack.seenGuide";
const UPSTREAM_RECHECK_MS = 6 * 60 * 60 * 1000;

/** The Guide on first launch, Prove afterwards. */
function firstPage(): Page {
  try {
    if (localStorage.getItem(SEEN_GUIDE_KEY)) return "prove";
    localStorage.setItem(SEEN_GUIDE_KEY, "1");
  } catch {
    return "prove";
  }
  return "guide";
}

function loadDraft(): string {
  try {
    return localStorage.getItem(DRAFT_KEY) || EXAMPLES[0].source;
  } catch {
    return EXAMPLES[0].source;
  }
}

export function App() {
  const [page, setPage] = useState<Page>(firstPage);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [upstream, setUpstream] = useState<Upstream | null>(null);
  const [problem, setProblemState] = useState(loadDraft);
  const [runsVersion, setRunsVersion] = useState(0);

  const refreshHealth = useCallback(() => void api.health().then(setHealth), []);
  const recheckUpstream = useCallback(async () => setUpstream(await api.checkUpstream()), []);

  useEffect(() => {
    void api.getSettings().then((s) => {
      setSettings(s);
      refreshHealth();
    });
    void recheckUpstream();
    // Keep checking while Mack stays open; the main process returns "off" when checks are disabled.
    const timer = setInterval(() => void recheckUpstream(), UPSTREAM_RECHECK_MS);
    return () => clearInterval(timer);
  }, [refreshHealth, recheckUpstream]);

  const saveSettings = async (patch: Partial<Settings>) => {
    setSettings(await api.setSettings(patch));
  };

  const setProblem = (p: string) => {
    setProblemState(p);
    try {
      localStorage.setItem(DRAFT_KEY, p);
    } catch {
      // A draft that is not remembered is only a convenience lost.
    }
  };

  if (!settings) return <div className="boot" />;

  const leanOk = !!health?.lake && !!health?.hasMathlib;
  const keyOk = !!health && health.keySource !== "none";
  const modelOk = !!health?.model;
  const allReady = leanOk && keyOk && modelOk;
  const showBanner = upstream?.kind === "changed" && !upstream.dismissed;

  const nav: { id: Page; label: string; icon: typeof FlaskConical; badge?: boolean }[] = [
    { id: "prove", label: "Prove", icon: FlaskConical },
    { id: "history", label: "History", icon: History },
    { id: "upstream", label: "Upstream", icon: GitCompare, badge: showBanner },
    { id: "setup", label: "Setup", icon: Wrench, badge: health !== null && !allReady },
    { id: "settings", label: "Settings", icon: SettingsIcon },
    { id: "guide", label: "Guide", icon: BookOpen },
  ];

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="logo">
            <Logo />
          </div>
          <div>
            <div className="brand-name">Mack</div>
            <div className="brand-sub">Lean-checked research</div>
          </div>
        </div>
        <nav>
          {nav.map((n) => (
            <button key={n.id} className={`nav-item ${page === n.id ? "active" : ""}`} onClick={() => setPage(n.id)}>
              <n.icon size={17} />
              <span>{n.label}</span>
              {n.badge && <span className="nav-badge" />}
            </button>
          ))}
        </nav>
        <button className="health" onClick={() => setPage("setup")}>
          <div className="health-row">
            <Dot tone={health === null ? "neutral" : leanOk ? "ok" : "bad"} /> Lean
          </div>
          <div className="health-row">
            <Dot tone={health === null ? "neutral" : keyOk ? "ok" : "bad"} /> API key
          </div>
          <div className="health-row">
            <Dot tone={health === null ? "neutral" : modelOk ? "ok" : "bad"} /> Model
          </div>
        </button>
      </aside>

      <main className="content">
        {showBanner && upstream.kind === "changed" && (
          <div className="banner">
            <GitCompare size={16} />
            <div className="banner-text">
              <strong>Open Math Harness updated its methodology.</strong> {upstream.commits} new commit{upstream.commits === 1 ? "" : "s"} change{" "}
              {upstream.files.length} file{upstream.files.length === 1 ? "" : "s"} Mack follows. Mack keeps working as it is until they are ported.
            </div>
            <Button size="sm" onClick={() => setPage("upstream")}>
              See what changed
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                await saveSettings({ upstreamDismissed: upstream.head });
                setUpstream({ ...upstream, dismissed: true });
              }}
            >
              Stay on this version
            </Button>
            <button className="icon-btn" title="Dismiss" onClick={() => setUpstream({ ...upstream, dismissed: true })}>
              <X size={15} />
            </button>
          </div>
        )}
        <div className="content-inner">
          {page === "prove" && (
            <ProvePage
              problem={problem}
              setProblem={setProblem}
              health={health}
              maxAttempts={settings.maxAttempts}
              onGoSetup={() => setPage("setup")}
              onRunFinished={() => setRunsVersion((v) => v + 1)}
            />
          )}
          {page === "history" && (
            <HistoryPage
              refreshKey={runsVersion}
              onRerun={(p) => {
                setProblem(p);
                setPage("prove");
              }}
            />
          )}
          {page === "setup" && <SetupPage health={health} settings={settings} onChanged={refreshHealth} saveSettings={saveSettings} />}
          {page === "upstream" && <UpstreamPage settings={settings} saveSettings={saveSettings} upstream={upstream} recheckUpstream={recheckUpstream} />}
          {page === "settings" && <SettingsPage settings={settings} saveSettings={saveSettings} onGo={setPage} />}
          {page === "guide" && <GuidePage onGo={setPage} />}
        </div>
      </main>
    </div>
  );
}
