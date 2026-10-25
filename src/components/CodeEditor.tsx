import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, indentOnInput } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from "@codemirror/view";
import { useEffect, useRef } from "react";
import { abbreviations, editorTheme, leanHighlight, leanLanguage } from "../lean";

type Props = { value: string; onChange?: (v: string) => void; readOnly?: boolean; minimal?: boolean };

/** A Lean editor; read-only with `readOnly`, without gutter and active line with `minimal`. */
export function CodeEditor({ value, onChange, readOnly = false, minimal = false }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const extensions = [
      leanLanguage,
      leanHighlight,
      editorTheme,
      EditorView.lineWrapping,
      EditorState.readOnly.of(readOnly),
      EditorView.editable.of(!readOnly),
    ];
    if (!minimal) extensions.push(lineNumbers(), highlightActiveLineGutter());
    if (!readOnly) {
      extensions.push(
        history(),
        drawSelection(),
        highlightActiveLine(),
        indentOnInput(),
        bracketMatching(),
        abbreviations,
        keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChangeRef.current?.(u.state.doc.toString());
        }),
      );
    }
    view.current = new EditorView({ parent: host.current!, state: EditorState.create({ doc: value, extensions }) });
    return () => view.current?.destroy();
    // The editor is created once; `value` changes are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly, minimal]);

  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  return <div className={`code-editor${minimal ? " minimal" : ""}`} ref={host} />;
}
