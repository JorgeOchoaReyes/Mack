// The secret scan, rules version 1, ported from open-math-harness
// `program-files/publish/src/rules.rs` and `scan.rs` (Apache-2.0): what in a
// text looks like a secret. Upstream scans a session's records before the
// platform shows them; Mack has no platform, so it scans a chat's records
// for the person (a mark on a message that holds a finding), masks findings
// before a session reaches memory extraction, and masks them in an exported
// chat.
//
// The rules look for shapes. They miss a secret with no known shape, one
// that is encoded or split, anything in an image or a PDF, and what is
// private without being a credential; and they flag a value that only looks
// like one. No rule matches a bare hexadecimal string, a UUID, a commit id or
// a checksum. A finding says where, never what: its preview masks the secret.

export type SecretMatch = { rule: string; start: number; end: number };
export type Finding = { rule: string; preview: string };

const alnum = (c: string) => /[A-Za-z0-9]/.test(c);
const upperDigit = (c: string) => /[A-Z0-9]/.test(c);
const urlSafe = (c: string) => /[A-Za-z0-9_-]/.test(c);
const alnumDash = (c: string) => /[A-Za-z0-9-]/.test(c);
const alnumUnderscore = (c: string) => /[A-Za-z0-9_]/.test(c);
const blank = (c: string) => c === " " || c === "\t";

function run(t: string, from: number, ok: (c: string) => boolean, max = Infinity): number {
  let i = from;
  while (i < t.length && i - from < max && ok(t[i])) i++;
  return i;
}

function* occurrences(t: string, needle: string, fold = false): Generator<number> {
  const hay = fold ? t.toLowerCase() : t;
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + 1)) yield i;
}

const PLACEHOLDER_PARTS = ["example", "placeholder", "changeme", "change_me", "redacted", "your_", "your-", "dummy", "${", "{{", "...", "<"];
const PLACEHOLDER_WORDS = ["password", "passwd", "pass", "secret", "token", "none", "null", "true", "false", "undefined", "required", "username", "user"];

export function placeholder(value: string): boolean {
  const lower = value.slice(0, 512).toLowerCase();
  return (
    [...lower].every((c, i) => i === 0 || c === lower[i - 1]) ||
    /^[x*.\-_#]*$/.test(lower) ||
    PLACEHOLDER_PARTS.some((p) => lower.includes(p)) ||
    PLACEHOLDER_WORDS.includes(lower)
  );
}

const mixed = (v: string) => /[0-9]/.test(v) && /[A-Za-z]/.test(v);

type Shape = { rule: string; prefix: string; set: (c: string) => boolean; min: number; max: number; mixed: boolean };

const SHAPES: Shape[] = [
  { rule: "aws-access-key", prefix: "AKIA", set: upperDigit, min: 16, max: 16, mixed: false },
  { rule: "aws-access-key", prefix: "ASIA", set: upperDigit, min: 16, max: 16, mixed: false },
  ...["ghp_", "gho_", "ghu_", "ghs_", "ghr_"].map((prefix) => ({ rule: "github-token", prefix, set: alnum, min: 36, max: 255, mixed: false })),
  { rule: "github-token", prefix: "github_pat_", set: alnumUnderscore, min: 22, max: 255, mixed: true },
  { rule: "gitlab-token", prefix: "glpat-", set: urlSafe, min: 20, max: 255, mixed: false },
  { rule: "sk-key", prefix: "sk-", set: urlSafe, min: 20, max: 255, mixed: true },
  ...["xoxb-", "xoxa-", "xoxp-", "xoxr-", "xoxs-"].map((prefix) => ({ rule: "slack-token", prefix, set: alnumDash, min: 10, max: 255, mixed: true })),
  { rule: "google-api-key", prefix: "AIza", set: urlSafe, min: 35, max: 35, mixed: false },
  ...["sk_live_", "sk_test_", "rk_live_", "rk_test_"].map((prefix) => ({ rule: "stripe-key", prefix, set: alnum, min: 16, max: 255, mixed: false })),
  { rule: "huggingface-token", prefix: "hf_", set: alnum, min: 30, max: 255, mixed: false },
  { rule: "npm-token", prefix: "npm_", set: alnum, min: 36, max: 36, mixed: false },
  { rule: "pypi-token", prefix: "pypi-AgEIcHlwaS5vcmc", set: urlSafe, min: 50, max: 4096, mixed: false },
  // Mack's own: Fireworks keys.
  { rule: "fireworks-key", prefix: "fw_", set: alnum, min: 20, max: 255, mixed: true },
];

function shapes(t: string, found: SecretMatch[]) {
  for (const s of SHAPES) {
    for (const at of occurrences(t, s.prefix)) {
      const start = at + s.prefix.length;
      const end = run(t, start, s.set, s.max + 1);
      const touched = (at > 0 && alnum(t[at - 1])) || (end < t.length && alnum(t[end]));
      const v = t.slice(start, end);
      if (!touched && v.length >= s.min && v.length <= s.max && (!s.mixed || mixed(v)) && !placeholder(t.slice(at, end))) found.push({ rule: s.rule, start: at, end });
    }
  }
}

function privateKeys(t: string, found: SecretMatch[]) {
  // The next `-----END` at or after the last body looked at: the text is searched for them once in all.
  let nextEnd = 0;
  for (const at of occurrences(t, "-----BEGIN ")) {
    const label = at + 11;
    const labelEnd = run(t, label, (c) => upperDigit(c) || c === " ");
    const name = t.slice(label, labelEnd);
    if (!(name.endsWith("PRIVATE KEY") || name.endsWith("PRIVATE KEY BLOCK")) || name.length > 40 || !t.startsWith("-----", labelEnd)) continue;
    const body = labelEnd + 5;
    if (nextEnd !== -1 && nextEnd < body) nextEnd = t.indexOf("-----END", body);
    const end = nextEnd !== -1 && nextEnd - body <= 16 * 1024 ? nextEnd : Math.min(t.length, body + 256);
    const b64 = [...t.slice(body, end)].filter((c) => alnum(c) || c === "+" || c === "/" || c === "=").length;
    if (b64 >= 32 && !placeholder(t.slice(body, end))) found.push({ rule: "private-key", start: body, end });
  }
}

function webTokens(t: string, found: SecretMatch[]) {
  for (const at of occurrences(t, "eyJ")) {
    if (at > 0 && (urlSafe(t[at - 1]) || t[at - 1] === ".")) continue;
    const header = run(t, at, urlSafe);
    const payload = run(t, header + 1, urlSafe);
    const signature = run(t, payload + 1, urlSafe);
    if (t[header] === "." && t[payload] === "." && header - at >= 13 && t.startsWith("eyJ", header + 1) && payload - header > 13 && signature - payload > 10)
      found.push({ rule: "jwt", start: at, end: signature });
  }
}

const pastQuote = (t: string, at: number) => (t[at] === "\\" && (t[at + 1] === '"' || t[at + 1] === "'") ? at + 2 : t[at] === '"' || t[at] === "'" || t[at] === "`" ? at + 1 : at);
const pastBlanks = (t: string, at: number) => run(t, at, blank);

function authorization(t: string, found: SecretMatch[]) {
  const credential = (c: string) => alnum(c) || ".~_+/=-".includes(c);
  for (const at of occurrences(t, "authorization", true)) {
    let next = pastBlanks(t, pastQuote(t, at + 13));
    if (t[next] !== ":" && t[next] !== "=") continue;
    next = pastQuote(t, pastBlanks(t, next + 1));
    const scheme = ["bearer", "basic", "token"].find((s) => t.slice(next, next + s.length).toLowerCase() === s && blank(t[next + s.length] ?? ""));
    if (!scheme) continue;
    const start = pastBlanks(t, next + scheme.length);
    const end = run(t, start, credential);
    const v = t.slice(start, end);
    if ((v.length >= 20 || (v.length >= 8 && /[0-9]/.test(v))) && !placeholder(v)) found.push({ rule: "authorization-header", start, end });
  }
}

function urlCredentials(t: string, found: SecretMatch[]) {
  const scheme = (c: string) => alnum(c) || "+.-".includes(c);
  const password = (c: string) => c > " " && c !== "\u007f" && !"/@\"'<>`\\".includes(c);
  const user = (c: string) => password(c) && c !== ":";
  for (const at of occurrences(t, "://")) {
    let start = at;
    while (start > Math.max(0, at - 16) && scheme(t[start - 1])) start--;
    if (start === at || !/[A-Za-z]/.test(t[start])) continue;
    const nameEnd = run(t, at + 3, user);
    if (nameEnd === at + 3 || nameEnd - (at + 3) > 128 || t[nameEnd] !== ":") continue;
    const sStart = nameEnd + 1;
    const sEnd = run(t, sStart, password);
    const host = t[sEnd] === "@" && (alnum(t[sEnd + 1] ?? "") || t[sEnd + 1] === "[");
    const v = t.slice(sStart, sEnd);
    if (host && v.length >= 3 && v.length <= 256 && !"$%{[".includes(v[0]) && !placeholder(v)) found.push({ rule: "url-credentials", start: sStart, end: sEnd });
  }
}

const SECRET_NAMES = ["password", "passwd", "secret", "token", "api_key", "apikey", "api-key", "secret_key", "access_key", "private_key"];

function assignments(t: string, found: SecretMatch[]) {
  const name = (c: string) => alnum(c) || "_.-".includes(c);
  const bare = (c: string) => alnum(c) || "_+/~-".includes(c);
  for (const word of SECRET_NAMES) {
    for (const at of occurrences(t, word, true)) {
      const after = at + word.length;
      if (after < t.length && name(t[after])) continue;
      let next = pastBlanks(t, pastQuote(t, after));
      if (t.startsWith(":=", next) || t.startsWith("=>", next)) next += 2;
      else if (t[next] === "=" || t[next] === ":") next += 1;
      else continue;
      next = pastBlanks(t, next);
      const quoted = pastQuote(t, next);
      let s: number;
      let e: number;
      if (quoted > next) {
        const close = t.slice(next, quoted);
        const line = t.slice(quoted, Math.min(t.length, quoted + 512)).split("\n")[0];
        const len = line.indexOf(close);
        if (len === -1) continue;
        const v = line.slice(0, len);
        if (v.length < 8 || /\s/.test(v) || "$%{<".includes(v[0] ?? "")) continue;
        s = quoted;
        e = quoted + len;
      } else {
        let end = run(t, next, bare);
        end = run(t, end, (c) => c === "=", 2);
        const v = t.slice(next, end);
        const code = "(.[".includes(t[end] ?? " ") && end < t.length ? true : v.startsWith("/");
        if (v.length < 8 || !mixed(v) || code) continue;
        s = next;
        e = end;
      }
      if (!placeholder(t.slice(s, e))) found.push({ rule: "secret-assignment", start: s, end: e });
    }
  }
}

/** Every match of every rule in `text`, the secret span of each. */
export function scanText(text: string): SecretMatch[] {
  const found: SecretMatch[] = [];
  privateKeys(text, found);
  shapes(text, found);
  webTokens(text, found);
  authorization(text, found);
  urlCredentials(text, found);
  assignments(text, found);
  return found;
}

/** The text with every secret replaced by `****`. */
export function maskSecrets(text: string): string {
  const spans = scanText(text).sort((a, b) => a.start - b.start);
  let out = "";
  let at = 0;
  for (const s of spans) {
    if (s.start < at) continue;
    out += `${text.slice(at, s.start)}****`;
    at = s.end;
  }
  return out + text.slice(at);
}

/** Findings with previews: 40 characters before and 24 after, every secret masked. */
export function findings(text: string): Finding[] {
  return scanText(text).map((m) => ({
    rule: m.rule,
    preview: `${maskSecrets(text.slice(Math.max(0, m.start - 40), m.start))}****${maskSecrets(text.slice(m.end, Math.min(text.length, m.end + 24)))}`,
  }));
}
