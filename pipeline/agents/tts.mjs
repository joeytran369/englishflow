// TTS agent — Gemini Flash TTS Preview with multi-speaker voices + style steering.
// Picks voice by character voiceProfile, builds enriched transcript with audio tags + scene brief.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Default: 2.5-flash-preview-tts. Despite 3.1-flash being newer, listening tests show 3.1 over-acts
// ("nhấn nhá giả tạo, gặn giọng") while 2.5 stays natural without forcing inflection.
// User preference confirmed via A/B test on 2026-05-15 (Sulafat+Fenrir).
const TTS_MODEL = process.env.GEMINI_TTS_MODEL || "gemini-2.5-flash-preview-tts";

// Gemini prebuilt voices grouped by gender, ranked by profile preference.
// Voice picker filters by character.gender FIRST, then picks within profile if possible.
//
// LEARNER-CLARITY filter: dropped voices documented as "breathy/soft/gentle/breezy/mature"
// because they cause volume drops + airy delivery that hurt comprehension for English learners:
//   Female dropped: Aoede (Breezy), Vindemiatrix (Gentle), Gacrux (Mature)
//   Male dropped:   Enceladus (Breathy), Achernar (Soft)
// Kept tones: Clear, Firm, Even, Smooth, Informative, Bright, Upbeat, Warm, Friendly.
// Validation from listening tests (2026-05-15):
//   ✓ Sulafat+Fenrir (new-colleague-coffee-chat) and Aoede+Puck (coffee-break-balance-act) confirmed natural
//   ✓ Breezy/Soft voices like Aoede are actually GOOD when paired with flowing line writing
// Lesson: voice pool isn't the main lever for naturalness — line LENGTH and FLOW is.
const VOICES = {
  female: {
    "junior-anxious":    ["Leda", "Erinome", "Callirrhoe"],
    "junior-excited":    ["Sadachbia", "Despina", "Laomedeia"],
    "senior-calm":       ["Aoede", "Sulafat", "Autonoe"],
    "senior-firm":       ["Kore", "Pulcherrima", "Autonoe"],
    "tired-veteran":     ["Vindemiatrix", "Gacrux", "Autonoe"],
    "bright-friendly":   ["Sulafat", "Laomedeia", "Sadachbia"],
    "stern-authority":   ["Kore", "Pulcherrima", "Gacrux"],
    "youthful-curious":  ["Leda", "Sadachbia", "Sulafat"],
    _pool: ["Sulafat", "Aoede", "Sadachbia", "Erinome", "Kore", "Laomedeia", "Callirrhoe", "Autonoe", "Despina", "Pulcherrima", "Schedar", "Leda", "Vindemiatrix", "Gacrux", "Zephyr"],
  },
  male: {
    "junior-anxious":    ["Puck", "Achird", "Zubenelgenubi"],
    "junior-excited":    ["Fenrir", "Puck", "Achird"],
    "senior-calm":       ["Charon", "Sadaltager", "Umbriel"],
    "senior-firm":       ["Iapetus", "Orus", "Alnilam"],
    "tired-veteran":     ["Alnilam", "Achernar", "Algenib"],
    "bright-friendly":   ["Achird", "Enceladus", "Algieba"],
    "stern-authority":   ["Iapetus", "Orus", "Rasalgethi"],
    "youthful-curious":  ["Puck", "Achird", "Zubenelgenubi"],
    _pool: ["Fenrir", "Puck", "Charon", "Iapetus", "Achird", "Algieba", "Alnilam", "Orus", "Sadaltager", "Algenib", "Rasalgethi", "Zubenelgenubi", "Enceladus", "Achernar", "Umbriel"],
  },
};

function pickVoice(gender, profile, taken) {
  const g = gender === "female" ? "female" : "male"; // default male if missing
  const bank = VOICES[g];
  // Randomize within top-3 profile candidates for cross-episode variety. Fall back to
  // remaining profile picks then the full pool if those are taken.
  const top = (bank[profile] || []).filter((v) => !taken.has(v));
  if (top.length) return top[Math.floor(Math.random() * top.length)];
  const rest = bank._pool.filter((v) => !taken.has(v));
  if (rest.length) return rest[Math.floor(Math.random() * rest.length)];
  return bank._pool[0];
}

function assignVoices(characters) {
  const map = {};
  const taken = new Set();
  for (const c of characters) {
    const v = pickVoice(c.gender, c.voiceProfile || "senior-calm", taken);
    map[c.name] = v;
    taken.add(v);
  }
  return map;
}

function buildEnrichedPrompt(episode, voiceMap) {
  const { dialogue, plan } = episode;
  const brief = dialogue.sceneBrief || `${plan.setting}.`;

  // Character profile sentences
  const charLines = dialogue.characters
    .map((c) => `- ${c.name} (${c.gender || "?"}, voice: ${voiceMap[c.name]}): ${c.role}. Vibe: ${c.voiceProfile || "neutral"}.`)
    .join("\n");

  const directive = `Voice this as a REAL conversation between real people — natural, unforced, conversational. NOT theatrical. NOT a narrator. NOT a podcast host performing.

CRITICAL — sound natural:
- Speak the way coworkers actually talk: relaxed pacing, light fillers if written, real pauses where punctuation suggests.
- Honor punctuation as the primary performance cue: em-dash = mid-thought break, ellipsis = trailing off, ? = genuine upward inflection, ! = mild emphasis (NOT shouting).
- Bracketed cues like [sighs] or [chuckles] are RARE narrative beats. When you encounter one, make it SUBTLE and EARNED — never melodramatic, never repeated, never performative.
- Most lines have NO audio tags. Carry emotion through delivery, not sound effects.
- Distinct vibe per character but stay grounded: a "tired-veteran" is matter-of-fact and dry, NOT constantly sighing. A "junior-anxious" speaks slightly faster, NOT panting.
- Avoid: forced laughs, fake sighs, exaggerated reactions, "theater voice".

Scene: ${brief}

Characters:
${charLines}`;

  const lines = dialogue.lines.map((l) => {
    const tagPrefix = (l.tags && l.tags.length) ? `[${l.tags.join(", ")}] ` : "";
    return `${l.speaker}: ${tagPrefix}${l.text}`;
  }).join("\n");

  return `${directive}\n\n--- DIALOGUE ---\n${lines}`;
}

function pcmToWav(pcm, sampleRate, channels = 1, bitsPerSample = 16) {
  const dataSize = pcm.length;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE((sampleRate * channels * bitsPerSample) / 8, 28);
  buf.writeUInt16LE((channels * bitsPerSample) / 8, 32);
  buf.writeUInt16LE(bitsPerSample, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  pcm.copy(buf, 44);
  return buf;
}

async function callGeminiTts(promptText, voiceMap, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${TTS_MODEL}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ parts: [{ text: promptText }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        multiSpeakerVoiceConfig: {
          speakerVoiceConfigs: Object.entries(voiceMap).map(([speaker, v]) => ({
            speaker,
            voiceConfig: { prebuiltVoiceConfig: { voiceName: v } },
          })),
        },
      },
    },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Gemini TTS HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const part = data.candidates?.[0]?.content?.parts?.[0];
  const inline = part?.inlineData;
  if (!inline?.data) throw new Error("Gemini TTS response missing audio data");
  const rate = parseInt(inline.mimeType?.match(/rate=(\d+)/)?.[1] ?? "24000");
  return { pcm: Buffer.from(inline.data, "base64"), rate };
}

export async function ttsAgent(episode, outDir) {
  const apiKey = process.env.GEMINI_API_KEY;
  const mode = process.env.MOCK_MODE !== "false" ? "MOCK" : "GEMINI";

  const voiceMap = assignVoices(episode.dialogue.characters);

  if (mode === "MOCK" || !apiKey) {
    return {
      mode: "MOCK",
      voiceMap,
      file: null,
      note: !apiKey
        ? "GEMINI_API_KEY not set — UI will fall back to browser TTS."
        : "MOCK_MODE — skipping real TTS call.",
    };
  }

  const promptText = buildEnrichedPrompt(episode, voiceMap);
  const { pcm, rate } = await callGeminiTts(promptText, voiceMap, apiKey);
  const wav = pcmToWav(pcm, rate);

  await mkdir(outDir, { recursive: true });
  const fileName = `${episode.id}.wav`;
  await writeFile(join(outDir, fileName), wav);

  return {
    mode: "GEMINI",
    voiceMap,
    file: fileName,
    sizeKb: Math.round(wav.length / 1024),
    durationSec: Math.round((pcm.length / 2 / rate) * 10) / 10,
    model: TTS_MODEL,
    promptPreview: promptText.slice(0, 200) + "…",
  };
}
