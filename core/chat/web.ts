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

/** Results of Bing's RSS feed (`format=rss`): the fallback when DuckDuckGo refuses. */
export function parseBingRss(xml: string): { title: string; url: string; snippet: string }[] {
  const tag = (item: string, name: string) => decode(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(item)?.[1] ?? "");
  return xml
    .split("<item>")
    .slice(1)
    .map((item) => ({ title: tag(item, "title"), url: tag(item, "link"), snippet: tag(item, "description") }))
    .filter((r) => r.url.startsWith("http"))
    .slice(0, 8);
}

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), reject(new Error("stopped"))), { once: true });
  });

async function duckDuckGo(query: string, signal?: AbortSignal) {
  const res = await fetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ q: query }).toString(),
    signal,
  });
  return res.ok ? parseDuckDuckGo(await res.text()) : [];
}

async function bing(query: string, signal?: AbortSignal) {
  const res = await fetch(`https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}`, { headers: { "User-Agent": UA }, signal });
  return res.ok ? parseBingRss(await res.text()) : [];
}

// DuckDuckGo refuses bursts, and the model often sends several searches at
// once: searches run one at a time, a second apart; a refusal is tried again
// once after a pause, then Bing answers instead.
let queue: Promise<unknown> = Promise.resolve();
let last = 0;

export function webSearch(query: string, signal?: AbortSignal): Promise<string> {
  if (!query.trim()) return Promise.reject(new Error("empty query"));
  const run = async () => {
    await wait(Math.max(0, last + 1000 - Date.now()), signal);
    try {
      let results = await duckDuckGo(query, signal);
      if (!results.length) {
        await wait(2500, signal);
        results = await duckDuckGo(query, signal);
      }
      if (!results.length) results = await bing(query, signal);
      if (!results.length) return "no results (both search services refused or found nothing; try other words, or fetch_url on a known site)";
      return results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join("\n");
    } finally {
      last = Date.now();
    }
  };
  const p = queue.then(run, run);
  queue = p.catch(() => {});
  return p;
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
