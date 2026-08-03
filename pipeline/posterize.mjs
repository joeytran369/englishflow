// Backfill poster images for existing episodes (or regenerate one by slug).
// Usage:
//   node pipeline/posterize.mjs               # all episodes missing a poster
//   node pipeline/posterize.mjs <slug>        # one episode (force regenerate)
//   node pipeline/posterize.mjs --force       # all, force regenerate

import { readFile, writeFile } from "node:fs/promises";
import { readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { posterAgent } from "./agents/poster.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = join(__dirname, "..", "content");
const POSTERS_DIR = join(__dirname, "..", "public", "posters");

const arg = process.argv[2];
const force = arg === "--force" || process.argv.includes("--force");
const targetSlug = arg && arg !== "--force" ? arg.replace(/\.json$/, "") : null;

const slugs = targetSlug
  ? [targetSlug]
  : readdirSync(CONTENT_DIR).filter((f) => f.endsWith(".json")).map((f) => f.replace(".json", ""));

for (const slug of slugs) {
  const jsonPath = join(CONTENT_DIR, `${slug}.json`);
  if (!existsSync(jsonPath)) { console.warn(`✗ not found: ${slug}`); continue; }
  const episode = JSON.parse(await readFile(jsonPath, "utf8"));
  if (!force && !targetSlug && episode.poster?.generated) {
    console.log(`· skip ${slug} (already has poster)`);
    continue;
  }
  console.log(`\n▶ ${slug}`);
  const r = await posterAgent(episode, POSTERS_DIR);
  if (!r.generated) { console.warn(`  ✗ ${r.reason}`); continue; }
  episode.poster = r;
  await writeFile(jsonPath, JSON.stringify(episode, null, 2));
  console.log(`  ✓ ${r.file} (${r.provider})`);
}

console.log("\n\x1b[32m✓ Done.\x1b[0m");
