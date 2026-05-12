// Re-run mixer only — uses existing voice WAV + current bgm folder.
// Burns ZERO Gemini quota. Use this to iterate on bgm track selection.
//
// Usage:
//   node pipeline/remix.mjs              # remix latest episode
//   node pipeline/remix.mjs 2026-05-12   # remix specific episode

import { readFile, writeFile } from "node:fs/promises";
import { readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mixerAgent } from "./agents/mixer.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = join(__dirname, "..", "content");
const AUDIO_DIR = join(__dirname, "..", "public", "audio");
const BGM_DIR = join(__dirname, "..", "public", "bgm");

const targetId = process.argv[2] || latestEpisodeId();

function latestEpisodeId() {
  const files = readdirSync(CONTENT_DIR).filter((f) => f.endsWith(".json"));
  if (!files.length) throw new Error("No episodes in content/");
  return files.sort().reverse()[0].replace(".json", "");
}

async function main() {
  const jsonPath = join(CONTENT_DIR, `${targetId}.json`);
  if (!existsSync(jsonPath)) throw new Error(`Episode JSON not found: ${jsonPath}`);

  const episode = JSON.parse(await readFile(jsonPath, "utf8"));
  const wavPath = join(AUDIO_DIR, `${targetId}.wav`);
  if (!existsSync(wavPath)) {
    throw new Error(
      `Voice WAV not found: ${wavPath}\nRun the full pipeline first with GEMINI_API_KEY to generate voice.`
    );
  }

  console.log(`\n\x1b[1m▶ Remixing ${targetId}\x1b[0m\n`);
  const mix = await mixerAgent(wavPath, targetId, AUDIO_DIR, BGM_DIR, episode);
  console.log(JSON.stringify(mix, null, 2));

  if (mix.mixed) {
    episode.audio.file = mix.file;
    episode.audio.mix = mix;
    await writeFile(jsonPath, JSON.stringify(episode, null, 2));
    console.log(`\n\x1b[32m✓ Episode JSON updated:\x1b[0m ${jsonPath}`);
    console.log("Refresh /english/ in browser to hear the new mix.");
  } else {
    console.log(`\n\x1b[33m⚠ Mix skipped:\x1b[0m ${mix.reason}`);
  }
}

main().catch((e) => {
  console.error("\x1b[31m✗ Remix failed:\x1b[0m", e.message);
  process.exit(1);
});
