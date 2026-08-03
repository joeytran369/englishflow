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
import { posterAgent } from "./agents/poster.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = join(__dirname, "..", "content");
const AUDIO_DIR = join(__dirname, "..", "public", "audio");
const BGM_DIR = join(__dirname, "..", "public", "bgm");
const POSTERS_DIR = join(__dirname, "..", "public", "posters");

function log(step, msg) {
  console.log(`\x1b[36m[${step}]\x1b[0m ${msg}`);
}

// EnglishFlow curriculum — broad categories so audience isn't bound to Cloud only.
// Distribution target: 60% A2-B1 (easy, friendly), 30% B2, 10% C1.
const CATEGORIES = {
  "Cloud Tech":  ["incident debug", "code review", "sprint planning", "design review", "on-call handoff", "post-mortem"],
  "Career":      ["HR phone screen", "tech interview round", "salary negotiation", "1-on-1 with manager", "resigning gracefully", "asking for time off"],
  "Office Life": ["coffee chat with new colleague", "lunch invite", "elevator smalltalk", "team building event", "Friday afternoon banter", "sharing weekend plans"],
  "Life Admin":  ["opening a bank account", "doctor visit for a cold", "renting an apartment", "calling internet provider", "buying insurance", "returning a package"],
  "Travel":      ["airport check-in", "asking for directions", "ordering Uber/Grab", "exchanging money", "hotel complaint", "ordering unfamiliar food"],
  "Hobbies":     ["gym with personal trainer", "gaming session with friends", "movie night plans", "specialty coffee chat", "cycling/running together", "book recommendations"],
};

async function plannerAgent() {
  log("1/8 PLANNER", "Picking topic + level + key concepts…");
  const scope = process.env.TOPIC_SCOPE;
  const levelHint = process.env.LEVEL_HINT;
  // If scope matches a category name exactly, expose that category's sample scenarios as inspiration.
  const matchedCat = scope && CATEGORIES[scope] ? scope : null;
  const prompt = `
You are a curriculum planner for an English-learning podcast aimed at Vietnamese fans of Cloud tech.
Audience is broad: devs, SREs, sysadmins, SAs, support engineers, and anyone Cloud-adjacent.
Keep tone friendly, relatable, NOT headache-inducing. Default level is A2-B1 (easy to listen);
go B2 only when topic naturally needs it; C1 rarely.

CATEGORIES (pick exactly ONE and put it in the output as "category"):
${Object.entries(CATEGORIES).map(([k, v]) => `  • ${k}: ${v.join(", ")}, ...`).join("\n")}

${matchedCat
  ? `SCOPE — stay inside category "${matchedCat}". Pick one scenario (use the examples above for inspiration, or invent a similar one).`
  : scope
    ? `SCOPE — focus on this specific scenario: ${scope}. Pick the best-fitting category.`
    : `SCOPE — pick any category + scenario. Favor everyday/relatable over heavy tech.`}
${levelHint ? `LEVEL — target ${levelHint} (CEFR).` : "LEVEL — bias toward A2-B1 unless the topic clearly needs more."}

"energy" describes the natural pace + emotional register of the scene. It determines the TTS voice combo:
  • "high"   — light, lively, engaging (casual chats, banter, curiosity, enthusiasm, urgency). DEFAULT for most categories.
  • "medium" — focused, thoughtful (interviews, design reviews, professional discussions). Use only when topic clearly calls for it.
  • "low"    — slow, careful, polite (formal/transactional like bank teller, doctor visit, hotel complaint). Use sparingly.

Energy hints by category:
  Cloud Tech (incident/debug) → high (urgency) | code review → medium | post-mortem → medium
  Career (interview/promo/1-on-1) → medium | salary negotiation → medium
  Office Life (any scenario) → high (casual energy)
  Life Admin (bank/doctor/insurance) → low (transactional, polite)
  Travel (airport/directions/Grab) → high (curiosity, helpful)
  Hobbies (gym/gaming/movies) → high (shared enthusiasm)

Return JSON:
{
  "category": "Cloud Tech" | "Career" | "Office Life" | "Life Admin" | "Travel" | "Hobbies",
  "topic": string (concise scenario name),
  "setting": string (one sentence describing who + where + the moment),
  "level": "A2" | "B1" | "B2" | "C1",
  "energy": "high" | "medium" | "low",
  "keyConcepts": string[] (3-5 useful phrases/idioms/terms learners should pick up)
}
`.trim();
  const plan = await ask("planner", prompt);
  log("1/8 PLANNER", `→ [${plan.category || "?"}] ${plan.topic} | level: ${plan.level} | energy: ${plan.energy || "?"}`);
  return plan;
}

async function writerAgent(plan) {
  log("2/8 WRITER", "Drafting natural 2-speaker dialogue with personality…");
  const prompt = `
Write a SHORT natural dialogue (8-12 lines) between 2 people about: ${plan.topic} (${plan.setting}).
Category: ${plan.category || "general"}. Level: ${plan.level}. Energy: ${plan.energy || "high"}. Include these concepts: ${plan.keyConcepts.join(", ")}.

⚡ MOST IMPORTANT — make this feel like REAL PEOPLE talking, not a textbook:
- Lines should be MEDIUM-LENGTH and FLOWING (~80-140 chars typical), with multiple thoughts in one turn. AVOID choppy 1-3 word reactions stacked across many lines — sounds artificial when spoken.
- Use natural fillers: "uh", "yeah", "okay so", "hm", "I mean", "right right" — woven into flowing sentences, not as standalone lines.
- Occasional ellipsis "..." for natural trailing thoughts and em-dash "—" for self-corrections are FINE and natural. Don't over-use, but don't avoid either.
- Inject light HUMOR / banter where it fits the scene.
- Characters have distinct vibes — give them contrasting personalities (calm vs. anxious, dry vs. enthusiastic, etc.).
- Avoid corporate/textbook-speak. People are casual, get frustrated, get giddy when things work.
- Match register to category: Cloud Tech / Career = colleagues; Office Life = teammates/friends; Life Admin = customer + clerk; Travel = traveler + local/staff; Hobbies = friends.

Each character MUST have:
- "name" — international/Western names ONLY. Examples: Alex, Sam, Chris, Mike, Jamie, Ryan, Tom, Ben, Mia, Emma, Sofia, Olivia, Sarah, Lisa, Hannah. AVOID Vietnamese names (An, Bao, Linh, Khai, Minh, ...) and avoid culture-specific names that confuse voice casting.
- "gender" — "male" or "female" (REQUIRED). The TTS engine picks voice strictly by this field, so a "female" character will get a female voice. Get this right or voices will mismatch.
- "voiceProfile" — pick from: "junior-anxious", "junior-excited", "senior-calm", "senior-firm", "tired-veteran", "bright-friendly", "stern-authority", "youthful-curious".

⚡ VOICE PROFILE PAIRING — pick the combo that matches the scene energy. This drives TTS voice selection and is CRITICAL for natural delivery. Use this table:

  Energy=high (casual, lively, curious, urgent):
    • Office Life / Hobbies / Travel → "bright-friendly" + "junior-excited"  (warm energy contrast, like new-colleague-coffee-chat — known winner)
    • Cloud Tech incident/debug → "junior-anxious" + "senior-firm"  (tension + grounding)

  Energy=medium (focused, thoughtful):
    • Career interview/promo / Cloud Tech code+design review → "senior-firm" + "junior-excited"  OR  "bright-friendly" + "senior-firm"
    • Career 1-on-1 → "senior-calm" + "junior-excited"

  Energy=low (formal, polite, transactional):
    • Life Admin → "bright-friendly" + "youthful-curious"  (polite customer + friendly clerk)

  HARD RULE: NEVER pair "senior-calm" + "senior-calm" or two low-energy profiles together — produces flat, monotone audio. ALWAYS include at least ONE of: "bright-friendly", "junior-excited", "junior-anxious", "youthful-curious" in the pair.

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
- "vn" — Vietnamese translation, conversational tone (matches English vibe, preserves any audio tag as VN bracket like [thở dài], [cười khẽ]). Keep technical/brand terms in English when natural (kubectl, Uber, Netflix, IAM, K8s...).

"sceneBrief" — one sentence framing mood + energy level for the voice actor (e.g. "Casual chat, low-stakes, light banter" OR "Tense incident call, urgency rising").

Return JSON:
{
  "title": string,
  "sceneBrief": string,
  "characters": [{ "name", "role", "gender", "voiceProfile" }],
  "lines": [{ "speaker", "text", "vn", "emotion", "tags": [] }]
}
`.trim();
  const draft = await ask("writer", prompt);
  log("2/8 WRITER", `→ "${draft.title}" — ${draft.lines.length} lines, ${draft.characters.length} chars`);
  return draft;
}

async function editorAgent(draft, plan) {
  log("3/8 EDITOR", "Checking level + naturalness…");
  const prompt = `
Review this dialogue for level ${plan.level} fidelity and naturalness:
${JSON.stringify(draft, null, 2)}
Return JSON: { levelChecked, notes: string[], approved: boolean }
`.trim();
  const review = await ask("editor", prompt);
  log("3/8 EDITOR", `→ approved: ${review.approved} | ${review.notes.length} edit notes`);
  return review;
}

async function vocabAgent(draft, plan) {
  log("4/8 VOCAB", "Extracting key terms + IPA + Vietnamese gloss…");
  const prompt = `
Extract 6-10 useful terms from this dialogue.
Category: ${plan?.category || "general"}.
Priority: idioms + collocations + words a Vietnamese learner would actually want to reuse in that situation.
For Cloud Tech category include the tech jargon; for other categories prioritize everyday phrases over jargon.
${JSON.stringify(draft, null, 2)}
Return JSON array: [{term, ipa, vn, example}]
`.trim();
  const vocab = await ask("vocab", prompt);
  log("4/8 VOCAB", `→ ${vocab.length} terms extracted`);
  return vocab;
}

async function main() {
  const t0 = Date.now();
  console.log(`\n\x1b[1m▶ EnglishFlow pipeline (mode: ${MODE})\x1b[0m\n`);

  const plan = await plannerAgent();
  const draft = await writerAgent(plan);
  const review = await editorAgent(draft, plan);
  const vocab = await vocabAgent(draft, plan);

  function slugify(s) {
    return String(s)
      .toLowerCase()
      .normalize("NFKD").replace(/[̀-ͯ]/g, "")  // strip accents
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
  }
  const baseSlug = slugify(draft.title) || "episode";
  // If a file with that slug already exists, append a short suffix so we don't overwrite.
  let id = process.env.EPISODE_ID || baseSlug;
  if (!process.env.EPISODE_ID) {
    const { existsSync } = await import("node:fs");
    let n = 2;
    while (existsSync(join(CONTENT_DIR, `${id}.json`))) {
      id = `${baseSlug}-${n++}`;
    }
  }
  const episode = {
    id,
    publishedAt: new Date().toISOString(),
    generatedAt: new Date().toISOString(),
    mode: MODE,
    plan,
    dialogue: draft,
    editorReview: review,
    vocab,
  };

  log("5/8 POSTER", "Generating banner image (Gemini Image)…");
  const poster = await posterAgent(episode, POSTERS_DIR);
  episode.poster = poster;
  log("5/8 POSTER", poster.generated
    ? `→ ${poster.file} · ${poster.model}`
    : `→ skipped — ${poster.reason}`);

  log("6/8 TTS", "Generating multi-voice audio (Gemini TTS or skip)…");
  const audio = await ttsAgent(episode, AUDIO_DIR);
  episode.audio = audio;
  log(
    "6/8 TTS",
    audio.file
      ? `→ ${audio.file} · ${audio.sizeKb}KB · ${audio.durationSec}s · voices: ${Object.entries(audio.voiceMap).map(([k, v]) => `${k}=${v}`).join(", ")}`
      : `→ skipped (${audio.mode}) — ${audio.note}`
  );

  log("7/8 MIXER", "Mixing voice + background music…");
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
      "7/8 MIXER",
      mix.mixed
        ? `→ ${mix.file} · ${mix.sizeKb}KB · bgm: ${mix.bgmTrack} · layout: ${mix.layout}`
        : `→ skipped — ${mix.reason}`,
    );
    // If mixed, prefer the mp3 file for the UI
    if (mix.mixed) episode.audio.file = mix.file;
  } else {
    log("7/8 MIXER", "→ skipped (no voice file)");
  }

  log("8/8 ALIGN", "Running Whisper for per-line timestamps…");
  // Voice WAV is what Whisper transcribes; offset by intro sting duration so timings match final MP3
  const wavPath = join(AUDIO_DIR, `${episode.id}.wav`);
  const introSec = episode.audio?.mix?.intro?.durationSec ?? 0;
  const align = await alignAgent(episode, wavPath, introSec);
  episode.audio.align = align;
  if (align.aligned) {
    const okCount = align.lineTimings.filter(Boolean).length;
    log("8/8 ALIGN", `→ ${okCount}/${align.lineTimings.length} lines timed · ${align.segmentCount} Whisper segments · intro offset ${introSec}s`);
  } else {
    log("8/8 ALIGN", `→ skipped — ${align.reason}`);
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
