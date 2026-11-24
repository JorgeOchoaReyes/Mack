// A searchable index of Mathlib's declarations, built from the Mathlib source
// in the person's Lean workspace, the way Open Math Harness gives its agents a
// Mathlib reference (`/opt/nucleus/docs/decls-full.tsv`: name, kind, module,
// type, documentation). A model that guesses a lemma's name is a common way
// for a Lean attempt to fail; one that looks the name up is not. The index is
// read from source text, not elaborated, so a signature is the source as
// written (with its implicit arguments) and a miss does not prove a name is
// absent: Lean decides.

import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";

export type Decl = { name: string; kind: string; sig: string; module: string; doc?: string };

const DECL = /^(?:@\[[^\]]*\]\s*)*(?:(?:private|protected|noncomputable|nonrec|partial|unsafe)\s+)*(theorem|lemma|def|abbrev|structure|class|inductive)\s+([^\s:({[⦃]+)(.*)$/;
const MAX_SIG = 400;
const MAX_DOC = 240;

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** The declarations of one Lean source file: full names (with their namespaces), statements up to `:=` or `where`, and doc comments. */
export function parseDecls(source: string, module: string): Decl[] {
  const lines = source.split(/\r?\n/);
  const out: Decl[] = [];
  const scopes: { ns: string | null }[] = [];
  let doc: string | undefined;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trimStart();
    // Doc comments belong to the next declaration; other block comments are skipped.
    if (t.startsWith("/-")) {
      const isDoc = t.startsWith("/--") && !t.startsWith("/--!");
      let text = t;
      while (!text.includes("-/") && i + 1 < lines.length) text += `\n${lines[++i]}`;
      if (isDoc) doc = squash(text.replace(/^\/--/, "").replace(/-\/[\s\S]*$/, "")).slice(0, MAX_DOC);
      continue;
    }
    if (t.startsWith("--") || !t) continue;
    const ns = /^namespace\s+(\S+)/.exec(t);
    if (ns) {
      scopes.push({ ns: ns[1] });
      continue;
    }
    if (/^(noncomputable\s+)?section\b/.test(t)) {
      scopes.push({ ns: null });
      continue;
    }
    if (/^end\b/.test(t)) {
      scopes.pop();
      continue;
    }
    const m = DECL.exec(t);
    if (!m) {
      if (!t.startsWith("@[")) doc = undefined;
      continue;
    }
    const [, kind, rawName, rest] = m;
    // The statement runs on until `:=`, `where` or the start of a match arm.
    let sig = rest;
    for (let j = i + 1; j < lines.length && j < i + 14 && !/:=|\bwhere\b/.test(sig); j++) {
      const next = lines[j];
      if (/^\s*(theorem|lemma|def|@\[|\/-|namespace|end\b|\|)/.test(next)) break;
      sig += ` ${next}`;
    }
    sig = squash(sig.split(/:=|\bwhere\b/)[0]);
    const prefix = scopes
      .map((s) => s.ns)
      .filter((x): x is string => !!x)
      .join(".");
    const name = rawName.startsWith("_root_.") ? rawName.slice(7) : prefix ? `${prefix}.${rawName}` : rawName;
    // Names a macro writes (`$typeName.foo`) are not names anyone can use.
    if (name.includes("$")) {
      doc = undefined;
      continue;
    }
    out.push({ name, kind: kind === "lemma" ? "theorem" : kind, sig: sig.slice(0, MAX_SIG), module, ...(doc ? { doc } : {}) });
    doc = undefined;
  }
  return out;
}

/** The words of a name or query: `Nat.Prime.two_le` → nat, prime, two, le. */
export function words(s: string): string[] {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9α-ωℕℤℚℝℂ∑∏√≤≥≠∣]+/)
    .filter(Boolean);
}

/**
 * The declarations that match every word of the query (in the name, the
 * statement or the doc comment), best first: name matches count most, an exact
 * name or name component more, and a shorter name breaks ties.
 */
export function searchDecls(decls: Decl[], query: string, limit = 20): Decl[] {
  const q = query.trim();
  if (!q) return [];
  const exact = decls.filter((d) => d.name === q || d.name.endsWith(`.${q}`));
  const terms = q.includes(" ") || !/[._]/.test(q) ? q.toLowerCase().split(/\s+/) : words(q);
  const scored: { d: Decl; s: number }[] = [];
  for (const d of decls) {
    const name = d.name.toLowerCase();
    const parts = new Set(words(d.name));
    const sig = d.sig.toLowerCase();
    const doc = d.doc?.toLowerCase() ?? "";
    let s = 0;
    let all = true;
    for (const w of terms) {
      if (parts.has(w)) s += 5;
      else if (name.includes(w)) s += 3;
      else if (sig.includes(w)) s += 1.5;
      else if (doc.includes(w)) s += 1;
      else {
        all = false;
        break;
      }
    }
    if (all) scored.push({ d, s: s - d.name.length / 200 + (d.kind === "theorem" ? 0.5 : 0) });
  }
  scored.sort((a, b) => b.s - a.s);
  const seen = new Set(exact.map((d) => d.name));
  return [...exact, ...scored.map((x) => x.d).filter((d) => !seen.has(d.name))].slice(0, limit);
}

/** Real names close to one Lean did not know: same words, the same namespace first. */
export function similarNames(decls: Decl[], unknown: string, limit = 6): Decl[] {
  const ws = words(unknown);
  if (!ws.length) return [];
  const ns = unknown.includes(".") ? unknown.slice(0, unknown.lastIndexOf(".")).toLowerCase() : "";
  const scored: { d: Decl; s: number }[] = [];
  for (const d of decls) {
    const parts = new Set(words(d.name));
    let s = 0;
    for (const w of ws) if (parts.has(w)) s += 1;
    if (s < Math.max(1, Math.ceil(ws.length * 0.6))) continue;
    if (ns && d.name.toLowerCase().startsWith(`${ns}.`)) s += 1.5;
    scored.push({ d, s: s - d.name.length / 300 });
  }
  return scored
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.d);
}

/**
 * The one real Mathlib name an unknown name almost certainly meant, or null
 * when there is no single clear one: the same last component in another
 * namespace (`Nat.pow_le_pow_left` for `pow_le_pow_left`, or the reverse), or
 * the same name up to case and underscores. A guess, not a fact: the caller
 * keeps it only when Lean then reports fewer errors.
 */
export function renameFor(decls: Decl[], unknown: string): string | null {
  const parts = unknown.split(".");
  const last = parts[parts.length - 1];
  if (!last || decls.some((d) => d.name === unknown)) return null;
  const head = parts.length > 1 ? parts[0] : "";
  const pick = (cands: Decl[]): string | null => {
    const names = [...new Set(cands.map((d) => d.name))].filter((n) => n !== unknown);
    if (names.length === 1) return names[0];
    const same = head ? names.filter((n) => n.startsWith(`${head}.`)) : names.filter((n) => !n.includes("."));
    return same.length === 1 ? same[0] : null;
  };
  const sameLast = pick(decls.filter((d) => d.name === last || d.name.endsWith(`.${last}`)));
  if (sameLast) return sameLast;
  const norm = (s: string) => s.toLowerCase().replace(/_/g, "");
  const ns = parts.slice(0, -1).join(".");
  return pick(decls.filter((d) => norm(d.name) === norm(unknown) || (ns && d.name.startsWith(`${ns}.`) && norm(d.name.slice(ns.length + 1)) === norm(last))));
}

/** `source` with each name of `renames` replaced where it stands as a whole identifier. */
export function applyRenames(source: string, renames: Record<string, string>): string {
  let out = source;
  for (const [from, to] of Object.entries(renames)) {
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}_'.!?])${escaped}(?![\\p{L}\\p{N}_'!?])`, "gu"), to);
  }
  return out;
}

/** For each name Lean did not know, the real Mathlib names closest to it, as a note for the next attempt; empty when there is nothing to say. */
export function nameHints(decls: Decl[], names: string[]): string {
  const lines = names
    .map((n) => {
      const close = similarNames(decls, n, 5);
      return close.length ? `- \`${n}\` is not a Mathlib name. Close ones: ${close.map((d) => `\`${d.name}\` : ${d.sig.slice(0, 140)}`).join("; ")}` : "";
    })
    .filter(Boolean);
  return lines.length ? `Names Lean did not know, with the closest real ones in Mathlib (check a type with #check before using it):\n${lines.join("\n")}` : "";
}

/** Search results as the model reads them. */
export function describeDecls(found: Decl[], query: string): string {
  if (!found.length) return `Nothing in Mathlib matches "${query}". Try fewer or other words (an index miss does not prove a name is absent: \`#check\` it with check_lean).`;
  return `${found.map((d) => `${d.name} (${d.kind}, ${d.module})\n  ${d.sig}${d.doc ? `\n  -- ${d.doc}` : ""}`).join("\n")}\n\nThese are read from Mathlib's source: confirm a name and its exact type with \`#check\` in check_lean before relying on it.`;
}

/** The names Lean reported unknown in a check's output. */
export function unknownNames(output: string): string[] {
  const out = new Set<string>();
  for (const m of output.matchAll(/unknown (?:identifier|constant)\s+['`]([^'`]+)['`]/gi)) out.add(m[1]);
  return [...out].slice(0, 5);
}

async function leanFiles(dir: string, out: string[] = []): Promise<string[]> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) await leanFiles(full, out);
    else if (e.name.endsWith(".lean")) out.push(full);
  }
  return out;
}

/** Where a workspace keeps Mathlib's source, or undefined when it has none. */
export function mathlibSource(workspace: string): string | undefined {
  const root = join(workspace, ".lake", "packages", "mathlib");
  return existsSync(join(root, "Mathlib")) ? root : undefined;
}

/** The Mathlib commit a workspace's lake-manifest.json pins, or undefined. */
export function mathlibRev(workspace: string): string | undefined {
  try {
    const m = JSON.parse(readFileSync(join(workspace, "lake-manifest.json"), "utf8")) as { packages?: { name?: string; rev?: string }[] };
    const rev = m.packages?.find((p) => p.name === "mathlib")?.rev;
    return rev && /^[0-9a-f]{7,40}$/.test(rev) ? rev : undefined;
  } catch {
    return undefined;
  }
}

/** What identifies the installed Mathlib: its commit in the manifest, else the folder's time. */
function versionOf(workspace: string, root: string): string {
  return mathlibRev(workspace) ?? String(statSync(join(root, "Mathlib")).mtimeMs);
}

/** The index of one workspace's Mathlib: built once per Mathlib version and kept in `cacheFile`. */
export class MathlibIndex {
  private decls: Decl[] | null = null;
  private loading: Promise<Decl[]> | null = null;

  constructor(
    private readonly workspace: string,
    private readonly cacheFile: string,
  ) {}

  load(): Promise<Decl[]> {
    if (this.decls) return Promise.resolve(this.decls);
    this.loading ??= this.build().then((d) => (this.decls = d));
    return this.loading;
  }

  private async build(): Promise<Decl[]> {
    const root = mathlibSource(this.workspace);
    if (!root) throw new Error("Mathlib's source is not in the Lean workspace; install Lean and Mathlib in Setup first");
    const version = versionOf(this.workspace, root);
    try {
      const cached = JSON.parse(await readFile(this.cacheFile, "utf8")) as { version: string; decls: Decl[] };
      if (cached.version === version && Array.isArray(cached.decls)) return cached.decls;
    } catch {
      // No cache yet, or an unreadable one: build it.
    }
    const decls: Decl[] = [];
    for (const file of await leanFiles(join(root, "Mathlib"))) {
      const module = relative(root, file).replace(/\.lean$/, "").split(sep).join(".");
      decls.push(...parseDecls(await readFile(file, "utf8"), module));
    }
    await mkdir(dirname(this.cacheFile), { recursive: true });
    await writeFile(this.cacheFile, JSON.stringify({ version, decls }), "utf8");
    return decls;
  }
}

/** Notation that names a Mathlib concept without spelling it. */
const NOTATION: [RegExp, string][] = [
  [/√/, "sqrt"],
  [/∑/, "sum"],
  [/∏/, "prod"],
  [/∣/, "dvd"],
  [/%/, "mod"],
  [/⌊/, "floor"],
  [/⌈/, "ceil"],
  [/\|[^|]+\|/, "abs"],
  [/!/, "factorial"],
  [/\^/, "pow"],
  [/∫/, "integral"],
  [/deriv/, "deriv"],
];
const TYPE_NS: [RegExp, string][] = [
  [/ℕ/, "nat"],
  [/ℤ/, "int"],
  [/ℝ/, "real"],
  [/ℚ/, "rat"],
  [/ℂ/, "complex"],
  [/Finset/, "finset"],
];
const NOT_CONCEPTS = new Set(["theorem", "lemma", "fun", "by", "sorry", "have", "show", "from", "let", "in", "if", "then", "else", "and", "or", "not", "prop", "type", "true", "false", "open", "import", "mathlib", "set", "option", "max", "heartbeats", "real", "nat", "int", "rat", "complex"]);

/**
 * Premise selection: the Mathlib theorems a proof of `statement` is most
 * likely to use, read before the first attempt rather than after Lean rejects
 * a guessed name (the retrieval step of ReProver and the labs' provers). The
 * statement's concepts are its constant names (`Nat.choose`, `Real.sqrt`,
 * `Finset.range`) and its notation (`√`, `∑`, `∣`, `%`); a theorem scores by
 * how many of them its name and statement mention, and by its namespace
 * matching the statement's number types.
 */
export function premises(decls: Decl[], statement: string, limit = 20): Decl[] {
  const known = new Set<string>();
  for (const d of decls) {
    const last = d.name.slice(d.name.lastIndexOf(".") + 1).toLowerCase();
    if (last.length >= 3) known.add(last);
  }
  const concepts = new Set<string>();
  for (const m of statement.matchAll(/[A-Za-z_][A-Za-z0-9_'.]*/g)) {
    for (const part of m[0].split(".")) {
      for (const w of words(part)) if (w.length >= 3 && !NOT_CONCEPTS.has(w) && known.has(w)) concepts.add(w);
    }
  }
  for (const [re, w] of NOTATION) if (re.test(statement)) concepts.add(w);
  if (!concepts.size) return [];
  const spaces = new Set(TYPE_NS.filter(([re]) => re.test(statement)).map(([, ns]) => ns));
  const scored: { d: Decl; s: number }[] = [];
  for (const d of decls) {
    if (d.kind !== "theorem") continue;
    const parts = words(d.name);
    let inName = 0;
    for (const c of concepts) if (parts.includes(c)) inName++;
    if (!inName) continue;
    const sig = d.sig.toLowerCase();
    let inSig = 0;
    for (const c of concepts) if (sig.includes(c)) inSig++;
    const ns = d.name.includes(".") ? d.name.slice(0, d.name.indexOf(".")).toLowerCase() : "";
    scored.push({ d, s: inName * 3 + inSig + (spaces.has(ns) ? 1.5 : 0) - d.name.length / 60 - d.sig.length / 800 });
  }
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, limit).map((x) => x.d);
}

/** Premises as the attempts read them; empty when there are none. */
export function describePremises(found: Decl[]): string {
  if (!found.length) return "";
  return `Mathlib theorems likely to help, found in Mathlib's source by the statement's concepts (their exact names and types are confirmed by Lean only when used):\n${found.map((d) => `- ${d.name} ${d.sig}`.slice(0, 320)).join("\n")}`;
}
