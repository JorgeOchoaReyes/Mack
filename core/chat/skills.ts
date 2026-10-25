// Skills (upstream `interfaces/skills` and `program-files/skills`),
// Apache-2.0: a skill is a folder `.skill/<name>/` of the project holding
// `SKILL.md` (front matter with `name` and `description`, then the
// instructions) and any files it refers to. Loading a published skill copies
// its SKILL.md into `.skill/<name>/`, where it is one of the project's skills
// from then on. A skill's text is untrusted instructions, never authority.

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const SKILL_DIR = ".skill";

export type Skill = { name: string; description: string };

/** The `name` and `description` of a SKILL.md's front matter. */
export function frontMatter(text: string): Skill | undefined {
  const m = /^---\s*\n([\s\S]*?)\n---/.exec(text.replace(/\r\n/g, "\n"));
  if (!m) return undefined;
  const field = (k: string) => new RegExp(`^${k}:\\s*(.+)$`, "m").exec(m[1])?.[1].trim().replace(/^["']|["']$/g, "");
  const name = field("name");
  const description = field("description");
  if (!name || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) return undefined;
  return { name, description: (description ?? "").slice(0, 300) };
}

export async function listSkills(root: string): Promise<Skill[]> {
  const dir = join(root, SKILL_DIR);
  if (!existsSync(dir)) return [];
  const out: Skill[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    try {
      const fm = frontMatter(await readFile(join(dir, e.name, "SKILL.md"), "utf8"));
      if (fm) out.push(fm);
    } catch {
      // A folder without a readable SKILL.md is not a skill.
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadSkill(root: string, url: string, signal?: AbortSignal): Promise<string> {
  const u = new URL(url);
  if (u.protocol !== "https:") throw new Error("skills load over https only");
  const res = await fetch(u, { signal, headers: { "User-Agent": "mack-app" } });
  if (!res.ok) throw new Error(`the site returned ${res.status}`);
  const text = await res.text();
  if (text.length > 200_000) throw new Error("that SKILL.md is too large");
  const fm = frontMatter(text);
  if (!fm) throw new Error("that is not a SKILL.md: it needs front matter with a lowercase `name` and a `description`");
  const dir = join(root, SKILL_DIR, fm.name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), text, "utf8");
  return `loaded skill \`${fm.name}\` into ${SKILL_DIR}/${fm.name}/SKILL.md: ${fm.description}`;
}
