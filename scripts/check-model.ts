// `node dist-electron/scripts/check-model.js --provider <id> --model <id> [--prover <ids>]`
// Before an official run starts any machine (.github/workflows/benchmark-run.yml):
// asks the provider for its model list with the run's key, writes it (with prices)
// to the run's summary page, and stops the run when a model it names is not on
// the list, with the closest ids, so a wrong id never costs a run. A key the
// provider refuses stops it too; a list that cannot be read only warns.

import { appendFileSync } from "node:fs";
import { OpenAICompatibleProvider } from "../core/model/openai-compatible";
import { PROVIDERS, providerInfo, type ProviderId } from "../core/model/providers";

const summary = (md: string) => {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md}\n`);
  else console.log(md);
};

function arg(name: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? (process.argv[at + 1] ?? "") : "";
}

/** How many single-character edits turn one id into the other, for "did you mean". */
export function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length];
}

/** The ids on the list most like `want`: ones that contain it or its last part first, then the nearest by edits. */
export function closest(want: string, ids: string[], n = 5): string[] {
  const w = want.toLowerCase();
  const tail = w.split("/").pop() ?? w;
  const score = (id: string) => {
    const x = id.toLowerCase();
    return x.includes(tail) || tail.includes(x.split("/").pop() ?? x) ? -1000 + editDistance(tail, x) : editDistance(w, x);
  };
  return [...ids].sort((a, b) => score(a) - score(b)).slice(0, n);
}

async function main(): Promise<void> {
  const id = arg("provider") as ProviderId;
  if (!PROVIDERS.some((p) => p.id === id)) throw new Error(`unknown provider ${id}`);
  const info = providerInfo(id);
  const wanted = [arg("model"), ...arg("prover").split(",")].map((m) => m.trim()).filter(Boolean);
  const key = process.env[info.keyEnv] ?? "";
  if (info.keyRequired && !key) {
    summary(`### ❌ No ${info.label} API key\n\nAdd the \`${info.keyEnv}\` repository secret.`);
    console.error(`::error title=No API key::${info.keyEnv} is not set.`);
    process.exit(1);
  }
  if (!info.baseUrl) {
    summary(`### ${info.label}: the model list is not checked (no fixed address).`);
    return;
  }
  const p = new OpenAICompatibleProvider(info.label, info.baseUrl, key, { extraHeaders: info.headers, prices: info.prices });
  let ids: string[];
  try {
    ids = await p.listModels();
  } catch (e) {
    const msg = (e as Error).message;
    if (/\b(401|403)\b/.test(msg)) {
      summary(`### ❌ ${info.label} refused the API key\n\n\`${msg.slice(0, 300)}\`\n\nCheck the \`${info.keyEnv}\` secret.`);
      console.error(`::error title=API key refused::${info.label} refused ${info.keyEnv}: ${msg.slice(0, 200)}`);
      process.exit(1);
    }
    summary(`### ⚠️ ${info.label}'s model list could not be read, so the model id was not checked\n\n\`${msg.slice(0, 300)}\``);
    return;
  }
  const prices = await p.listPrices().catch(() => ({}) as Record<string, { input: number; output: number }>);
  const money = (x?: number) => (x === undefined ? "" : `$${x < 1 ? x.toFixed(3) : x.toFixed(2)}`);
  const missing = wanted.filter((m) => !ids.includes(m));
  const lines = [
    missing.length ? `### ❌ Not on ${info.label}'s model list: ${missing.map((m) => `\`${m}\``).join(", ")}` : `### ✅ ${wanted.map((m) => `\`${m}\``).join(", ")} on ${info.label}'s model list`,
    "",
    ...missing.map((m) => `- \`${m}\`: closest ids are ${closest(m, ids).map((c) => `\`${c}\``).join(", ")}`),
    ...(missing.length ? ["", "Start the run again with one of the ids below (Model → custom, then the id)."] : []),
    "",
    `<details${missing.length ? " open" : ""}><summary>All ${ids.length} chat models on ${info.label}, with prices per million tokens in / out</summary>`,
    "",
    "| Model | In | Out |",
    "|---|---|---|",
    ...ids.map((m) => `| \`${m}\` | ${money(prices[m]?.input)} | ${money(prices[m]?.output)} |`),
    "",
    "</details>",
    "",
  ];
  summary(lines.join("\n"));
  console.log(`${ids.length} models on ${info.label}; ${missing.length ? `missing: ${missing.join(", ")}` : "all found"}.`);
  if (missing.length) {
    console.error(`::error title=Unknown model::${missing.join(", ")} not on ${info.label}'s model list. Closest: ${closest(missing[0], ids, 3).join(", ")}. The full list is on the run's summary page.`);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((e: Error) => {
    console.error(e.stack ?? e.message);
    process.exit(1);
  });
}
