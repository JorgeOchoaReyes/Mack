import { BookOpen, CircleDollarSign, Download, FlaskConical, Lightbulb, PanelLeftClose, PanelLeftOpen, Rows3, GitCompare, History, MessagesSquare, Settings as SettingsIcon, Wrench, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, errorText, type Health, type LedgerState, type Project, type Settings, type UpdateState, type Upstream } from "./api";
import { useProjectFiles } from "./project";
import { formatUsd } from "../core/model/metered";
import { Logo } from "./components/Logo";
import { ProjectPicker } from "./components/ProjectPicker";
import { Button, Dot } from "./components/ui";
import { EXAMPLES } from "./examples";
import { ChatPage } from "./pages/ChatPage";
import { FeedbackPage } from "./pages/FeedbackPage";
import { RunsPage } from "./pages/RunsPage";
import { GuidePage } from "./pages/GuidePage";
import { HistoryPage } from "./pages/HistoryPage";
import { ProvePage, type ProveRequest } from "./pages/ProvePage";
import { SettingsPage } from "./pages/SettingsPage";
import { SetupPage } from "./pages/SetupPage";
import { UpstreamPage } from "./pages/UpstreamPage";
import { WelcomePage } from "./pages/WelcomePage";

type Page = "prove" | "chat" | "runs" | "feedback" | "history" | "upstream" | "setup" | "settings" | "guide";

/** Pages that work on the current problem; without one they show the welcome screen. */
const PROJECT_PAGES: Page[] = ["chat", "prove", "runs", "history"];

const DRAFT_KEY = "mack.draft";
/** The chat's project before projects were shared by every screen. */
const LEGACY_CHAT_PROJECT = "mack.chatProject";
const NAV_KEY = "mack.navCollapsed";
const UPSTREAM_RECHECK_MS = 6 * 60 * 60 * 1000;

function loadDraft(): string {
  try {
    return localStorage.getItem(DRAFT_KEY) || EXAMPLES[0].source;
  } catch {
    return EXAMPLES[0].source;
  }
}

export function App() {
  const [page, setPage] = useState<Page>("chat");
  /** A new problem's description, sent as the first message of its chat. */
  const [firstMessage, setFirstMessage] = useState<{ projectId: string; text: string } | null>(null);
  const [navCollapsed, setNavCollapsedState] = useState(() => {
    try {
      return localStorage.getItem(NAV_KEY) === "1";
    } catch {
      return false;
    }
  });
  const setNavCollapsed = useCallback((v: boolean) => {
    setNavCollapsedState(v);
    try {
      localStorage.setItem(NAV_KEY, v ? "1" : "0");
    } catch {
      // Only a remembered layout.
    }
  }, []);

  // Ctrl+B folds the sidebar, as in most editors.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setNavCollapsedState((v) => {
          try {
            localStorage.setItem(NAV_KEY, v ? "0" : "1");
          } catch {
            // Only a remembered layout.
          }
          return !v;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [upstream, setUpstream] = useState<Upstream | null>(null);
  const [problem, setProblemState] = useState(loadDraft);
  const [runsVersion, setRunsVersion] = useState(0);
  const [update, setUpdate] = useState<UpdateState | null>(null);
  const [spend, setSpend] = useState<LedgerState | null>(null);
  const [projects, setProjects] = useState<Project[] | null>(null);
  /** A project file (or, from History, a bare statement) another screen asked Prove to open, and a message Prove handed to Chat; `n` makes a repeat count. */
  const [proveOpen, setProveOpen] = useState<ProveRequest | null>(null);
  const [runOpen, setRunOpen] = useState<{ id: string; n: number } | null>(null);
  const [chatDraft, setChatDraft] = useState<{ text: string; n: number } | null>(null);

  const reloadProjects = useCallback(async () => setProjects(await api.listProjects()), []);
  useEffect(() => void reloadProjects(), [reloadProjects]);

  useEffect(() => {
    void api.globalSpend().then(setSpend);
    return api.onGlobalSpend(setSpend);
  }, []);

  useEffect(() => {
    void api.subscribeUpdates().then(setUpdate);
    return api.onUpdateEvent(setUpdate);
  }, []);

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

  const projectId = activeProjectId(settings, projects);
  const files = useProjectFiles(projectId);

  // Keep the saved choice in step with what is shown: a removed project falls back to the first one.
  useEffect(() => {
    if (settings && projects && projectId !== settings.activeProject) void saveSettings({ activeProject: projectId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, projects]);

  const chooseProject = (id: string) => void saveSettings({ activeProject: id });
  const createProject = async (name: string): Promise<string> => {
    try {
      const p = await api.createProject(name);
      await reloadProjects();
      await saveSettings({ activeProject: p.id });
      return "";
    } catch (e) {
      return errorText(e);
    }
  };
  /** A problem made from the welcome screen or the picker: it becomes active and its chat opens with the description. */
  const projectCreated = async (p: Project, description = "") => {
    await reloadProjects();
    await saveSettings({ activeProject: p.id });
    if (description.trim()) setFirstMessage({ projectId: p.id, text: description.trim() });
    setPage("chat");
  };
  const openProject = async (): Promise<string> => {
    try {
      const p = await api.openProject();
      if (p) {
        await reloadProjects();
        await saveSettings({ activeProject: p.id });
      }
      return "";
    } catch (e) {
      return errorText(e);
    }
  };

  if (!settings) return <div className="boot" />;

  const project = projects?.find((p) => p.id === projectId);

  const leanOk = !!health?.lake && !!health?.hasMathlib;
  const keyOk = !!health && health.keySource !== "none";
  const modelOk = !!health?.model;
  const allReady = leanOk && keyOk && modelOk;
  const showBanner = upstream?.kind === "changed" && !upstream.dismissed;

  const freshFiles = page !== "prove" && files.fresh > 0;
  type NavItem = { id: Page; label: string; hint: string; icon: typeof FlaskConical; badge?: boolean };
  const work: NavItem[] = [
    { id: "chat", label: "Chat", hint: "Talk about the problem in plain words; the assistant plans and does the work", icon: MessagesSquare },
    {
      id: "prove",
      label: "Lean editor",
      hint: freshFiles ? `${files.fresh} new or changed .lean file${files.fresh === 1 ? "" : "s"} in ${project?.name ?? "the problem"}` : "The problem's Lean files: write a statement and have the model prove it",
      icon: FlaskConical,
      badge: freshFiles,
    },
    { id: "runs", label: "Proof searches", hint: "Long searches for proofs of many statements at once", icon: Rows3 },
    { id: "history", label: "Proof attempts", hint: "Every proof attempt, verified or not", icon: History },
  ];
  const more: NavItem[] = [
    { id: "setup", label: "Setup", hint: "Lean, API keys and models", icon: Wrench, badge: health !== null && !allReady },
    { id: "settings", label: "Settings", hint: "Spending limits and how runs behave", icon: SettingsIcon },
    { id: "guide", label: "Guide", hint: "How Mack works", icon: BookOpen },
    { id: "upstream", label: "Harness updates", hint: "Changes in Open Math Harness, the methods Mack follows", icon: GitCompare, badge: showBanner },
    { id: "feedback", label: "Feedback", hint: "Report a bug or suggest an idea", icon: Lightbulb },
  ];
  const navButton = (n: NavItem) => (
    <button key={n.id} className={`nav-item ${page === n.id ? "active" : ""}`} title={navCollapsed ? `${n.label}: ${n.hint}` : n.hint} onClick={() => setPage(n.id)}>
      <n.icon size={17} />
      <span className="nav-text">{n.label}</span>
      {n.badge && <span className="nav-badge" />}
    </button>
  );
  const welcome = !!projects && !project && PROJECT_PAGES.includes(page);

  return (
    <div className={`shell ${navCollapsed ? "nav-collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="brand">
          <div className="logo">
            <Logo />
          </div>
          <div className="brand-text">
            <div className="brand-name">Mack</div>
            <div className="brand-sub">Lean-checked research</div>
          </div>
          <button className="icon-btn nav-toggle" title={navCollapsed ? "Expand the sidebar (Ctrl+B)" : "Collapse the sidebar (Ctrl+B)"} onClick={() => setNavCollapsed(!navCollapsed)}>
            {navCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </div>
        {navCollapsed ? (
          <button className="project-mini" title={`Problem: ${project?.name ?? "none yet"} (click to switch)`} onClick={() => setNavCollapsed(false)}>
            {(project?.name ?? "?").trim().charAt(0).toUpperCase()}
          </button>
        ) : (
          <ProjectPicker projects={projects ?? []} current={project} onPick={chooseProject} onCreated={(p, d) => void projectCreated(p, d)} />
        )}
        <nav>
          {work.map(navButton)}
          <div className="nav-group">Mack</div>
          {more.map(navButton)}
        </nav>
        <button className="health" onClick={() => setPage("setup")}>
          <div className="health-row" title="Lean">
            <Dot tone={health === null ? "neutral" : leanOk ? "ok" : "bad"} /> <span className="nav-text">Lean</span>
          </div>
          <div className="health-row" title="API key">
            <Dot tone={health === null ? "neutral" : keyOk ? "ok" : "bad"} /> <span className="nav-text">API key</span>
          </div>
          <div className="health-row" title="Model">
            <Dot tone={health === null ? "neutral" : modelOk ? "ok" : "bad"} /> <span className="nav-text">Model</span>
          </div>
          {spend && (
            <div className="health-row" title={`Spent ${formatUsd(spend.spent)}${spend.limit > 0 ? ` of ${formatUsd(spend.limit)}` : ""}: everything Mack has spent in this period, against the global limit (Settings → Spending)`}>
              <Dot tone={spend.limit > 0 && spend.spent >= spend.limit ? "bad" : spend.limit > 0 && spend.spent >= spend.limit * 0.8 ? "warn" : "ok"} />{" "}
              <span className="nav-text">
                {formatUsd(spend.spent)}
                {spend.limit > 0 ? ` / ${formatUsd(spend.limit)}` : ""}
              </span>
            </div>
          )}
        </button>
      </aside>

      <main className="content">
        {spend && spend.limit > 0 && spend.spent >= spend.limit && (
          <div className="banner">
            <CircleDollarSign size={16} />
            <div className="banner-text">
              <strong>The global spending limit is reached</strong> ({formatUsd(spend.spent)} of {formatUsd(spend.limit)}
              {spend.period === "total" ? "" : ` this ${spend.period}`}). No model calls run until you raise or reset it.
            </div>
            <Button size="sm" onClick={() => setPage("settings")}>
              Spending settings
            </Button>
          </div>
        )}
        {update?.state === "ready" && (
          <div className="banner">
            <Download size={16} />
            <div className="banner-text">
              <strong>Mack {update.version} is ready.</strong> It installs when you quit Mack, or now if you restart.
            </div>
            <Button size="sm" onClick={() => void api.installUpdate()}>
              Restart and update
            </Button>
          </div>
        )}
        {showBanner && upstream.kind === "changed" && (
          <div className="banner">
            <GitCompare size={16} />
            <div className="banner-text">
              <strong>Open Math Harness updated its methodology.</strong> {upstream.commits} new commit{upstream.commits === 1 ? "" : "s"} change{" "}
              {upstream.files.length} file{upstream.files.length === 1 ? "" : "s"} Mack follows.{" "}
              {upstream.release ? `Mack ${upstream.release.version} is aligned with a newer upstream version: updating Mack brings what it ports.` : "Mack keeps working as it is until they are ported."}
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
          {welcome && <WelcomePage health={health} onGoSetup={() => setPage("setup")} onGoGuide={() => setPage("guide")} onCreated={(p, d) => void projectCreated(p, d)} />}
          {/* Prove and Chat stay mounted, so a run or a reply keeps going while the other is open. */}
          <div className="page-slot" hidden={welcome || page !== "prove"}>
            <ProvePage
              problem={problem}
              setProblem={setProblem}
              project={project ?? null}
              files={files}
              openRequest={proveOpen}
              onAskChat={(text) => {
                setChatDraft({ text, n: Date.now() });
                setPage("chat");
              }}
              health={health}
              settings={settings}
              saveSettings={saveSettings}
              onGoSetup={() => setPage("setup")}
              onHealthChange={refreshHealth}
              onRunFinished={() => setRunsVersion((v) => v + 1)}
            />
          </div>
          <div className="page-slot" hidden={welcome || page !== "chat"}>
            <ChatPage
              project={project ?? null}
              hasProjects={!!projects?.length}
              onCreateProject={createProject}
              incomingDraft={chatDraft}
              onOpenInProve={(path) => {
                setProveOpen({ path, n: Date.now() });
                setPage("prove");
              }}
              onOpenRun={(id) => {
                setRunOpen({ id, n: Date.now() });
                setPage("history");
              }}
              health={health}
              settings={settings}
              saveSettings={saveSettings}
              onGoSetup={() => setPage("setup")}
              firstMessage={firstMessage && firstMessage.projectId === projectId ? firstMessage.text : undefined}
              onFirstMessageUsed={() => setFirstMessage(null)}
            />
          </div>
          {!welcome && page === "runs" && <RunsPage projectId={projectId} projectName={project?.name ?? ""} />}
          {page === "feedback" && <FeedbackPage />}
          {!welcome && page === "history" && (
            <HistoryPage
              refreshKey={runsVersion}
              openRequest={runOpen}
              projectId={projectId}
              projectName={project?.name ?? ""}
              onRerun={(p) => {
                setProveOpen({ text: p, n: Date.now() });
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

/** The saved active project while it exists; before projects were shared, the chat's last one; else the first. */
function activeProjectId(settings: Settings | null, projects: Project[] | null): string {
  if (!settings || !projects) return settings?.activeProject ?? "";
  if (projects.some((p) => p.id === settings.activeProject)) return settings.activeProject;
  let legacy = "";
  try {
    legacy = localStorage.getItem(LEGACY_CHAT_PROJECT) ?? "";
  } catch {
    // No remembered chat project.
  }
  return projects.find((p) => p.id === legacy)?.id ?? projects[0]?.id ?? "";
}
