// Checks Open Math Harness for changes to the methodology Mack follows
// (its Lean rules, verification, proof search, Ultramath, prompts, memory)
// since the upstream commit Mack was last aligned with. `upstream.json` is
// the one source of that commit; bump it when a change has been ported.
// The check only reports: it never changes Mack's code or behaviour.

import upstream from "../upstream.json";

export type UpstreamChange = { path: string; status: string };

export type UpstreamReport =
  | { kind: "current"; baseline: string; head: string }
  | { kind: "changed"; baseline: string; head: string; commits: number; files: UpstreamChange[]; compareUrl: string }
  | { kind: "error"; message: string };

export const UPSTREAM = upstream;

export function isWatched(path: string): boolean {
  return upstream.watched.some((w) => (w.endsWith("/") ? path.startsWith(w) : path === w));
}

export async function checkUpstream(fetchImpl: typeof fetch = fetch): Promise<UpstreamReport> {
  const api = `https://api.github.com/repos/${upstream.repo}/compare/${upstream.baseline}...${upstream.branch}`;
  try {
    const res = await fetchImpl(api, { headers: { Accept: "application/vnd.github+json", "User-Agent": "mack-app" } });
    if (!res.ok) return { kind: "error", message: `GitHub returned ${res.status}` };
    const json = (await res.json()) as {
      ahead_by?: number;
      commits?: { sha: string }[];
      files?: { filename: string; status: string }[];
    };
    const head = json.commits?.at(-1)?.sha ?? upstream.baseline;
    const files = (json.files ?? []).filter((f) => isWatched(f.filename)).map((f) => ({ path: f.filename, status: f.status }));
    if (files.length === 0) return { kind: "current", baseline: upstream.baseline, head };
    return {
      kind: "changed",
      baseline: upstream.baseline,
      head,
      commits: json.ahead_by ?? 0,
      files,
      compareUrl: `https://github.com/${upstream.repo}/compare/${upstream.baseline.slice(0, 12)}...${head.slice(0, 12)}`,
    };
  } catch (e) {
    return { kind: "error", message: (e as Error).message };
  }
}
