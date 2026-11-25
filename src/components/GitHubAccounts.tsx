// The GitHub accounts Mack can publish from, and the one it uses: shared
// benchmark runs, community proofs and project pull requests go out under the
// chosen account. Accounts come from signing in through the browser, a pasted
// token, or the GitHub CLI's logins. `compact` is the picker inside a share
// dialog; the full form is Settings → GitHub.

import { Check, ExternalLink, LogIn, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api, errorText, type GitHubStatus } from "../api";
import { Button } from "./ui";

const SOURCE = { mack: "signed in through Mack", gh: "GitHub CLI login" } as const;

export function GitHubAccounts({ compact = false, onChange, onGoSettings }: { compact?: boolean; onChange?: (s: GitHubStatus) => void; onGoSettings?: () => void }) {
  const [status, setStatus] = useState<GitHubStatus | null>(null);
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [signIn, setSignIn] = useState<{ userCode: string; verificationUri: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const update = (s: GitHubStatus) => {
    setStatus(s);
    onChange?.(s);
  };
  useEffect(() => {
    void api.githubStatus().then(update);
    return () => void api.githubSignInCancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const act = async (f: () => Promise<GitHubStatus>) => {
    setError("");
    setBusy(true);
    try {
      update(await f());
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const startSignIn = async () => {
    setError("");
    try {
      const s = await api.githubSignInStart();
      setSignIn(s);
      setCopied(false);
      update(await api.githubSignInWait());
    } catch (e) {
      if (!/cancelled/i.test(errorText(e))) setError(errorText(e));
    } finally {
      setSignIn(null);
    }
  };

  if (!status) return <p className="muted small">Looking for GitHub accounts…</p>;
  const accounts = status.accounts;
  const active = status.source === "env" ? undefined : status.login;

  if (compact) {
    return (
      <div className="gh-pick">
        {status.source === "env" ? (
          <span className="small">Publishing as <b>{status.login ?? "the GITHUB_TOKEN account"}</b> (from GITHUB_TOKEN in the environment).</span>
        ) : accounts.length ? (
          <label className="row gap-sm small">
            Publish as
            <select className="input input-sm" value={active ?? ""} disabled={busy} onChange={(e) => void act(() => api.githubUse(e.target.value))}>
              {accounts.map((a) => (
                <option key={a.login} value={a.login}>
                  @{a.login} ({SOURCE[a.source]})
                </option>
              ))}
            </select>
            {onGoSettings && (
              <button className="link small" onClick={onGoSettings}>
                Add an account
              </button>
            )}
          </label>
        ) : (
          <span className="small">
            No GitHub account is connected.{" "}
            {onGoSettings && (
              <button className="link small" onClick={onGoSettings}>
                Connect one in Settings → GitHub
              </button>
            )}
          </span>
        )}
        {error && <div className="notice notice-bad">{error}</div>}
      </div>
    );
  }

  return (
    <div className="gh-accounts">
      {status.source === "env" && (
        <div className="notice">
          GITHUB_TOKEN is set in the environment{status.login ? ` (@${status.login})` : ""}, so Mack publishes with it whatever account is chosen below.
        </div>
      )}
      {status.error && <div className="notice notice-bad">GitHub refused the token for {status.login ? `@${status.login}` : "the chosen account"}: {status.error}</div>}
      {accounts.length > 0 && (
        <ul className="gh-list">
          {accounts.map((a) => {
            const chosen = a.login === active;
            return (
              <li key={a.login} className={chosen ? "chosen" : ""}>
                <img src={`https://github.com/${encodeURIComponent(a.login)}.png?size=64`} alt="" width={28} height={28} />
                <div className="grow">
                  <b>@{a.login}</b>
                  <div className="muted small">{SOURCE[a.source]}</div>
                </div>
                {chosen ? (
                  <span className="badge badge-ok">
                    <Check size={11} /> Publishing as
                  </span>
                ) : (
                  <Button disabled={busy} onClick={() => void act(() => api.githubUse(a.login))}>
                    Use this account
                  </Button>
                )}
                {a.source === "mack" ? (
                  <button className="icon-btn" title={`Disconnect @${a.login} from Mack`} disabled={busy} onClick={() => void act(() => api.githubRemove(a.login))}>
                    <Trash2 size={13} />
                  </button>
                ) : (
                  <span className="muted small" title="Log it out with: gh auth logout --user …">
                    via gh
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {signIn ? (
        <div className="gh-signin">
          <p className="small">
            GitHub opened in your browser. Enter this code there and approve Mack:
          </p>
          <div className="row gap-sm">
            <code className="gh-code">{signIn.userCode}</code>
            <Button
              onClick={() => {
                void navigator.clipboard?.writeText(signIn.userCode);
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy code"}
            </Button>
            <button className="link small" onClick={() => void api.openExternal(signIn.verificationUri)}>
              Open the page again <ExternalLink size={11} />
            </button>
            <button className="link small" onClick={() => void api.githubSignInCancel()}>
              Cancel
            </button>
          </div>
          <p className="muted small">Waiting for you to approve it… Sign in to GitHub as the account you want first; to add another account, sign out on github.com and do this again.</p>
        </div>
      ) : (
        <>
          {status.signIn && (
            <div className="row gap-sm">
              <Button variant="primary" icon={LogIn} onClick={() => void startSignIn()}>
                {accounts.length ? "Sign in with another GitHub account" : "Sign in with GitHub"}
              </Button>
            </div>
          )}
          <p className="muted small">
            {status.signIn ? "Or paste" : "Paste"} a token with access to create repositories and pull requests (a classic token with the <code>repo</code> scope), or log in with the GitHub CLI (
            <code>gh auth login</code>; every account it is logged in to shows here).{" "}
            <button className="link small" onClick={() => void api.openExternal("https://github.com/settings/tokens/new?scopes=repo&description=Mack")}>
              Create a token <ExternalLink size={11} />
            </button>
          </p>
          <form
            className="row gap-sm"
            onSubmit={(e) => {
              e.preventDefault();
              void act(() => api.githubSetToken(token)).then(() => setToken(""));
            }}
          >
            <input className="input grow mono" type="password" placeholder="ghp_…" value={token} onChange={(e) => setToken(e.target.value)} />
            <Button type="submit" disabled={!token.trim() || busy}>
              Add account
            </Button>
          </form>
        </>
      )}
      {error && <div className="notice notice-bad">{error}</div>}
    </div>
  );
}
