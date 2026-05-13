// Re-run alignment only on existing episodes — uses Whisper, no Gemini quota.
// Usage:
//   node pipeline/realign.mjs                   # all episodes
//   node pipeline/realign.mjs <slug>            # one episode

import { readFile, writeFile } from "node:fs/promises";
import { readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { alignAgent } from "./agents/align.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = join(__dirname, "..", "content");
const AUDIO_DIR = join(__dirname, "..", "public", "audio");

async function alignOne(slug) {
  const jsonPath = join(CONTENT_DIR, `${slug}.json`);
  if (!existsSync(jsonPath)) {
    console.warn(`  ⚠ JSON not found: ${jsonPath}`);
    return;
  }
  const wavPath = join(AUDIO_DIR, `${slug}.wav`);
  if (!existsSync(wavPath)) {
    console.warn(`  ⚠ Voice WAV not found: ${wavPath} (need to re-gen)`);
    return;
  }
  const episode = JSON.parse(await readFile(jsonPath, "utf8"));
  const introSec = episode.audio?.mix?.intro?.durationSec ?? 0;
  console.log(`\n\x1b[1m▶ Aligning ${slug}\x1b[0m  (intro offset: ${introSec}s)`);
  const t0 = Date.now();
  const r = await alignAgent(episode, wavPath, introSec);
  if (!r.aligned) {
    console.warn(`  ✗ skipped — ${r.reason}`);
    return;
  }
  episode.audio = { ...episode.audio, align: r };
  await writeFile(jsonPath, JSON.stringify(episode, null, 2));
  const okCount = r.lineTimings.filter(Boolean).length;
  console.log(`  ✓ ${okCount}/${r.lineTimings.length} lines timed · ${r.segmentCount} segments · ${Math.round((Date.now() - t0) / 1000)}s`);
  console.log("  First 3 lines:");
  for (const t of r.lineTimings.slice(0, 3)) {
    if (t) console.log(`    [${t.start}s → ${t.end}s] (${t.durationSec}s)`);
  }
}

async function main() {
  const arg = process.argv[2];
  const slugs = arg
    ? [arg.replace(/\.json$/, "")]
    : readdirSync(CONTENT_DIR).filter((f) => f.endsWith(".json")).map((f) => f.replace(".json", ""));
  for (const s of slugs) await alignOne(s);
  console.log("\n\x1b[32m✓ Done.\x1b[0m");
}

main().catch((e) => { console.error("\x1b[31m✗\x1b[0m", e); process.exit(1); });
