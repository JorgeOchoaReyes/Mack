import { ArrowRight, Check, ChevronDown, FolderOpen, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, errorText, type Project } from "../api";
import { Button } from "./ui";

/** Problems people try first; famous open ones included, so the honest "very unlikely" shows up early. */
export const EXAMPLE_PROBLEMS = [
  "Is there an odd perfect number?",
  "Are there infinitely many twin primes?",
  "Why is the square root of 2 irrational?",
  "Does every Collatz sequence reach 1?",
];

/** A short folder-safe name from the person's description: its first words, without punctuation. */
export function problemName(description: string): string {
  const words = description
    .replace(/[<>:"/\\|?*\u0000-\u001f.,;!]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return words.slice(0, 7).join(" ").slice(0, 48).trim();
}

/**
 * Start a problem: the person describes it in their own words, and that description becomes the first message of its chat.
 * Shared by the sidebar picker and the welcome screen.
 */
export function NewProjectForm({ onCreated, primary }: { onCreated: (p: Project, description: string) => void; primary?: boolean }) {
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const attempt = async (f: () => Promise<Project | null>, text: string) => {
    setError("");
    setBusy(true);
    try {
      const p = await f();
      if (p) {
        setDescription("");
        onCreated(p, text);
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const submit = () => {
    const text = description.trim();
    if (text) void attempt(() => api.createProject(problemName(text)), text);
  };
  return (
    <div className={`new-project ${primary ? "primary" : ""}`}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <textarea
          className="input new-problem-input"
          rows={primary ? 3 : 2}
          placeholder="What do you want to work on? Plain words are fine, e.g. Is there an odd perfect number?"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <Button variant="primary" size={primary ? "md" : "sm"} icon={ArrowRight} type="submit" loading={busy} disabled={!description.trim()} title="Make a folder for this problem in MackProjects and start talking about it">
          Start
        </Button>
      </form>
      {primary && (
        <div className="example-problems">
          {EXAMPLE_PROBLEMS.map((q) => (
            <button key={q} type="button" className="chip" onClick={() => setDescription(q)}>
              {q}
            </button>
          ))}
        </div>
      )}
      <button className="link small" type="button" onClick={() => void attempt(() => api.openProject(), "")}>
        <FolderOpen size={13} /> Or continue in a folder you already have…
      </button>
      {error && <div className="notice notice-bad small">{error}</div>}
    </div>
  );
}

/** The current problem at the top of the sidebar: every page in the first group works on it. */
export function ProjectPicker({ projects, current, onPick, onCreated }: { projects: Project[]; current: Project | undefined; onPick: (id: string) => void; onCreated: (p: Project, description: string) => void }) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  useEffect(() => {
    if (!open) setAdding(false);
  }, [open]);

  return (
    <div className="project-picker" ref={box}>
      <button className="project-current" onClick={() => setOpen(!open)} title={current?.folder}>
        <span className="project-label">Problem</span>
        <span className="project-name">{current?.name ?? "None yet"}</span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="project-menu">
          {projects.length > 0 && <div className="project-menu-label">Your problems</div>}
          {projects.map((p) => (
            <button
              key={p.id}
              className="project-option"
              title={p.folder}
              onClick={() => {
                onPick(p.id);
                setOpen(false);
              }}
            >
              <span>{p.name}</span>
              {p.id === current?.id && <Check size={14} />}
            </button>
          ))}
          <div className="project-menu-new">
            {adding ? (
              <NewProjectForm
                onCreated={(p, d) => {
                  onCreated(p, d);
                  setOpen(false);
                }}
              />
            ) : (
              <button className="project-option" onClick={() => setAdding(true)}>
                <span className="row gap-sm">
                  <Plus size={14} /> New problem
                </span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
