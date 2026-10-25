// Feedback: problems and ideas from inside Mack, filed as GitHub issues on
// Mack's repository, and the open ones listed so people can follow them.
//
// Mack never files anything itself: it opens GitHub's new-issue form in the
// browser, prefilled, and the person reviews and submits it under their own
// account. The prefilled text is the person's words plus diagnostics they can
// see before sending (app version, OS, Lean version, provider and mode) —
// never a key, a file or a transcript — and the secret scan masks anything in
// it shaped like a credential.

import { maskSecrets } from "./secrets";

export const FEEDBACK_REPO = "JorgeOchoaReyes/Mack";

export type FeedbackKind = "bug" | "idea";

export type Diagnostics = { app: string; os: string; lean: string | null; provider: string; mode: string; repl: boolean };

export function diagnosticsText(d: Diagnostics): string {
  return [`- Mack ${d.app}`, `- ${d.os}`, `- Lean: ${d.lean ?? "not installed"}${d.repl ? " (with REPL)" : ""}`, `- Provider: ${d.provider}`, `- Prove mode: ${d.mode}`].join("\n");
}

/** GitHub's new-issue form, prefilled; the body is cut to keep the URL within what browsers accept. */
export function issueUrl(kind: FeedbackKind, title: string, body: string, d: Diagnostics): string {
  const text = maskSecrets(body).slice(0, 4000);
  const full =
    kind === "bug"
      ? `### What happened\n\n${text}\n\n### What I expected\n\n\n### Steps to reproduce\n\n1. \n\n### Diagnostics\n\n${diagnosticsText(d)}\n`
      : `### The idea\n\n${text}\n\n### Why it would help\n\n\n### Diagnostics\n\n${diagnosticsText(d)}\n`;
  const q = new URLSearchParams({ title: maskSecrets(title).slice(0, 200) || (kind === "bug" ? "Problem: " : "Idea: "), body: full, labels: kind === "bug" ? "bug" : "idea" });
  return `https://github.com/${FEEDBACK_REPO}/issues/new?${q.toString()}`;
}

export type Issue = { number: number; title: string; url: string; labels: string[]; comments: number; createdAt: string; kind: FeedbackKind | "other" };

/** Open issues of the repository, newest first (pull requests excluded). */
export async function openIssues(fetchImpl: typeof fetch = fetch): Promise<Issue[]> {
  const res = await fetchImpl(`https://api.github.com/repos/${FEEDBACK_REPO}/issues?state=open&per_page=50`, { headers: { Accept: "application/vnd.github+json", "User-Agent": "mack-app" } });
  if (!res.ok) throw new Error(`GitHub returned ${res.status}`);
  const json = (await res.json()) as { number: number; title: string; html_url: string; labels: { name: string }[]; comments: number; created_at: string; pull_request?: unknown }[];
  return json
    .filter((i) => !i.pull_request)
    .map((i) => {
      const labels = i.labels.map((l) => l.name);
      return { number: i.number, title: i.title, url: i.html_url, labels, comments: i.comments, createdAt: i.created_at, kind: labels.includes("bug") ? "bug" : labels.includes("idea") || labels.includes("enhancement") ? "idea" : "other" };
    });
}
