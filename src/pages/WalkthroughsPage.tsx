// Every walkthrough of the problem in one place: each proved result with its
// walkthrough (or a way to have one written), and every walkthrough kept in
// the problem folder, earlier versions included, to watch again.

import { BookOpenCheck, Clapperboard, MessagesSquare, Network, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type Plan, type SavedWalkthrough } from "../api";
import { ShowMe } from "../components/ShowMe";
import { Button, EmptyState, timeAgo } from "../components/ui";

type Props = { projectId: string; projectName: string; onAsk: (text: string) => void };

export function WalkthroughsPage({ projectId, projectName, onAsk }: Props) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [saved, setSaved] = useState<SavedWalkthrough[] | null>(null);
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<{ file: string; id?: string } | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let live = true;
    void api.getPlan(projectId).then((p) => live && setPlan(p)).catch(() => live && setPlan(null));
    void api.showmeList(projectId).then((l) => live && setSaved(l)).catch(() => live && setSaved([]));
    return () => {
      live = false;
    };
  }, [projectId, version]);

  const proved = [...(plan?.proved ?? [])].reverse();
  const latestOf = (file: string) => saved?.find((w) => w.file === file && w.latest && w.current);
  const q = filter.trim().toLowerCase();
  const shown = (saved ?? []).filter((w) => !q || [w.theorem, w.file, w.idea].some((x) => x?.toLowerCase().includes(q)));
  const name = (w: { file: string; theorem?: string }) => (w.file === "*" ? "The whole proof" : (w.theorem ?? w.file.split("/").pop()));

  return (
    <div className="page walkthroughs">
      <div className="page-head">
        <h1>Walkthroughs</h1>
        <p className="muted">
          A walkthrough explains a proof Lean accepted, one step at a time, in plain words. Each is kept in {projectName || "the problem"}'s folder, earlier
          versions too, so you can watch it again. The proof is what Lean checked; the walkthrough is the model's explanation of it.
        </p>
      </div>

      <section className="wt-section">
        <h2>Proved results</h2>
        {proved.length === 0 ? (
          <EmptyState
            icon={BookOpenCheck}
            title="Nothing proved yet"
            actions={
              <Button variant="primary" icon={MessagesSquare} onClick={() => onAsk("")}>
                Work on it in Chat
              </Button>
            }
          >
            When Lean accepts a proof in this problem, it is listed here, and the model can walk you through it step by step in plain words.
          </EmptyState>
        ) : (
          <div className="wt-grid">
            {proved.length > 1 && (
              <WtCard
                icon={Network}
                title="The whole proof"
                sub={`How the ${proved.length} proved results fit together`}
                has={!!latestOf("*")}
                onOpen={() => setOpen({ file: "*" })}
              />
            )}
            {proved.map((p) => (
              <WtCard key={p.file} icon={BookOpenCheck} title={p.theorem ?? p.file.split("/").pop() ?? p.file} sub={p.summary ?? p.file} has={!!latestOf(p.file)} onOpen={() => setOpen({ file: p.file })} />
            ))}
          </div>
        )}
      </section>

      <section className="wt-section">
        <div className="row gap-sm wt-head">
          <h2>All saved walkthroughs{saved ? ` (${saved.length})` : ""}</h2>
          {saved && saved.length > 3 && (
            <label className="wt-filter">
              <Search size={13} />
              <input className="input" placeholder="Filter by theorem, file or idea" value={filter} onChange={(e) => setFilter(e.target.value)} />
            </label>
          )}
        </div>
        {saved && saved.length === 0 && <p className="muted small">None yet. Open a proved result above, or type /showme in the chat.</p>}
        <div className="run-list">
          {shown.map((w) => (
            <button key={w.id} className="run-row wt-row" onClick={() => setOpen({ file: w.file, id: w.id })}>
              <Clapperboard size={16} className={w.current ? "accent" : "muted"} />
              <span className="run-thm">
                <span className="mono">{name(w)}</span>
                {w.file !== "*" && <span className="muted small wt-file">{w.file}</span>}
                {w.idea && <span className="wt-idea small">{w.idea}</span>}
              </span>
              <span className="run-meta muted small">
                {w.steps} steps · {w.model.split("/").pop()} · {timeAgo(w.createdAt)}
                {!w.current ? " · for an earlier proof" : !w.latest ? " · older version" : ""}
              </span>
            </button>
          ))}
        </div>
      </section>

      {open && (
        <ShowMe
          key={`${open.file}|${open.id ?? ""}`}
          projectId={projectId}
          file={open.file}
          savedId={open.id}
          onClose={() => (setOpen(null), setVersion((v) => v + 1))}
          onAsk={(text) => (setOpen(null), onAsk(text))}
        />
      )}
    </div>
  );
}

function WtCard({ icon: Icon, title, sub, has, onOpen }: { icon: typeof Network; title: string; sub: string; has: boolean; onOpen: () => void }) {
  return (
    <div className="wt-card">
      <div className="row gap-sm">
        <Icon size={15} className="accent" />
        <b className="mono wt-title">{title}</b>
      </div>
      <p className="muted small">{sub}</p>
      <Button size="sm" variant={has ? "primary" : "secondary"} icon={Clapperboard} onClick={onOpen} title={has ? "Watch the walkthrough of this proof" : "The model writes a walkthrough of this proof, then you watch it"}>
        {has ? "Watch" : "Write a walkthrough"}
      </Button>
    </div>
  );
}
