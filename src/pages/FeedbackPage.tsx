import { Bug, ExternalLink, Lightbulb, MessageCircle, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, errorText, type Issue } from "../api";
import { Badge, Button, Field, timeAgo } from "../components/ui";

/** Report a problem or suggest an idea as a GitHub issue, and follow the open ones. */
export function FeedbackPage() {
  const [kind, setKind] = useState<"bug" | "idea">("idea");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [diag, setDiag] = useState("");
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [filter, setFilter] = useState<"all" | "bug" | "idea">("all");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const load = useCallback(() => {
    setError("");
    api.feedbackIssues().then(setIssues, (e) => setError(errorText(e)));
  }, []);
  useEffect(() => {
    load();
    void api.feedbackDiagnostics().then(setDiag);
  }, [load]);

  const shown = (issues ?? []).filter((i) => filter === "all" || i.kind === filter);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Feedback</h1>
        <p className="muted">
          Report a problem or suggest an idea. Mack opens GitHub's issue form with your text filled in; you review it and submit it from your own account.
          Nothing is sent from here, and no key, file or chat goes with it.
        </p>
      </div>

      <section className="settings-group">
        <div className="mode-switch">
          <button className={kind === "idea" ? "active" : ""} onClick={() => setKind("idea")}>
            <Lightbulb size={13} /> Suggest an idea
          </button>
          <button className={kind === "bug" ? "active" : ""} onClick={() => setKind("bug")}>
            <Bug size={13} /> Report a problem
          </button>
        </div>
        <Field label="Title">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === "idea" ? "e.g. Export proofs as a Lean project" : "e.g. Search tree stops after round 1"} />
        </Field>
        <Field label={kind === "idea" ? "The idea" : "What happened"}>
          <textarea className="input" rows={5} value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
        <details>
          <summary className="small muted">Diagnostics that will be included</summary>
          <pre className="lean-output">{diag}</pre>
        </details>
        <div className="row gap-sm">
          <Button
            variant="primary"
            icon={ExternalLink}
            disabled={!title.trim()}
            onClick={async () => {
              setError("");
              try {
                await api.openFeedback(kind, title, body);
                setSent(true);
              } catch (e) {
                setError(errorText(e));
              }
            }}
          >
            Open on GitHub
          </Button>
          {sent && <span className="muted small">Opened in your browser; submit it there (a GitHub account is needed).</span>}
        </div>
      </section>

      <section className="settings-group">
        <div className="row gap-sm">
          <h2>Open issues and ideas</h2>
          <select className="model-select" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
            <option value="all">All</option>
            <option value="idea">Ideas</option>
            <option value="bug">Problems</option>
          </select>
          <button className="link small" onClick={load}>
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
        {error && <div className="notice notice-bad">{error}</div>}
        {issues && shown.length === 0 && <p className="muted small">Nothing open here yet.</p>}
        <div className="run-list">
          {shown.map((i) => (
            <button key={i.number} className="run-row" onClick={() => void api.openExternal(i.url)}>
              <Badge tone={i.kind === "bug" ? "bad" : i.kind === "idea" ? "ok" : "neutral"}>{i.kind === "bug" ? "problem" : i.kind}</Badge>
              <span className="run-thm">
                #{i.number} {i.title}
              </span>
              <span className="run-meta muted small">
                <MessageCircle size={12} /> {i.comments} · {timeAgo(new Date(i.createdAt).getTime())}
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
