// TTS agent — Gemini Flash TTS Preview with multi-speaker voices + style steering.
// Picks voice by character voiceProfile, builds enriched transcript with audio tags + scene brief.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const TTS_MODEL = process.env.GEMINI_TTS_MODEL || "gemini-2.5-flash-preview-tts";

// Voice characteristics → Gemini prebuilt voice names.
// Each profile maps to 2 candidates so episodes don't sound identical.
const VOICE_BY_PROFILE = {
  "junior-anxious":    ["Leda", "Callirrhoe"],     // young female, anxious tonality
  "junior-excited":    ["Fenrir", "Puck"],         // excitable
  "senior-calm":       ["Charon", "Sadaltager"],   // mature male, calm
  "senior-firm":       ["Kore", "Orus"],           // firm authority
  "tired-veteran":     ["Alnilam", "Achernar"],    // gruff, weathered
  "bright-friendly":   ["Aoede", "Autonoe"],       // warm, soft
  "stern-authority":   ["Orus", "Kore"],           // boss-like
  "youthful-curious":  ["Leda", "Sulafat"],        // young, inquisitive
};

const FALLBACK_VOICES = ["Kore", "Puck"];

function pickVoiceForProfile(profile, taken) {
  const candidates = VOICE_BY_PROFILE[profile] || FALLBACK_VOICES;
  const available = candidates.filter((v) => !taken.has(v));
  return (available[0] || candidates[0]);
}

function assignVoices(characters) {
  const map = {};
  const taken = new Set();
  for (const c of characters) {
    const v = pickVoiceForProfile(c.voiceProfile || "senior-calm", taken);
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
    .map((c) => `- ${c.name} (voice: ${voiceMap[c.name]}): ${c.role}. Vibe: ${c.voiceProfile || "neutral"}.`)
    .join("\n");

  const directive = `You are voicing a SCENE from a tech podcast, not reading a script. Make every line sound like a real human in a real moment — NOT a narrator, NOT a news anchor, NOT calm/measured.

CRITICAL DIRECTIVES:
- Vary energy and pacing dramatically: fast when stressed, slow when explaining, snappy on interjections.
- Include natural laughter, sighs, exhales, hesitations, audible thinking ("uh", "hm").
- Honor INTERRUPTIONS (mid-sentence cut-offs) — speakers can overlap, jump in, finish each other's sentences.
- Inject personality matching each character's vibe. A "tired-veteran" sounds gruff and dry. A "junior-excited" is fast and bright. A "senior-calm" has dry humor.
- Treat punctuation as performance cues: dashes = mid-thought breaks, ellipsis = trailing off, question marks = real upward inflection.
- Read [bracketed tags] as performance instructions, not literal words. E.g. [chuckles] = actually chuckle.
- Light banter and humor are welcome — engineers are people, not robots.

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
