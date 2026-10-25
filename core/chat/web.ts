// Web search and page fetching for the research chat. Search uses
// DuckDuckGo's HTML endpoint, which needs no key; fetching takes https URLs
// only, follows a bounded number of redirects, and returns text.

import { pdfText, truncate } from "./tools";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Mack/0.1 (+https://github.com/JorgeOchoaReyes/Mack)";

const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Results of DuckDuckGo's HTML page: title, the real link, snippet. */
export function parseDuckDuckGo(html: string): { title: string; url: string; snippet: string }[] {
  const out: { title: string; url: string; snippet: string }[] = [];
  const blocks = html.split(/<div[^>]+class="[^"]*\bresult\b[^"]*"/).slice(1);
  for (const b of blocks) {
    const a = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(b);
    if (!a) continue;
    let url = a[1].replace(/&amp;/g, "&");
    const uddg = /[?&]uddg=([^&]+)/.exec(url);
    if (uddg) url = decodeURIComponent(uddg[1]);
    if (url.startsWith("//")) url = `https:${url}`;
    const snippet = /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div|td)>/.exec(b);
    out.push({ title: decode(a[2]), url, snippet: snippet ? decode(snippet[1]) : "" });
    if (out.length >= 8) break;
  }
  return out;
}

export async function webSearch(query: string, signal?: AbortSignal): Promise<string> {
  if (!query.trim()) throw new Error("empty query");
  const res = await fetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ q: query }).toString(),
    signal,
  });
  if (!res.ok) throw new Error(`the search service returned ${res.status}`);
  const results = parseDuckDuckGo(await res.text());
  if (!results.length) return "no results (the search service may have refused automated access; try fetch_url on a known site)";
  return results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join("\n");
}

/** Visible text of an HTML page: scripts, styles and tags removed. */
export function htmlText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr|br|section|article)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function fetchUrl(url: string, signal?: AbortSignal): Promise<string> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error("not a URL");
  }
  if (u.protocol !== "https:") throw new Error("only https URLs are fetched");
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[?::1)/.test(u.hostname)) throw new Error("local addresses are not fetched");
  const res = await fetch(u, { headers: { "User-Agent": UA }, redirect: "follow", signal });
  if (!res.ok) throw new Error(`the site returned ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  const body = new Uint8Array(await res.arrayBuffer());
  if (body.byteLength > 30_000_000) throw new Error("the response is too large");
  if (type.includes("pdf") || u.pathname.toLowerCase().endsWith(".pdf")) return truncate(await pdfText(body));
  const text = new TextDecoder().decode(body);
  return truncate(type.includes("html") || /<html/i.test(text.slice(0, 500)) ? htmlText(text) : text);
}
