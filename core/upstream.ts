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

/** The newest Mack release and the upstream commit it is aligned with. */
export type MackRelease = { version: string; baseline: string; url: string };

export type UpstreamReport =
  | { kind: "current"; baseline: string; head: string; checkedAt: number; release?: MackRelease }
  | {
      kind: "changed";
      /** A newer Mack release that is aligned with a later upstream commit than this installation: updating Mack ports these changes. */
      release?: MackRelease;
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

export const MACK_REPO = "JorgeOchoaReyes/Mack";

/** Compare dotted versions: positive when `a` is newer. */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(/[.-]/).map((x) => Number(x) || 0);
  const pb = b.replace(/^v/, "").split(/[.-]/).map((x) => Number(x) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

/**
 * The latest Mack release, when it is newer than `installed` and aligned with
 * a different upstream commit: the `upstream.json` at that release's tag.
 */
export async function newerMackRelease(installed: string, fetchImpl: typeof fetch = fetch): Promise<MackRelease | undefined> {
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "mack-app" };
  try {
    const r = await fetchImpl(`https://api.github.com/repos/${MACK_REPO}/releases/latest`, { headers });
    if (!r.ok) return undefined;
    const rel = (await r.json()) as { tag_name?: string; html_url?: string };
    if (!rel.tag_name || compareVersions(rel.tag_name, installed) <= 0) return undefined;
    const u = await fetchImpl(`https://raw.githubusercontent.com/${MACK_REPO}/${rel.tag_name}/upstream.json`, { headers: { "User-Agent": "mack-app" } });
    if (!u.ok) return undefined;
    const baseline = ((await u.json()) as { baseline?: string }).baseline;
    if (!baseline || baseline === UPSTREAM.baseline) return undefined;
    return { version: rel.tag_name.replace(/^v/, ""), baseline, url: rel.html_url ?? `https://github.com/${MACK_REPO}/releases/tag/${rel.tag_name}` };
  } catch {
    return undefined;
  }
}

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
