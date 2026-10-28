import { BookOpen, CircleDollarSign, Compass, Download, FlaskConical, Lightbulb, Rows3, GitCompare, History, MessagesSquare, Settings as SettingsIcon, Wrench, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, errorText, type Health, type LedgerState, type Project, type Settings, type UpdateState, type Upstream } from "./api";
import { ProjectSwitcher } from "./components/ProjectSwitcher";
import { useProjectFiles } from "./project";
import { formatUsd } from "../core/model/metered";
import { Logo } from "./components/Logo";
import { Button, Dot } from "./components/ui";
import { EXAMPLES } from "./examples";
import { ChatPage } from "./pages/ChatPage";
import { FeedbackPage } from "./pages/FeedbackPage";
import { RunsPage } from "./pages/RunsPage";
import { GuidePage } from "./pages/GuidePage";
import { HistoryPage } from "./pages/HistoryPage";
import { ProvePage, type ProveContext, type ProveRequest } from "./pages/ProvePage";
import { SettingsPage } from "./pages/SettingsPage";
import { SetupPage } from "./pages/SetupPage";
import { StartPage } from "./pages/StartPage";
import { UpstreamPage } from "./pages/UpstreamPage";

type Page = "start" | "prove" | "chat" | "runs" | "feedback" | "history" | "upstream" | "setup" | "settings" | "guide";

const DRAFT_KEY = "mack.draft";
/** The chat's project before projects were shared by every screen. */
const LEGACY_CHAT_PROJECT = "mack.chatProject";
const SEEN_GUIDE_KEY = "mack.seenGuide";
const ASSISTANT_KEY = "mack.proveAssistant";
const UPSTREAM_RECHECK_MS = 6 * 60 * 60 * 1000;

/** Start here on first launch, Prove afterwards. */
function firstPage(): Page {
  try {
    if (localStorage.getItem(SEEN_GUIDE_KEY)) return "prove";
    localStorage.setItem(SEEN_GUIDE_KEY, "1");
  } catch {
    return "prove";
  }
  return "start";
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
  const [update, setUpdate] = useState<UpdateState | null>(null);
  const [spend, setSpend] = useState<LedgerState | null>(null);
  const [projects, setProjects] = useState<Project[] | null>(null);
  /** A project file (or, from History, a bare statement) another screen asked Prove to open, and a message Prove handed to Chat; `n` makes a repeat count. */
  const [proveOpen, setProveOpen] = useState<ProveRequest | null>(null);
  const [chatDraft, setChatDraft] = useState<{ text: string; n: number } | null>(null);
  /** The assistant's panel beside Prove, and what Prove shows it. */
  const [assistantOpen, setAssistantOpenState] = useState(() => {
    try {
      return localStorage.getItem(ASSISTANT_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [proveContext, setProveContext] = useState<ProveContext | null>(null);
  const setAssistantOpen = (open: boolean) => {
    setAssistantOpenState(open);
    try {
      localStorage.setItem(ASSISTANT_KEY, open ? "1" : "");
    } catch {
      // The panel only starts closed next time.
    }
  };

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

  type NavItem = { id: Page; label: string; icon: typeof FlaskConical; badge?: boolean };
  // The research screens in the order a question moves through them, then the app's own.
  const nav: { group: string; items: NavItem[] }[] = [
    {
      group: "Research",
      items: [
        { id: "start", label: "Start here", icon: Compass },
        { id: "chat", label: "Chat", icon: MessagesSquare },
        { id: "prove", label: "Prove", icon: FlaskConical, badge: page !== "prove" && files.fresh > 0 },
        { id: "runs", label: "Runs", icon: Rows3 },
        { id: "history", label: "History", icon: History },
      ],
    },
    {
      group: "Mack",
      items: [
        { id: "setup", label: "Setup", icon: Wrench, badge: health !== null && !allReady },
        { id: "settings", label: "Settings", icon: SettingsIcon },
        { id: "guide", label: "Guide", icon: BookOpen },
        { id: "upstream", label: "Upstream", icon: GitCompare, badge: showBanner },
        { id: "feedback", label: "Feedback", icon: Lightbulb },
      ],
    },
  ];
  const setupMissing = [!leanOk && "Lean and Mathlib", !keyOk && "a model provider key", !modelOk && "a model"].filter((x): x is string => !!x);

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
        <ProjectSwitcher projects={projects ?? []} current={projectId} onChoose={chooseProject} onCreate={createProject} onOpen={openProject} />
        <nav>
          {nav.map((g) => (
            <div key={g.group} className="nav-group">
              <div className="nav-group-label">{g.group}</div>
              {g.items.map((n) => (
                <button key={n.id} className={`nav-item ${page === n.id ? "active" : ""}`} onClick={() => setPage(n.id)}>
                  <n.icon size={17} />
                  <span>{n.label}</span>
                  {n.badge && <span className="nav-badge" title={n.id === "prove" ? `${files.fresh} new or changed .lean file${files.fresh === 1 ? "" : "s"} in ${project?.name ?? "the project"}` : undefined} />}
                </button>
              ))}
            </div>
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
          {spend && (
            <div className="health-row" title="Everything Mack has spent in this period, against the global limit (Settings → Spending)">
              <Dot tone={spend.limit > 0 && spend.spent >= spend.limit ? "bad" : spend.limit > 0 && spend.spent >= spend.limit * 0.8 ? "warn" : "ok"} /> {formatUsd(spend.spent)}
              {spend.limit > 0 ? ` / ${formatUsd(spend.limit)}` : ""}
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
          {/* Prove and Chat stay mounted, so a run or a reply keeps going while the other is open; on Prove, Chat can sit beside it. */}
          <div className={`workspace ${page === "prove" && assistantOpen ? "with-assistant" : ""}`} hidden={page !== "prove" && page !== "chat"}>
            <div className="page-slot" hidden={page !== "prove"}>
              <ProvePage
                problem={problem}
                setProblem={setProblem}
                project={project ?? null}
                files={files}
                openRequest={proveOpen}
                onAskChat={(text) => {
                  setChatDraft({ text, n: Date.now() });
                  setAssistantOpen(true);
                }}
                assistantOpen={assistantOpen}
                onToggleAssistant={() => setAssistantOpen(!assistantOpen)}
                onContext={setProveContext}
                health={health}
                settings={settings}
                saveSettings={saveSettings}
                onGoSetup={() => setPage("setup")}
                onHealthChange={refreshHealth}
                onRunFinished={() => setRunsVersion((v) => v + 1)}
              />
            </div>
            <div className="page-slot" hidden={page !== "chat" && !(page === "prove" && assistantOpen)}>
              <ChatPage
                project={project ?? null}
                hasProjects={!!projects?.length}
                onCreateProject={createProject}
                incomingDraft={chatDraft}
                onOpenInProve={(path) => {
                  setProveOpen({ path, n: Date.now() });
                  setPage("prove");
                }}
                health={health}
                settings={settings}
                saveSettings={saveSettings}
                onGoSetup={() => setPage("setup")}
                docked={page === "prove" ? { context: proveContext, onClose: () => setAssistantOpen(false), onExpand: () => setPage("chat") } : null}
              />
            </div>
          </div>
          {page === "start" && (
            <StartPage
              setupReady={allReady}
              setupMissing={health === null ? [] : setupMissing}
              project={project ?? null}
              files={files}
              refreshKey={runsVersion}
              onCreateProject={createProject}
              onOpenProject={openProject}
              onTryWarmup={() => {
                setProveOpen({ text: EXAMPLES[0].source, n: Date.now() });
                setPage("prove");
              }}
              onAskChat={(text) => {
                setChatDraft({ text, n: Date.now() });
                setPage("chat");
              }}
              onGo={setPage}
            />
          )}
          {page === "runs" && <RunsPage projectId={projectId} projectName={project?.name ?? ""} />}
          {page === "feedback" && <FeedbackPage />}
          {page === "history" && (
            <HistoryPage
              refreshKey={runsVersion}
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
