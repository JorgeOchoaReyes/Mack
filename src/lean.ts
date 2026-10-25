// CodeMirror support for Lean 4: highlighting, the editor theme, and the
// backslash abbreviations Lean's own editors use (`\to` becomes `→` on space).

import { HighlightStyle, StreamLanguage, syntaxHighlighting, type StreamParser } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

const KEYWORDS = new Set(
  (
    "theorem lemma def abbrev example instance structure class inductive where extends namespace section end open " +
    "variable universe noncomputable private protected local attribute set_option import by fun λ let have show from " +
    "at with match if then else do calc suffices obtain rcases rintro intro intros exact apply refine rw rwa simp simp_all " +
    "norm_num ring ring_nf linarith nlinarith positivity omega decide aesop field_simp push_neg use constructor cases " +
    "induction contradiction exfalso by_contra by_cases specialize unfold dsimp gcongr trivial rfl exists left right " +
    "assumption tauto norm_cast push_cast exact_mod_cast interval_cases fin_cases nth_rewrite congr ext funext " +
    "sorry axiom native_decide"
  ).split(" "),
);

const TYPES = /^(Prop|Type|Sort|ℕ|ℤ|ℚ|ℝ|ℂ|Nat|Int|Rat|Real|Complex|Finset|Set|List|Fin|Bool|True|False)\b/;

type State = { comment: number };

const parser: StreamParser<State> = {
  startState: () => ({ comment: 0 }),
  token(stream, state) {
    if (state.comment > 0) {
      while (!stream.eol()) {
        if (stream.match("/-")) state.comment++;
        else if (stream.match("-/")) {
          state.comment--;
          if (state.comment === 0) break;
        } else stream.next();
      }
      return "comment";
    }
    if (stream.eatSpace()) return null;
    if (stream.match("--")) {
      stream.skipToEnd();
      return "comment";
    }
    if (stream.match("/-")) {
      state.comment = 1;
      return "comment";
    }
    if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) return "string";
    if (stream.match(/^\d+(\.\d+)?/)) return "number";
    if (stream.match(TYPES)) return "typeName";
    if (stream.match(/^[@#]?[A-Za-z_α-ωΑ-Ω][\w.'!?₀-₉α-ω]*/)) {
      const w = stream.current();
      if (KEYWORDS.has(w)) return w === "sorry" || w === "axiom" || w === "native_decide" ? "invalid" : "keyword";
      return w.startsWith("#") ? "meta" : "variableName";
    }
    if (stream.match(/^(:=|→|←|↔|∀|∃|λ|⟨|⟩|≤|≥|≠|∧|∨|¬|∈|∉|⊆|∑|∏|·|<;>|\|)/)) return "operator";
    stream.next();
    return null;
  },
  languageData: { commentTokens: { line: "--", block: { open: "/-", close: "-/" } } },
};

export const leanLanguage = StreamLanguage.define(parser);

export const leanHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: t.keyword, color: "var(--syn-keyword)", fontWeight: "500" },
    { tag: t.comment, color: "var(--syn-comment)", fontStyle: "italic" },
    { tag: t.string, color: "var(--syn-string)" },
    { tag: t.number, color: "var(--syn-number)" },
    { tag: t.typeName, color: "var(--syn-type)" },
    { tag: t.operator, color: "var(--syn-operator)" },
    { tag: t.meta, color: "var(--syn-meta)" },
    { tag: t.invalid, color: "var(--bad)", fontWeight: "600" },
  ]),
);

export const editorTheme = EditorView.theme({
  "&": { height: "100%", fontSize: "13.5px", backgroundColor: "transparent", color: "var(--text)" },
  ".cm-scroller": { fontFamily: "var(--mono)", lineHeight: "1.65" },
  ".cm-content": { padding: "14px 0", caretColor: "var(--accent)" },
  ".cm-gutters": { backgroundColor: "transparent", border: "none", color: "var(--faint)" },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 12px 0 16px", minWidth: "44px" },
  ".cm-activeLine": { backgroundColor: "var(--active-line)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--muted)" },
  "&.cm-focused": { outline: "none" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": { backgroundColor: "var(--selection) !important" },
  ".cm-cursor": { borderLeftColor: "var(--accent)", borderLeftWidth: "2px" },
});

/** The most used abbreviations of Lean's VS Code extension. */
export const ABBREVIATIONS: Record<string, string> = {
  to: "→", r: "→", l: "←", iff: "↔", lr: "↔", forall: "∀", all: "∀", exists: "∃", ex: "∃", lam: "λ", fun: "λ",
  and: "∧", or: "∨", not: "¬", neg: "¬", ne: "≠", le: "≤", ge: "≥", in: "∈", notin: "∉", sub: "⊆", ss: "⊂",
  sup: "⊇", cup: "∪", cap: "∩", empty: "∅", N: "ℕ", Z: "ℤ", Q: "ℚ", R: "ℝ", C: "ℂ", sum: "∑", prod: "∏",
  inf: "∞", sqrt: "√", "<": "⟨", ">": "⟩", ".": "·", comp: "∘", circ: "∘", times: "×", x: "×", div: "∣",
  mid: "∣", a: "α", b: "β", g: "γ", d: "δ", e: "ε", eps: "ε", z: "ζ", th: "θ", k: "κ", m: "μ", n: "ν",
  p: "π", pi: "π", s: "σ", t: "τ", ph: "φ", phi: "φ", ps: "ψ", o: "ω", G: "Γ", D: "Δ", S: "Σ", O: "Ω",
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "^2": "²", "^3": "³", "^n": "ⁿ", "-1": "⁻¹", inv: "⁻¹", "=>": "⇒", tri: "▸",
};

/** Expands `\name` into its symbol when a space, tab or bracket is typed after it. */
export const abbreviations = EditorView.inputHandler.of((view, from, to, text) => {
  if (!/^[\s()[\]{},]$/.test(text)) return false;
  const line = view.state.doc.lineAt(from);
  const before = line.text.slice(0, from - line.from);
  const m = /\\([^\s\\]+)$/.exec(before);
  if (!m || !(m[1] in ABBREVIATIONS)) return false;
  const start = from - m[0].length;
  const symbol = ABBREVIATIONS[m[1]];
  view.dispatch({
    changes: { from: start, to, insert: symbol + (text === " " ? "" : text) },
    selection: { anchor: start + symbol.length + (text === " " ? 0 : text.length) },
  });
  return true;
});
