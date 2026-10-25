// Checks Open Math Harness for changes to the methodology Mack follows
// (its Lean rules, verification, proof search, Ultramath, prompts, memory)
// since the upstream commit Mack was last aligned with. `upstream.json` is
// the one source of that commit and of which upstream path maps to which
// Mack module; `npm run upstream -- --accept` moves the baseline once a
// change has been ported. The check only reports: it never changes Mack's
// code or behaviour.

import upstream from "../upstream.json";

export type Watched = { path: string; area: string; mack: string };

export type UpstreamChange = { path: string; status: string; area: string; mack: string; url: string };

export type UpstreamCommit = { sha: string; message: string; date: string; url: string; touchesWatched: boolean };

export type UpstreamReport =
  | { kind: "current"; baseline: string; head: string; checkedAt: number }
  | {
      kind: "changed";
      baseline: string;
      head: string;
      checkedAt: number;
      commits: number;
      recent: UpstreamCommit[];
      files: UpstreamChange[];
      compareUrl: string;
    }
  | { kind: "error"; message: string; checkedAt: number };

export const UPSTREAM = upstream as { repo: string; branch: string; baseline: string; watched: Watched[] };

/** The watched entry a path falls under, if any. */
export function watchedFor(path: string): Watched | undefined {
  return UPSTREAM.watched.find((w) => (w.path.endsWith("/") ? path.startsWith(w.path) : path === w.path));
}

export function isWatched(path: string): boolean {
  return watchedFor(path) !== undefined;
}

type CompareJson = {
  ahead_by?: number;
  html_url?: string;
  commits?: { sha: string; html_url?: string; commit?: { message?: string; author?: { date?: string } } }[];
  files?: { filename: string; status: string; blob_url?: string }[];
};

type CommitJson = { files?: { filename: string }[] };

export async function checkUpstream(fetchImpl: typeof fetch = fetch): Promise<UpstreamReport> {
  const checkedAt = Date.now();
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "mack-app" };
  const api = `https://api.github.com/repos/${UPSTREAM.repo}/compare/${UPSTREAM.baseline}...${UPSTREAM.branch}`;
  try {
    const res = await fetchImpl(api, { headers });
    if (!res.ok) return { kind: "error", message: `GitHub returned ${res.status}`, checkedAt };
    const json = (await res.json()) as CompareJson;
    const commits = json.commits ?? [];
    const head = commits.at(-1)?.sha ?? UPSTREAM.baseline;
    const files: UpstreamChange[] = (json.files ?? []).flatMap((f) => {
      const w = watchedFor(f.filename);
      return w
        ? [{ path: f.filename, status: f.status, area: w.area, mack: w.mack, url: f.blob_url ?? `https://github.com/${UPSTREAM.repo}/blob/${head}/${f.filename}` }]
        : [];
    });
    if (files.length === 0) return { kind: "current", baseline: UPSTREAM.baseline, head, checkedAt };
    // Which of the newest commits touch watched paths: one request each, at most 10.
    const newest = commits.slice(-10).reverse();
    const recent = await Promise.all(
      newest.map(async (c): Promise<UpstreamCommit> => {
        let touchesWatched = false;
        try {
          const r = await fetchImpl(`https://api.github.com/repos/${UPSTREAM.repo}/commits/${c.sha}`, { headers });
          if (r.ok) touchesWatched = ((await r.json()) as CommitJson).files?.some((f) => isWatched(f.filename)) ?? false;
        } catch {
          // Unknown is shown as not touching; the file list above is authoritative.
        }
        return {
          sha: c.sha,
          message: (c.commit?.message ?? "").split("\n")[0],
          date: c.commit?.author?.date ?? "",
          url: c.html_url ?? `https://github.com/${UPSTREAM.repo}/commit/${c.sha}`,
          touchesWatched,
        };
      }),
    );
    return {
      kind: "changed",
      baseline: UPSTREAM.baseline,
      head,
      checkedAt,
      commits: json.ahead_by ?? commits.length,
      recent,
      files,
      compareUrl: `https://github.com/${UPSTREAM.repo}/compare/${UPSTREAM.baseline.slice(0, 12)}...${head.slice(0, 12)}`,
    };
  } catch (e) {
    return { kind: "error", message: (e as Error).message, checkedAt };
  }
}
