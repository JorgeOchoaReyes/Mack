// The project every screen works in, chosen once in the sidebar: Prove lists
// its .lean files, Chat talks about it, History and Runs show its runs.

import { FolderOpen, FolderPlus, Plus } from "lucide-react";
import { useState } from "react";
import type { Project } from "../api";
import { Button } from "./ui";

type Props = {
  projects: Project[];
  current: string;
  onChoose: (id: string) => void;
  /** Each resolves to an error message, or "" when it worked. */
  onCreate: (name: string) => Promise<string>;
  onOpen: () => Promise<string>;
};

export function ProjectSwitcher({ projects, current, onChoose, onCreate, onOpen }: Props) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const project = projects.find((p) => p.id === current);

  return (
    <div className="project-switch">
      <div className="project-switch-label">Project</div>
      <div className="row gap-sm">
        <select className="input grow" value={current} title={project?.folder} onChange={(e) => onChoose(e.target.value)}>
          {projects.length === 0 && <option value="">No project yet</option>}
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button className="icon-btn" title="New project" onClick={() => (setAdding(!adding), setError(""))}>
          <Plus size={15} />
        </button>
        <button className="icon-btn" title="Use an existing folder as a project" onClick={async () => setError(await onOpen())}>
          <FolderOpen size={15} />
        </button>
      </div>
      {adding && (
        <form
          className="row gap-sm"
          onSubmit={async (e) => {
            e.preventDefault();
            const err = await onCreate(name);
            setError(err);
            if (!err) {
              setName("");
              setAdding(false);
            }
          }}
        >
          <input className="input grow" autoFocus placeholder="e.g. odd-perfect" value={name} onChange={(e) => setName(e.target.value)} />
          <Button size="sm" icon={FolderPlus} type="submit" disabled={!name.trim()} title="Create a project folder in MackProjects">
            Create
          </Button>
        </form>
      )}
      {error && <div className="notice notice-bad small">{error}</div>}
    </div>
  );
}
