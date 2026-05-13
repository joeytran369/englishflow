// Daily English-for-Cloud episode generator.
// Pipeline: Planner → Writer → Editor → Vocab Extractor → write JSON
//
// Usage:
//   node pipeline/generate.mjs              # MOCK mode (default, no API key needed)
//   MOCK_MODE=false GEMINI_API_KEY=... node pipeline/generate.mjs

import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ask, MODE } from "./llm.mjs";
import { ttsAgent } from "./agents/tts.mjs";
import { mixerAgent } from "./agents/mixer.mjs";
import { alignAgent } from "./agents/align.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = join(__dirname, "..", "content");
const AUDIO_DIR = join(__dirname, "..", "public", "audio");
const BGM_DIR = join(__dirname, "..", "public", "bgm");

function log(step, msg) {
  console.log(`\x1b[36m[${step}]\x1b[0m ${msg}`);
}

async function plannerAgent() {
  log("1/7 PLANNER", "Picking topic + level + key concepts…");
  const scope = process.env.TOPIC_SCOPE;
  const levelHint = process.env.LEVEL_HINT;
  const prompt = `
You are a curriculum planner for Vietnamese cloud/SRE engineers learning English.
${scope ? `\nSCOPE — focus on this scenario: ${scope}` : "Pick ONE realistic on-the-job scenario (debugging, code review, on-call, sprint planning, incident, design review)."}
${levelHint ? `LEVEL — target ${levelHint} (CEFR).` : ""}
Return JSON: { topic, setting, level (A2/B1/B2/C1), keyConcepts: string[] }
`.trim();
  const plan = await ask("planner", prompt);
  log("1/7 PLANNER", `→ topic: ${plan.topic} | level: ${plan.level}`);
  return plan;
}

async function writerAgent(plan) {
  log("2/7 WRITER", "Drafting natural 2-speaker dialogue with personality…");
  const prompt = `
Write a SHORT natural dialogue (8-12 lines) between 2 engineers about: ${plan.topic} (${plan.setting}).
Level: ${plan.level}. Include these concepts: ${plan.keyConcepts.join(", ")}.

⚡ MOST IMPORTANT — make this feel like REAL PEOPLE talking, not a textbook:
- Use natural fillers: "uh", "yeah", "okay so", "wait wait wait", "hm", "I mean", "right right"
- Allow INTERRUPTIONS (mid-sentence cut-offs ending with "—" or "...")
- Mix line lengths: short interjections ("Yeah.", "What?!", "Hold on—") next to longer explanations
- Inject light HUMOR / banter where it fits the scene ("haha you broke prod again?", "classic")
- Reactions are physical: groans, chuckles, sighs of relief, surprise
- Characters have distinct vibes — one might be the sarcastic veteran, the other the eager junior
- Avoid corporate-speak. Engineers swear lightly, get frustrated, get giddy when things work.

Each character has a voiceProfile (pick from: "junior-anxious", "junior-excited", "senior-calm",
"senior-firm", "tired-veteran", "bright-friendly", "stern-authority", "youthful-curious").

Each line has:
- "emotion" (one word for documentation only: panicked|relieved|smug|exhausted|excited|deadpan|frustrated|playful|hesitant|focused)
- "tags" array — audio cues, USE SPARINGLY. RULES:
  • Most lines should have EMPTY tags [].
  • Maximum 2 lines per episode total may have a tag.
  • Only insert a tag when it is narratively essential — a single laugh after a joke,
    one weary sigh when the senior really is exhausted, a quick whisper when a character
    is being secretive. NEVER use the same tag twice in one episode.
  • Allowed values: ["sighs","chuckles","laughs","exhales","whispers","groans"].
  • Trust the writing itself + punctuation (—, ..., !, ?) to carry emotion. Tags are seasoning, not the meal.
- "vn" — Vietnamese translation, conversational tone (matches English vibe, preserves any audio tag as VN bracket like [thở dài], [cười khẽ]). Keep technical jargon in English when natural (kubectl, pod, IAM...).

"sceneBrief" — one sentence framing mood + energy level for the voice actor (e.g. "Casual chat, low-stakes, light banter" OR "Tense incident call, urgency rising").

Return JSON:
{
  "title": string,
  "sceneBrief": string,
  "characters": [{ "name", "role", "voiceProfile" }],
  "lines": [{ "speaker", "text", "vn", "emotion", "tags": [] }]
}
`.trim();
  const draft = await ask("writer", prompt);
  log("2/7 WRITER", `→ "${draft.title}" — ${draft.lines.length} lines, ${draft.characters.length} chars`);
  return draft;
}

async function editorAgent(draft, plan) {
  log("3/7 EDITOR", "Checking level + naturalness…");
  const prompt = `
Review this dialogue for level ${plan.level} fidelity and naturalness:
${JSON.stringify(draft, null, 2)}
Return JSON: { levelChecked, notes: string[], approved: boolean }
`.trim();
  const review = await ask("editor", prompt);
  log("3/7 EDITOR", `→ approved: ${review.approved} | ${review.notes.length} edit notes`);
  return review;
}

async function vocabAgent(draft) {
  log("4/7 VOCAB", "Extracting key terms + IPA + Vietnamese gloss…");
  const prompt = `
Extract 6-10 useful terms from this dialogue, prioritizing tech jargon + idioms.
${JSON.stringify(draft, null, 2)}
Return JSON array: [{term, ipa, vn, example}]
`.trim();
  const vocab = await ask("vocab", prompt);
  log("4/7 VOCAB", `→ ${vocab.length} terms extracted`);
  return vocab;
}

async function main() {
  const t0 = Date.now();
  console.log(`\n\x1b[1m▶ EnglishFlow pipeline (mode: ${MODE})\x1b[0m\n`);

  const plan = await plannerAgent();
  const draft = await writerAgent(plan);
  const review = await editorAgent(draft, plan);
  const vocab = await vocabAgent(draft);

  const episode = {
    id: process.env.EPISODE_ID || new Date().toISOString().slice(0, 10),
    generatedAt: new Date().toISOString(),
    mode: MODE,
    plan,
    dialogue: draft,
    editorReview: review,
    vocab,
  };

  log("5/7 TTS", "Generating multi-voice audio (Gemini TTS or skip)…");
  const audio = await ttsAgent(episode, AUDIO_DIR);
  episode.audio = audio;
  log(
    "5/7 TTS",
    audio.file
      ? `→ ${audio.file} · ${audio.sizeKb}KB · ${audio.durationSec}s · voices: ${Object.entries(audio.voiceMap).map(([k, v]) => `${k}=${v}`).join(", ")}`
      : `→ skipped (${audio.mode}) — ${audio.note}`
  );

  log("6/7 MIXER", "Mixing voice + background music…");
  if (audio.file) {
    const mix = await mixerAgent(
      join(AUDIO_DIR, audio.file),
      episode.id,
      AUDIO_DIR,
      BGM_DIR,
      episode,
    );
    episode.audio.mix = mix;
    log(
      "6/7 MIXER",
      mix.mixed
        ? `→ ${mix.file} · ${mix.sizeKb}KB · bgm: ${mix.bgmTrack} · layout: ${mix.layout}`
        : `→ skipped — ${mix.reason}`,
    );
    // If mixed, prefer the mp3 file for the UI
    if (mix.mixed) episode.audio.file = mix.file;
  } else {
    log("6/7 MIXER", "→ skipped (no voice file)");
  }

  log("7/7 ALIGN", "Running Whisper for per-line timestamps…");
  // Voice WAV is what Whisper transcribes; offset by intro sting duration so timings match final MP3
  const wavPath = join(AUDIO_DIR, `${episode.id}.wav`);
  const introSec = episode.audio?.mix?.intro?.durationSec ?? 0;
  const align = await alignAgent(episode, wavPath, introSec);
  episode.audio.align = align;
  if (align.aligned) {
    const okCount = align.lineTimings.filter(Boolean).length;
    log("7/7 ALIGN", `→ ${okCount}/${align.lineTimings.length} lines timed · ${align.segmentCount} Whisper segments · intro offset ${introSec}s`);
  } else {
    log("7/7 ALIGN", `→ skipped — ${align.reason}`);
  }

  await mkdir(CONTENT_DIR, { recursive: true });
  const outPath = join(CONTENT_DIR, `${episode.id}.json`);
  await writeFile(outPath, JSON.stringify(episode, null, 2));

  const ms = Date.now() - t0;
  console.log(`\n\x1b[32m✓ Episode saved:\x1b[0m ${outPath}`);
  console.log(`  duration: ${ms}ms | mode: ${MODE}\n`);
}

main().catch((e) => {
  console.error("\x1b[31m✗ Pipeline failed:\x1b[0m", e.message);
  process.exit(1);
});
