// Poster agent — generates a category-themed banner image.
// Provider can be:
//   - "pollinations" (default, FREE, no API key) — uses pollinations.ai
//   - "gemini"                                   — uses Gemini Image (paid tier only)
//
// Output: public/posters/<slug>.png  (referenced as episode.poster.file)
// Falls back gracefully: if generation fails, episode keeps using gradient.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

// Default to Gemini now that billing is enabled (much better quality).
// Set POSTER_PROVIDER=pollinations to fall back to free option.
const PROVIDER = process.env.POSTER_PROVIDER || "gemini";

// Final banner aspect (must match UI's aspect-[5/2] container).
const TARGET_W = 1280;
const TARGET_H = 512;

// All palettes use BRIGHT PASTEL tones so posters look airy/cheerful (not dark/heavy).
const STYLE_BY_CATEGORY = {
  "Cloud Tech":  "BRIGHT pastel sky blue + soft lavender + mint accent, airy light background (NOT dark)",
  "Career":      "BRIGHT mint + soft seafoam + cream pastel, optimistic light background",
  "Office Life": "BRIGHT peach + cream + soft coral pastel, sunny light cheerful background",
  "Life Admin":  "BRIGHT powder blue + soft mint + cream pastel, calm clean light background",
  "Travel":      "BRIGHT soft coral + sky blue + cream pastel, fresh airy light background",
  "Hobbies":     "BRIGHT lavender + soft pink + cream pastel, playful light background",
};

function buildPrompt(episode) {
  const cat = episode.plan?.category || "Cloud Tech";
  const style = STYLE_BY_CATEGORY[cat] || STYLE_BY_CATEGORY["Cloud Tech"];
  // Symbolic icon poster — no humans, no faces, no characters of any kind.
  // Image will be center-cropped to 5:2, so center the hero subject.
  return `Cute minimal icon-style illustration for a language-learning podcast banner.
Concept: ${episode.dialogue.sceneBrief || episode.plan.setting}.
Subject: ONE single chubby rounded ICONIC OBJECT representing the topic (e.g. a coffee cup, a plane, a laptop, a server rack, a suitcase, a clock, etc). The object is centered.
Style: ${style}. Soft pastel candy palette, mascot-style rounded shapes, gentle flat shading, subtle floating dots/sparkles in background, premium mobile-app aesthetic.
Background: soft single-tone pastel gradient, very airy, lots of negative space.
ABSOLUTE STRICT RULES (will fail review if violated):
  • NO humans of any kind. NO people. NO faces. NO eyes. NO hands. NO body parts. NO silhouettes.
  • NO animals with faces. NO mascot creatures.
  • NO text, NO letters, NO numbers, NO logos, NO writing, NO signatures, NO watermarks.
  • Just one inanimate object/icon, like a sticker.`;
}

// === Pollinations.ai (free) ===
async function generateViaPollinations(prompt) {
  const model = process.env.POLLINATIONS_MODEL || "flux";
  const w = 1280, h = 512;
  const seed = Math.floor(Math.random() * 1_000_000);
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${w}&height=${h}&seed=${seed}&nologo=true&model=${model}&enhance=true`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Pollinations ${res.status}: ${(await res.text()).slice(0, 150)}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return { mime: res.headers.get("content-type") || "image/jpeg", buf };
}

// === Gemini Image (paid) ===
async function generateViaGemini(prompt) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY required");
  const model = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 150)}`);
  const data = await res.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  const img = parts.find((p) => p.inlineData?.data);
  if (!img) throw new Error("No image in response");
  return { mime: img.inlineData.mimeType || "image/png", buf: Buffer.from(img.inlineData.data, "base64") };
}

async function generate(prompt) {
  const MAX = 3;
  for (let attempt = 0; attempt < MAX; attempt++) {
    try {
      return PROVIDER === "gemini"
        ? await generateViaGemini(prompt)
        : await generateViaPollinations(prompt);
    } catch (e) {
      const msg = String(e.message);
      const transient = /\b(429|500|502|503|504)\b/.test(msg);
      if (!transient || attempt === MAX - 1) throw e;
      const wait = (attempt + 1) * 6;
      console.log(`  \x1b[33m↻ image retry in ${wait}s (${msg.slice(0, 70)})\x1b[0m`);
      await new Promise((r) => setTimeout(r, wait * 1000));
    }
  }
}

export async function posterAgent(episode, postersDir) {
  await mkdir(postersDir, { recursive: true });
  const prompt = buildPrompt(episode);
  try {
    const { buf } = await generate(prompt);
    // Always normalize to TARGET_W x TARGET_H (5:2 banner) — Gemini returns 1024x1024,
    // Pollinations returns its requested ratio. cover-fit + center crop handles both.
    const out = await sharp(buf)
      .resize({ width: TARGET_W, height: TARGET_H, fit: "cover", position: "attention" })
      .png({ compressionLevel: 8 })
      .toBuffer();
    const file = `${episode.id}.png`;
    await writeFile(join(postersDir, file), out);
    return {
      generated: true,
      provider: PROVIDER,
      file,
      width: TARGET_W,
      height: TARGET_H,
      prompt,
      generatedAt: new Date().toISOString(),
    };
  } catch (e) {
    return { generated: false, provider: PROVIDER, reason: e.message };
  }
}
