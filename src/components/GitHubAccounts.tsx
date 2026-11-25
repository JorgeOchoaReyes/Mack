// The GitHub accounts Mack can publish from, and the one it uses: shared
// benchmark runs, community proofs and project pull requests go out under the
// chosen account. Accounts come from pasted tokens, or the GitHub CLI's
// logins. `compact` is the picker inside a share
// dialog; the full form is Settings → GitHub.

import { Check, ExternalLink, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api, errorText, type GitHubStatus } from "../api";
import { Button } from "./ui";

const SOURCE = { mack: "token saved in Mack", gh: "GitHub CLI login" } as const;

/** GitHub's form for a new classic token, with Mack's name and the `repo` scope already filled in. */
export const NEW_TOKEN_URL = "https://github.com/settings/tokens/new?scopes=repo&description=Mack";
const TOKEN_DOCS = "https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#creating-a-personal-access-token-classic";

/** How to make a token, step by step: open when no account is connected yet. */
function TokenGuide({ open }: { open: boolean }) {
  return (
    <details className="gh-guide" open={open}>
      <summary>How to create a token (about a minute)</summary>
      <ol>
        <li>
          On github.com, sign in as the account Mack should publish as. For a second account, switch to it on GitHub first (your avatar → <i>Switch account</i>).
        </li>
        <li>
          <Button size="sm" icon={ExternalLink} onClick={() => void api.openExternal(NEW_TOKEN_URL)}>
            Open GitHub&apos;s token page
          </Button>{" "}
          The name (<code>Mack</code>) and the <code>repo</code> scope are already filled in.
        </li>
        <li>
          Pick an <b>Expiration</b> (90 days is a good choice; when it runs out, add a new token here), scroll down and click <b>Generate token</b>.
        </li>
        <li>
          Copy the token (it starts with <code>ghp_</code>; GitHub shows it only once), paste it below and click <b>Add account</b>.
        </li>
      </ol>
      <p className="muted small">
        Why <code>repo</code>: Mack forks the Mack repository and opens pull requests from your fork (shared runs, community proofs), and creates private repositories for your
        projects. The token is stored encrypted on this computer and only sent to GitHub.{" "}
        <button className="link small" onClick={() => void api.openExternal(TOKEN_DOCS)}>
          GitHub&apos;s guide to tokens <ExternalLink size={11} />
        </button>
      </p>
    </details>
  );
}

export function GitHubAccounts({ compact = false, onChange, onGoSettings }: { compact?: boolean; onChange?: (s: GitHubStatus) => void; onGoSettings?: () => void }) {
  const [status, setStatus] = useState<GitHubStatus | null>(null);
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const update = (s: GitHubStatus) => {
    setStatus(s);
    onChange?.(s);
  };
  useEffect(() => {
    void api.githubStatus().then(update);
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
  if (!status) return <p className="muted small">Looking for GitHub accounts…</p>;
  const accounts = status.accounts;
  const active = status.source === "env" ? undefined : status.login;

  if (compact) {
    return (
      <div className="gh-pick">
        {status.source === "env" ? (
          <span className="small">
            Publishing as <b>{status.login ?? "the GITHUB_TOKEN account"}</b> (from GITHUB_TOKEN in the environment).
          </span>
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
            <button className="link small" onClick={() => void api.openExternal(NEW_TOKEN_URL)}>
              Create a token <ExternalLink size={11} />
            </button>{" "}
            (name and scope are filled in), then{" "}
            {onGoSettings && (
              <button className="link small" onClick={onGoSettings}>
                add it in Settings → GitHub
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
          GITHUB_TOKEN is set in the environment
          {status.login ? ` (@${status.login})` : ""}, so Mack publishes with it whatever account is chosen below.
        </div>
      )}
      {status.error && (
        <div className="notice notice-bad">
          GitHub refused the token for {status.login ? `@${status.login}` : "the chosen account"}: {status.error}
        </div>
      )}
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
      <p className="muted small">
        {accounts.length ? "Add another account: paste" : "Paste"} a GitHub token (a classic token with the <code>repo</code> scope). Accounts you are logged in to with the GitHub
        CLI (<code>gh auth login</code>) show here too.
      </p>
      <TokenGuide open={!accounts.length} />
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
      {error && <div className="notice notice-bad">{error}</div>}
    </div>
  );
}
