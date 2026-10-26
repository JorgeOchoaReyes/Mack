// Markdown as the assistant writes it, rendered as React elements (never as
// HTML, so model text cannot inject markup): headings, paragraphs, lists,
// quotes, rules, tables, fenced code (Lean in the editor), inline code, bold,
// italics, links (https only, opened in the browser through the main
// process) and images of project files.

import { Fragment, useEffect, useState, type ReactNode } from "react";
import { TOOL_BLOCK } from "../../../core/chat/tool-block";
import { api } from "../../api";
import { CodeEditor } from "../CodeEditor";
import { CopyButton } from "../ui";

function ProjectImage({ alt, path, projectId }: { alt: string; path: string; projectId: string }) {
  const [src, setSrc] = useState<string | null | undefined>(undefined);
  useEffect(() => void api.projectImage(projectId, path).then(setSrc), [projectId, path]);
  if (src === undefined) return <span className="md-img-loading">{path}</span>;
  if (src === null) return <span className="muted small">[image {path} could not be shown]</span>;
  return <img className="chat-image" src={src} alt={alt} title={path} />;
}

/** Inline syntax: `code`, **bold**, *italic*, [link](https://…), ![image](project/path). */
function inline(text: string, projectId: string, key = ""): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\s][^*\n]*\*|_[^_\s][^_\n]*_)|(!\[[^\]]*\]\([^)\s]+\))|(\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    const k = `${key}-${n++}`;
    if (m[1]) out.push(<code key={k} className="md-code">{t.slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={k}>{inline(t.slice(2, -2), projectId, k)}</strong>);
    else if (m[3]) out.push(<em key={k}>{inline(t.slice(1, -1), projectId, k)}</em>);
    else if (m[4]) {
      const im = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(t)!;
      out.push(/^[a-z]+:/i.test(im[2]) ? <span key={k}>{t}</span> : <ProjectImage key={k} alt={im[1]} path={im[2]} projectId={projectId} />);
    } else if (m[5]) {
      const lm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(t)!;
      out.push(
        /^https:\/\//.test(lm[2]) ? (
          <a key={k} href={lm[2]} onClick={(e) => (e.preventDefault(), void api.openExternal(lm[2]).catch(() => {}))} title={lm[2]}>
            {lm[1]}
          </a>
        ) : (
          <span key={k}>{lm[1]}</span>
        ),
      );
    }
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Align = "left" | "center" | "right" | undefined;
type Block = { kind: "p" | "h" | "ul" | "ol" | "quote" | "hr" | "code" | "table"; level?: number; lines: string[]; lang?: string; open?: boolean; rows?: string[][]; align?: Align[] };

/** The cells of a table row: `| a | b |` or `a | b`; `\|` and pipes inside `code` stay in the cell. */
export function cells(line: string): string[] {
  const out: string[] = [];
  let cell = "";
  let code = false;
  const t = line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "");
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === "\\" && t[i + 1] === "|") cell += t[++i];
    else if (c === "`") (code = !code), (cell += c);
    else if (c === "|" && !code) out.push(cell.trim()), (cell = "");
    else cell += c;
  }
  out.push(cell.trim());
  return out;
}

const DELIMITER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const alignOf = (c: string): Align => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : c.startsWith(":") ? "left" : undefined);

/** Split text into blocks; an unclosed fence (still streaming) is a code block too. */
export function blocks(text: string): Block[] {
  const out: Block[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = /^```\s*([\w-]*)\s*$/.exec(line.trim());
    if (fence) {
      const body: string[] = [];
      let j = i + 1;
      while (j < lines.length && lines[j].trim() !== "```") body.push(lines[j++]);
      out.push({ kind: "code", lang: fence[1], lines: body, open: j >= lines.length });
      i = j;
      continue;
    }
    if (!line.trim()) continue;
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      out.push({ kind: "h", level: h[1].length, lines: [h[2]] });
      continue;
    }
    // A table: a header row with a pipe, then a delimiter row like |---|:--:|.
    if (line.includes("|") && DELIMITER.test(lines[i + 1] ?? "") && lines[i + 1].includes("-")) {
      const header = cells(line);
      const align = cells(lines[i + 1]).map(alignOf);
      const rows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && lines[j].trim() && lines[j].includes("|")) rows.push(cells(lines[j++]));
      out.push({ kind: "table", lines: header, rows, align });
      i = j - 1;
      continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push({ kind: "hr", lines: [] });
      continue;
    }
    const prev = out[out.length - 1];
    const ul = /^\s*[-*+]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const q = /^\s*>\s?(.*)$/.exec(line);
    if (ul) prev?.kind === "ul" ? prev.lines.push(ul[1]) : out.push({ kind: "ul", lines: [ul[1]] });
    else if (ol) prev?.kind === "ol" ? prev.lines.push(ol[1]) : out.push({ kind: "ol", lines: [ol[1]] });
    else if (q) prev?.kind === "quote" ? prev.lines.push(q[1]) : out.push({ kind: "quote", lines: [q[1]] });
    else if (prev?.kind === "p" && lines[i - 1]?.trim()) prev.lines.push(line);
    else if ((prev?.kind === "ul" || prev?.kind === "ol") && /^\s{2,}\S/.test(line)) prev.lines[prev.lines.length - 1] += ` ${line.trim()}`;
    else out.push({ kind: "p", lines: [line] });
  }
  return out;
}

/** What the person sees of an assistant reply: reasoning, tool calls and citations removed. */
export function visible(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/<think>[\s\S]*$/, "")
    .replace(TOOL_BLOCK, "")
    .replace(/<citation_entries>[\s\S]*?(<\/citation_entries>|$)/g, "")
    .trim();
}

export function Markdown({ text, projectId }: { text: string; projectId: string }) {
  return (
    <div className="md">
      {blocks(text).map((b, i) => {
        const k = `b${i}`;
        switch (b.kind) {
          case "code": {
            const code = b.lines.join("\n");
            return (
              <div key={k} className="md-pre">
                <div className="md-pre-head">
                  <span>{b.lang || "text"}</span>
                  {!b.open && <CopyButton text={code} label="Copy" />}
                </div>
                {b.lang?.startsWith("lean") ? <CodeEditor value={code} readOnly /> : <pre>{code}</pre>}
              </div>
            );
          }
          case "h":
            return b.level === 1 ? <h3 key={k}>{inline(b.lines[0], projectId, k)}</h3> : <h4 key={k}>{inline(b.lines[0], projectId, k)}</h4>;
          case "hr":
            return <hr key={k} />;
          case "table":
            return (
              <div key={k} className="md-table">
                <table>
                  <thead>
                    <tr>
                      {b.lines.map((c, j) => (
                        <th key={j} style={{ textAlign: b.align?.[j] }}>
                          {inline(c, projectId, `${k}h${j}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows?.map((r, ri) => (
                      <tr key={ri}>
                        {b.lines.map((_, j) => (
                          <td key={j} style={{ textAlign: b.align?.[j] }}>
                            {inline(r[j] ?? "", projectId, `${k}r${ri}c${j}`)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "ul":
            return (
              <ul key={k}>
                {b.lines.map((l, j) => (
                  <li key={j}>{inline(l, projectId, `${k}${j}`)}</li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={k}>
                {b.lines.map((l, j) => (
                  <li key={j}>{inline(l, projectId, `${k}${j}`)}</li>
                ))}
              </ol>
            );
          case "quote":
            return <blockquote key={k}>{inline(b.lines.join(" "), projectId, k)}</blockquote>;
          default:
            return (
              <p key={k}>
                {b.lines.map((l, j) => (
                  <Fragment key={j}>
                    {j > 0 && <br />}
                    {inline(l, projectId, `${k}${j}`)}
                  </Fragment>
                ))}
              </p>
            );
        }
      })}
    </div>
  );
}
