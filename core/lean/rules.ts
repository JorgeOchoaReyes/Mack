// The textual rules of the proof protocol, decided without running Lean:
// forbidden tokens, the frozen statement verbatim, the frozen preamble line
// for line. Ported from open-math-harness `interfaces/lean/src/rules.rs`
// (Apache-2.0); see NOTICE and docs/UPSTREAM.md. Offsets are JS string
// indices (UTF-16 code units) rather than the upstream's UTF-8 bytes; every
// function here is consistent in that unit.

const AMBIGUOUS = "string or character literal the checker cannot read unambiguously";
const OPEN_COMMENT = "comment opened with /- and never closed with -/";
const OPEN_NAME = "name opened with « and never closed with »";

export type Range = { start: number; end: number };

/** Lean's `isIdRest`: the characters that continue an identifier. */
export function isIdRest(c: string): boolean {
  const v = c.codePointAt(0) ?? 0;
  const letterLike =
    (v >= 0x3b1 && v <= 0x3c9 && v !== 0x3bb) ||
    (v >= 0x391 && v <= 0x3a9 && v !== 0x3a0 && v !== 0x3a3) ||
    (v >= 0x3ca && v <= 0x3fb) ||
    (v >= 0x1f00 && v <= 0x1ffe) ||
    (v >= 0x2100 && v <= 0x214f) ||
    (v >= 0x1d49c && v <= 0x1d59f);
  const subscript =
    (v >= 0x2080 && v <= 0x2089) || (v >= 0x2090 && v <= 0x209c) || (v >= 0x1d62 && v <= 0x1d6a) || v === 0x2c7c;
  return /^[A-Za-z0-9_'!?]$/.test(c) || letterLike || subscript;
}

/**
 * `source` with comments (and string literals when `strings`) blanked to
 * spaces so nothing moves, plus the span of every string literal. Throws a
 * reason for any construct this lexer might read differently from Lean;
 * legitimate proofs need none of them.
 */
function blanked(source: string, strings: boolean): { code: string; spans: Range[] } {
  const chars: { i: number; c: string }[] = [];
  for (let i = 0; i < source.length; ) {
    const c = String.fromCodePoint(source.codePointAt(i) ?? 0);
    chars.push({ i, c });
    i += c.length;
  }
  const out = source.split("");
  const spans: Range[] = [];
  const blank = (from: number, to: number) => {
    for (let j = from; j < to; j++) if (out[j] !== "\n") out[j] = " ";
  };
  const at = (k: number) => chars[k]?.c;
  const pos = (k: number) => (k < chars.length ? chars[k].i : source.length);
  let k = 0;
  while (k < chars.length) {
    const c = chars[k].c;
    const prev = k > 0 ? at(k - 1) : undefined;
    const quoteOrEscape = prev === "'" || prev === "\\";
    const opensComment = (c === "-" && at(k + 1) === "-") || (c === "/" && at(k + 1) === "-");
    if ((opensComment || c === "«" || c === '"') && quoteOrEscape) throw new Error(AMBIGUOUS);
    if (c === "-" && at(k + 1) === "-") {
      const start = k;
      while (k < chars.length && chars[k].c !== "\n") k++;
      blank(pos(start), pos(k));
    } else if (c === "/" && at(k + 1) === "-") {
      const start = k;
      let depth = 1;
      // Lean reads `/--` and `/-!` as one token.
      k += at(k + 2) === "-" || at(k + 2) === "!" ? 3 : 2;
      while (k < chars.length && depth > 0) {
        if (chars[k].c === "-" && at(k + 1) === "/") {
          depth--;
          k += 2;
        } else if (chars[k].c === "/" && at(k + 1) === "-") {
          depth++;
          k += 2;
        } else k++;
      }
      if (depth > 0) throw new Error(OPEN_COMMENT);
      blank(pos(start), pos(k));
    } else if (c === '"') {
      if (prev !== undefined && (isIdRest(prev) || prev === "#")) throw new Error(AMBIGUOUS);
      const start = k;
      k++;
      for (;;) {
        const d = at(k);
        if (d === undefined || d === "\\" || d === "{") throw new Error(AMBIGUOUS);
        if (d === '"') break;
        k++;
      }
      k++;
      spans.push({ start: pos(start), end: pos(k) });
      if (strings) blank(pos(start), pos(k));
    } else if (c === "«") {
      while (k < chars.length && chars[k].c !== "»") k++;
      if (k === chars.length) throw new Error(OPEN_NAME);
    } else k++;
  }
  return { code: out.join(""), spans };
}

/** `source` with comments and string literals blanked; throws a reason when ambiguous. */
export function leanCode(source: string): string {
  return blanked(source, true).code;
}

function tryLeanCode(source: string): { code: string } | { error: string } {
  try {
    return { code: leanCode(source) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

function statementSpan(frozen: string): Range | undefined {
  const r = tryLeanCode(frozen);
  if (!("code" in r)) return undefined;
  const code = r.code;
  let start = -1;
  for (let i = code.indexOf("theorem"); i !== -1; i = code.indexOf("theorem", i + 1)) {
    if (i === 0 || code[i - 1] === "\n") {
      start = i;
      break;
    }
  }
  const end = code.lastIndexOf(":=");
  if (start === -1 || end === -1 || end < start) return undefined;
  return { start, end: end + 2 };
}

/**
 * The frozen statement: from the first line of code that starts with
 * `theorem` to the last `:=` of code, inclusive. Candidates must contain it
 * verbatim.
 */
export function extractStatement(frozen: string): string | undefined {
  const s = statementSpan(frozen);
  return s && frozen.slice(s.start, s.end);
}

/** The theorem's name, from the frozen statement. */
export function theoremName(statement: string): string | undefined {
  return /^theorem\s+([^\s:({[]+)/.exec(statement)?.[1];
}

/**
 * Words that make Lean run code, change the syntax, or reach the
 * meta-programming and IO libraries while it elaborates. A proof needs none
 * of them, and elaborated code could print into the output the verdict is
 * read from.
 */
const EXEC_WORDS = [
  "#exit", "#guard", "#html", "#widget", "#sample", "#test",
  "run_cmd", "run_elab", "run_meta", "run_tac", "by_elab",
  "syntax", "macro", "macro_rules", "elab", "elab_rules", "declare_syntax_cat",
  "notation", "notation3", "infix", "infixl", "infixr", "prefix", "postfix", "binder_predicate",
  "initialize", "builtin_initialize", "simproc", "dsimproc", "simproc_decl", "dsimproc_decl",
  "command_elab", "term_elab", "tactic", "delab", "app_unexpander", "implemented_by", "extern",
  "unsafe", "Lean", "Mathlib", "Aesop", "Batteries", "Qq", "IO", "EIO", "BaseIO",
  "println!", "eprintln!", "asTask",
];

/** Library roots a header may `import`; anywhere else they are exec words. */
const IMPORTABLE = ["Lean", "Mathlib", "Aesop", "Batteries", "Qq"];

/** `pp.*` would change the type the verdict compares; `debug.*` can skip the kernel check. */
const BANNED_OPTION_ROOTS = ["pp", "debug"];

/** Maximal runs of identifier characters, a leading `#` kept, with the offset after each. */
function words(code: string): [string, number][] {
  const out: [string, number][] = [];
  let start: number | undefined;
  const cs: [number, string][] = [];
  for (let i = 0; i < code.length; ) {
    const c = String.fromCodePoint(code.codePointAt(i) ?? 0);
    cs.push([i, c]);
    i += c.length;
  }
  cs.push([code.length, " "]);
  for (const [i, c] of cs) {
    if (start !== undefined && !isIdRest(c)) {
      if (!(i === start + 1 && code[start] === "#")) out.push([code.slice(start, i), i]);
      start = c === "#" ? i : undefined;
    } else if (start === undefined && (isIdRest(c) || c === "#")) start = i;
  }
  return out;
}

function execWord(code: string): string | undefined {
  const ws = words(code);
  let inImport = false;
  for (let n = 0; n < ws.length; n++) {
    const [word, end] = ws[n];
    const start = end - word.length;
    if (n > 0) {
      const [prev, prevEnd] = ws[n - 1];
      const gap = code.slice(prevEnd, start);
      inImport = (prev === "import" && gap.length > 0 && /^[ \t]+$/.test(gap)) || (inImport && gap === ".");
    } else inImport = false;
    if (inImport && IMPORTABLE.includes(word)) continue;
    if (word.startsWith("#eval")) return "#eval";
    if (word === "eval" && code.slice(end).startsWith("%")) return "eval%";
    if (EXEC_WORDS.includes(word)) return word;
  }
  return undefined;
}

/**
 * The first token forbidden even in a partial proof: `sorry` is allowed;
 * `native_decide`, a user `axiom`, `set_option pp.*`/`debug.*` and every
 * exec word never are.
 */
export function checkForbiddenToken(candidate: string): string | undefined {
  const r = tryLeanCode(candidate);
  if (!("code" in r)) return r.error;
  const code = r.code;
  if (code.includes("native_decide")) return "native_decide";
  const ws = words(code);
  if (ws.some(([w]) => w === "axiom")) return "axiom";
  for (let i = 0; i + 1 < ws.length; i++) {
    if (ws[i][0] === "set_option" && BANNED_OPTION_ROOTS.includes(ws[i + 1][0])) {
      return ws[i + 1][0] === "pp" ? "set_option pp" : "set_option debug";
    }
  }
  return execWord(code);
}

/** The first forbidden token in a candidate offered as a complete proof: `sorry` too. */
export function forbiddenToken(candidate: string): string | undefined {
  const r = tryLeanCode(candidate);
  if ("code" in r && r.code.includes("sorry")) return "sorry";
  return checkForbiddenToken(candidate);
}

/** Why `candidate` cannot be graded as a partial proof of `statement`, or undefined. */
export function protocolObjection(statement: string, candidate: string): string | undefined {
  const tok = checkForbiddenToken(candidate);
  if (tok) return `forbidden token \`${tok}\``;
  if (!candidate.includes(statement)) {
    return `the frozen theorem statement must appear verbatim; it is, byte for byte:\n${statement}`;
  }
  return undefined;
}

/** Keywords that start a command and can never continue a term. */
const COMMAND_WORDS = [
  "theorem", "lemma", "def", "abbrev", "instance", "example", "opaque", "structure", "class", "inductive",
  "namespace", "section", "end", "variable", "universe", "noncomputable", "private", "protected", "partial",
  "open", "set_option", "attribute", "local", "scoped", "mutual", "export", "import", "omit", "include",
  "irreducible_def",
];

function firstWord(text: string): string {
  let w = "";
  for (const c of text) {
    if (!isIdRest(c)) break;
    w += c;
  }
  return w;
}

function startsCommand(text: string): boolean {
  return text.startsWith("@[") || COMMAND_WORDS.includes(firstWord(text));
}

type CodeLine = { text: string; end: number };

/** Lines of code: comments blanked, ends trimmed, blank lines dropped; a string literal never splits a line. */
function codeLines(text: string): CodeLine[] {
  const { code, spans } = blanked(text, false);
  const lines: CodeLine[] = [];
  let start = 0;
  let s = 0;
  const breaks: number[] = [];
  for (let i = code.indexOf("\n"); i !== -1; i = code.indexOf("\n", i + 1)) breaks.push(i);
  breaks.push(code.length);
  for (const at of breaks) {
    while (s < spans.length && spans[s].end <= at) s++;
    if (s < spans.length && spans[s].start < at) continue;
    const line = code.slice(start, at).trimEnd();
    if (line.length > 0) lines.push({ text: line, end: start + line.length });
    start = at + 1;
  }
  return lines;
}

export type PreambleCopy = { frozenEnd: number; candidateEnd: number };

/**
 * Whether `candidate` keeps the preamble of `frozen` (everything before its
 * statement) and where its copy ends; null when the preamble has no code.
 * Throws the reason when it does not. This is what stops a candidate from
 * redefining a `def` the statement uses.
 */
export function preambleCopy(frozen: string, candidate: string): PreambleCopy | null {
  const span = statementSpan(frozen);
  if (!span) throw new Error("the frozen file has no `theorem … :=` statement at the start of a line");
  const preamble = codeLines(frozen.slice(0, span.start));
  const lines = codeLines(candidate);
  for (let k = 0; k < preamble.length; k++) {
    if (lines[k]?.text !== preamble[k].text) {
      throw new Error(
        "the candidate must begin with the frozen file's preamble (its lines before the theorem, blank " +
          `lines and comments aside), unchanged; the first line that differs is, byte for byte:\n${preamble[k].text}`,
      );
    }
  }
  if (preamble.length === 0) return null;
  const copy = { frozenEnd: preamble[preamble.length - 1].end, candidateEnd: lines[preamble.length - 1].end };
  const next = lines[preamble.length]?.text.trimStart();
  if (next === undefined || startsCommand(next)) return copy;
  throw new Error(
    "the line after the frozen preamble must start a new command (`lemma`, `theorem`, `def`, `open`, `@[`, " +
      `…) so that it adds nothing to the preamble's last declaration; it starts: ${next.slice(0, 200)}`,
  );
}

function provedBySorryAlone(proof: string): boolean {
  let p = proof.trimStart();
  if (p.startsWith("by") && /^\s/.test(p.slice(2))) p = p.slice(2);
  p = p.trimStart();
  if (!p.startsWith("sorry")) return false;
  const rest = p.slice(5);
  if (rest.length > 0 && isIdRest(String.fromCodePoint(rest.codePointAt(0) ?? 0))) return false;
  const next = rest.trimStart();
  return next.length === 0 || (rest.slice(0, rest.length - next.length).includes("\n") && startsCommand(next));
}

/**
 * Why `source` cannot be a frozen problem file, or undefined: it must begin
 * with exactly `import Mathlib`, contain no forbidden token, state one
 * `theorem … :=` proved by `sorry` alone, keep `sorry` out of its preamble,
 * and not end its preamble in `in`.
 */
export function frozenObjection(source: string): string | undefined {
  const r = tryLeanCode(source);
  if (!("code" in r)) {
    return `the frozen file has a ${r.error}; close every comment and \`«\` name and write string literals plainly`;
  }
  const code = r.code;
  const codeLinesTrimmed = code.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  if (codeLinesTrimmed[0] !== "import Mathlib") return "the frozen file must begin with exactly `import Mathlib`";
  if (codeLinesTrimmed.slice(1).some((l) => /^import(\s|$)/.test(l))) {
    return "the frozen file may import nothing but Mathlib, with one `import Mathlib` line";
  }
  const tok = checkForbiddenToken(source);
  if (tok) return `the frozen file has the forbidden token \`${tok}\``;
  const span = statementSpan(source);
  if (!span) return "the frozen file has no `theorem … :=` statement at the start of a line";
  const commented = blanked(source, false).code;
  if (!provedBySorryAlone(commented.slice(span.end))) {
    return "the frozen file's theorem must be proved by `sorry` alone (`:= sorry` or `:= by sorry`)";
  }
  if (code.slice(0, span.end).includes("sorry")) {
    return "the definitions and statement before the proof contain `sorry`, so no proof could ever be accepted";
  }
  const head = codeLines(source.slice(0, span.start));
  const last = head[head.length - 1]?.text;
  if (last && /(^|[^A-Za-z0-9_'!?])in$/.test(last)) {
    return "the frozen file's last line before the theorem ends in `in`; drop the `in`";
  }
  try {
    preambleCopy(source, source);
  } catch (e) {
    return `verify cannot read the frozen file's own preamble: ${(e as Error).message}`;
  }
  return undefined;
}

/** A problem is a Lean problem when it is a usable frozen file; anything else is an informal problem. */
export function problemKind(problem: string): "lean" | "informal" {
  return extractStatement(problem) && !frozenObjection(problem) ? "lean" : "informal";
}
