// Rapid TTS test harness. Outputs raw WAV to /tmp so user can A/B voice configs
// without the full pipeline (no writer/editor/poster/whisper/mixer).
//
// Usage:
//   node --env-file=.env pipeline/tts-test.mjs --voices=Sulafat,Puck
//   node --env-file=.env pipeline/tts-test.mjs --voices=Aoede,Charon --model=gemini-2.5-flash-preview-tts
//   node --env-file=.env pipeline/tts-test.mjs --voices=Kore,Fenrir --directive=verbose
//
// Flags:
//   --voices=A,B      (required) Speaker A=female-like, Speaker B=male-like
//   --model=...       Defaults to gemini-3.1-flash-tts-preview
//   --directive=...   "default" (current prod prompt) | "minimal" (just dialogue) | "verbose" (extra natural cues)
//   --label=...       Custom suffix for output filename

import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "tts-tests");

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.join("=") || true];
  })
);

if (!args.voices) {
  console.error("Usage: --voices=VoiceA,VoiceB [--model=...] [--directive=default|minimal|verbose] [--label=...]");
  process.exit(1);
}

const [voiceA, voiceB] = args.voices.split(",").map((s) => s.trim());
const MODEL = args.model || "gemini-3.1-flash-tts-preview";
const DIRECTIVE = args.directive || "default";
const LABEL = args.label || "";

// Fixed test dialogue — same every time so user compares only voice/model differences.
const DIALOGUE = [
  { speaker: "Sarah", text: "Hey Alex, settling in okay? It's been a few days now." },
  { speaker: "Alex",  text: "Yeah, getting there. The new platform's pretty different from what I'm used to, you know?" },
  { speaker: "Sarah", text: "Totally. Took me a couple of weeks too. What's the trickiest part so far?" },
  { speaker: "Alex",  text: "Honestly, just figuring out where everything lives. So many internal tools." },
  { speaker: "Sarah", text: "Right, that's the worst. Drop me a message anytime — I can give you the shortcuts." },
  { speaker: "Alex",  text: "Oh that would be amazing, thanks Sarah! I'll definitely take you up on that." },
];

const DIRECTIVES = {
  default: `Voice this as a REAL conversation between real people — natural, unforced, conversational. NOT theatrical. NOT a narrator. NOT a podcast host performing.

CRITICAL — sound natural:
- Speak the way coworkers actually talk: relaxed pacing, light fillers if written, real pauses where punctuation suggests.
- Honor punctuation as the primary performance cue: em-dash = mid-thought break, ellipsis = trailing off, ? = genuine upward inflection, ! = mild emphasis (NOT shouting).
- Distinct vibe per character but stay grounded.
- Avoid: forced laughs, fake sighs, exaggerated reactions, "theater voice".`,
  minimal: ``,
  verbose: `Speak this as a casual coffee chat between two coworkers. Voices are warm, natural, relaxed. Each speaker has unhurried flow, normal volume, no compression or strain — speak FREELY, not stiffly. Punctuation suggests phrasing, not abrupt cuts. Let words flow.`,
};

const directive = DIRECTIVES[DIRECTIVE] ?? DIRECTIVES.default;

const lines = DIALOGUE.map((l) => `${l.speaker}: ${l.text}`).join("\n");
const promptText = directive ? `${directive}\n\n--- DIALOGUE ---\n${lines}` : lines;

const voiceMap = { Sarah: voiceA, Alex: voiceB };

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

async function callGeminiTts() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
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
  const inline = data.candidates?.[0]?.content?.parts?.[0]?.inlineData;
  if (!inline?.data) throw new Error("Gemini TTS response missing audio data");
  const rate = parseInt(inline.mimeType?.match(/rate=(\d+)/)?.[1] ?? "24000");
  return { pcm: Buffer.from(inline.data, "base64"), rate };
}

const t0 = Date.now();
console.log(`▶ TTS test`);
console.log(`  voices: Sarah=${voiceA}, Alex=${voiceB}`);
console.log(`  model:  ${MODEL}`);
console.log(`  directive: ${DIRECTIVE}\n`);

try {
  const { pcm, rate } = await callGeminiTts();
  const wav = pcmToWav(pcm, rate);

  mkdirSync(OUT_DIR, { recursive: true });
  const parts = [voiceA, voiceB, MODEL.includes("3.1") ? "3.1" : "2.5", DIRECTIVE];
  if (LABEL) parts.push(LABEL);
  const fileName = `${parts.join("_")}.wav`;
  const outPath = join(OUT_DIR, fileName);
  writeFileSync(outPath, wav);

  const dur = Math.round((pcm.length / 2 / rate) * 10) / 10;
  console.log(`✓ ${outPath}`);
  console.log(`  ${Math.round(wav.length / 1024)} KB · ${dur}s · ${rate}Hz · ${Date.now() - t0}ms`);
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exit(1);
}
