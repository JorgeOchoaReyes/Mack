// Share a proved result with the Mack community: shows exactly what would be
// published and where, and opens the pull request only when the person says so.

import { ExternalLink, GitPullRequest, Users, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type CommunityPreview, type Proved } from "../api";
import { CodeEditor } from "./CodeEditor";
import { Button } from "./ui";

export function ShareProofDialog({ projectId, proved, onClose }: { projectId: string; proved: Proved; onClose: () => void }) {
  const [preview, setPreview] = useState<CommunityPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<{ url: string; slug: string } | null>(null);

  useEffect(() => {
    let live = true;
    api
      .communityPreview(projectId, proved.file)
      .then((p) => live && setPreview(p))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [projectId, proved.file]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && !sending && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose, sending]);

  const share = async () => {
    setSending(true);
    setError(null);
    try {
      setDone(await api.communityShare(projectId, proved.file));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="path-overlay" role="dialog" aria-modal="true" aria-label="Share with the community" onClick={() => !sending && onClose()}>
      <div className="path-card share-card" onClick={(e) => e.stopPropagation()}>
        <div className="path-head">
          <Users size={16} className="accent" />
          <div className="path-head-text">
            <div className="path-title">
              Share <code>{proved.theorem ?? proved.file}</code> with the community
            </div>
            <div className="muted small">Opens a pull request that adds this result to the community proofs, so other people can find it, read it and build on it.</div>
          </div>
          <button className="icon-btn" title="Close (Esc)" onClick={onClose} disabled={sending}>
            <X size={15} />
          </button>
        </div>

        {error && <div className="bad small">{error}</div>}

        {done ? (
          <div className="share-done">
            <GitPullRequest size={16} className="ok" />
            <div>
              <div>
                Pull request opened. It adds <code>{done.slug}</code>.
              </div>
              <div className="muted small">The repo's check now builds your proof against Mathlib and runs the strict verifier again. A maintainer merges it once that check passes.</div>
            </div>
            <Button size="sm" icon={ExternalLink} onClick={() => void api.openExternal(done.url)}>
              Open on GitHub
            </Button>
          </div>
        ) : (
          preview && (
            <>
              <ul className="share-facts small">
                <li>
                  <b>Where:</b> <code>{preview.repo}</code>, folder <code>{`${preview.dir}/${preview.slug}/`}</code> (a number is added if that name is taken)
                </li>
                <li>
                  <b>From:</b> your GitHub account. If you don't own the repo, Mack forks it to your account first.
                </li>
                <li>
                  <b>What:</b> the statement and proof below, a short README, and the problem's name <i>(not your chats or notes)</i>.
                </li>
              </ul>
              <div className="share-code">
                <div>
                  <div className="plan-detail-label">Statement.lean</div>
                  <div className="code-frame path-code">
                    <CodeEditor value={preview.statement} readOnly />
                  </div>
                </div>
                <div>
                  <div className="plan-detail-label">Proof.lean</div>
                  <div className="code-frame path-code">
                    <CodeEditor value={preview.proof} readOnly />
                  </div>
                </div>
              </div>
              <div className="path-foot">
                <Button variant="primary" icon={GitPullRequest} loading={sending} onClick={() => void share()}>
                  Open the pull request
                </Button>
                <Button variant="ghost" onClick={onClose} disabled={sending}>
                  Cancel
                </Button>
              </div>
            </>
          )
        )}
        {!preview && !error && <div className="muted small">Preparing…</div>}
      </div>
    </div>
  );
}
