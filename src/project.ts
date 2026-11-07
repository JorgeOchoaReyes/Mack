// The active project's .lean files, kept current as anything writes them
// (the chat's agent, a command, another editor), and which of them the person
// has not looked at since they last changed.

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type ProjectFiles } from "./api";

export type LeanFile = { path: string; mtime: number; fresh: boolean };

const seenKey = (projectId: string) => `mack.seenLean.${projectId}`;

function loadSeen(projectId: string): Record<string, number> | null {
  try {
    const raw = localStorage.getItem(seenKey(projectId));
    return raw ? (JSON.parse(raw) as Record<string, number>) : null;
  } catch {
    return null;
  }
}

function saveSeen(projectId: string, seen: Record<string, number>): void {
  try {
    localStorage.setItem(seenKey(projectId), JSON.stringify(seen));
  } catch {
    // Forgetting what was seen only marks files new again.
  }
}

export function useProjectFiles(projectId: string) {
  const [listing, setListing] = useState<ProjectFiles | null>(null);
  const [seen, setSeen] = useState<Record<string, number>>({});
  const current = useRef(projectId);
  current.current = projectId;

  const refresh = useCallback(async () => {
    if (!projectId) return setListing(null);
    try {
      const l = await api.projectLeanFiles(projectId);
      if (current.current !== projectId) return;
      let s = loadSeen(projectId);
      if (!s) {
        // The first listing of a project: what is already there is not news.
        s = Object.fromEntries(l.files.map((f) => [f.path, Date.now()]));
        saveSeen(projectId, s);
      }
      setSeen(s);
      setListing(l);
    } catch {
      if (current.current === projectId) setListing(null);
    }
  }, [projectId]);

  useEffect(() => {
    setListing(null);
    void refresh();
    void api.watchProject(projectId).catch(() => {});
    const off = api.onProjectFiles((id) => id === projectId && void refresh());
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      off();
      window.removeEventListener("focus", onFocus);
    };
  }, [projectId, refresh]);

  const markSeen = useCallback(
    (path?: string) => {
      if (!projectId) return;
      setSeen((prev) => {
        const next = { ...prev };
        for (const f of path ? [path] : (listing?.files.map((x) => x.path) ?? [])) next[f] = Date.now();
        saveSeen(projectId, next);
        return next;
      });
    },
    [projectId, listing],
  );

  const files: LeanFile[] = (listing?.files ?? []).map((f) => ({ ...f, fresh: !(f.path in seen) || f.mtime > seen[f.path] }));
  return { folder: listing?.folder ?? "", files, fresh: files.filter((f) => f.fresh).length, refresh, markSeen };
}

export type ProjectFilesState = ReturnType<typeof useProjectFiles>;
