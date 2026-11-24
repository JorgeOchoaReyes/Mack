// Lean on another machine, over SSH: a rented cloud box or a workstation with
// more memory runs the checks, and this computer only sends source text and
// reads Lean's answers. The remote needs Lean, Mathlib and (for the resident
// REPL) Mack's REPL build in its workspace, the same layout Setup makes here;
// SSH must log in without a password prompt (a key in the agent). Windows,
// macOS and Linux all ship an `ssh` client.

export type RemoteLean = { host: string; workspace: string };

let remote: RemoteLean | null = null;

/** Send every Lean run and REPL to `r` from now on; null runs Lean here. */
export function setRemoteLean(r: RemoteLean | null): void {
  remote = r && r.host.trim() && r.workspace.trim() ? { host: r.host.trim(), workspace: r.workspace.trim() } : null;
}

export function remoteLean(): RemoteLean | null {
  return remote;
}

/** A word for a POSIX shell, quoted. */
export const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** Where elan puts `lake`; a non-interactive SSH shell often has no profile that adds it. */
const PATH_FIX = 'PATH="$HOME/.elan/bin:$PATH"';

/** The ssh arguments that run `script` in the remote workspace. */
export function sshArgs(r: RemoteLean, script: string): string[] {
  return ["-T", "-o", "BatchMode=yes", "-o", "ServerAliveInterval=30", r.host, `cd ${shq(r.workspace)} && ${PATH_FIX} && ${script}`];
}

/** Lean's style linters are off for Mack's checks: they only advise, cost time, and bury the real error in warnings. */
export const LINTERS_OFF = "-Dlinter.all=false";

/** The remote script for one fresh run: the source arrives on stdin, Lean checks it within `seconds`. */
export function freshRunScript(seconds: number): string {
  return `f=$(mktemp -d)/Probe.lean && cat > "$f" && timeout ${Math.max(1, Math.ceil(seconds))} lake env lean ${LINTERS_OFF} "$f"; c=$?; rm -rf "$(dirname "$f")"; exit $c`;
}

/** The remote script that starts the resident REPL. */
export const REMOTE_REPL = "exec lake env .mack/repl/.lake/build/bin/repl";
