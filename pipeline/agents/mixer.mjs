// Mixer agent — TV-show style stings: short transition music before + after the dialogue.
// Voice stays CLEAN (no music bed under voice).
//
// Layout:  [INTRO_STING 3s, faded] → [voice clean] → [OUTRO_STING 3s, faded]
//
// Track selection:
//   1. Skip files starting with "_"  (disabled / placeholder)
//   2. Smart pick by filename keyword + scene mood (planner output)
//   3. If no good match: fall back to DEFAULT_TRACK
//
// Auto-trim: clips a 3s segment from a random offset of each chosen track.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const execFileP = promisify(execFile);

const STING_DURATION = 5.0;
const FADE_IN = 0.4;
const FADE_OUT = 0.8;
const MIN_TRACK_DURATION = 8;

// Fallback when smart selection can't decide.
const DEFAULT_TRACK =
  process.env.BGM_DEFAULT || "faderproducer-intro-530690.mp3";

// Keywords used to score tracks vs scene mood.
const TRACK_TAGS = {
  intro:     ["intro", "opener", "opening", "open", "start", "begin", "title"],
  outro:     ["outro", "end", "ending", "credits", "closing", "out", "fadeout"],
  bumper:    ["bumper", "sting", "transition", "swoosh", "logo", "stinger"],
  calm:      ["calm", "ambient", "soft", "mellow", "lofi", "lo-fi", "chill", "peaceful", "gentle", "warm"],
  tense:     ["tense", "dark", "urgent", "thriller", "suspense", "ominous", "danger", "alert", "mysterious", "mystery"],
  energetic: ["energetic", "upbeat", "bright", "happy", "fun", "uplifting", "epic", "action", "positive", "powerful", "rhythmic", "driving", "success", "inspiring"],
  corporate: ["corporate", "business", "professional", "office", "vlog", "travel", "summer", "brighter"],
  podcast:   ["podcast", "news", "broadcast", "talkshow", "show", "report"],
  cinematic: ["cinematic", "movie", "trailer", "documentary", "score"],
};

// Map scene mood → preferred track tags (order = priority).
function tagsForMood(mood) {
  switch (mood) {
    case "on-call":
    case "incident":
    case "outage":     return ["tense", "podcast", "cinematic"];
    case "interview":  return ["podcast", "corporate", "energetic"];
    case "review":     return ["calm", "podcast", "corporate"];
    case "sprint":
    case "standup":    return ["energetic", "corporate", "podcast"];
    case "design":     return ["calm", "cinematic", "corporate"];
    default:           return ["podcast", "corporate", "energetic"];
  }
}

function inferTrackTags(filename) {
  const name = filename.toLowerCase();
  const out = new Set();
  for (const [tag, keywords] of Object.entries(TRACK_TAGS)) {
    if (keywords.some((k) => name.includes(k))) out.add(tag);
  }
  return out;
}

// Score how well a track matches a slot ("intro" or "outro") + scene mood.
function scoreTrack(trackTags, slot, moodTags) {
  let score = 0;
  if (trackTags.has(slot)) score += 5;            // direct slot match
  for (let i = 0; i < moodTags.length; i++) {
    if (trackTags.has(moodTags[i])) score += 3 - i; // mood match weighted by priority
  }
  return score;
}

async function hasFfmpeg() {
  try { await execFileP("ffmpeg", ["-version"]); return true; }
  catch { return false; }
}

async function probeDuration(filePath) {
  try {
    const { stdout } = await execFileP("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]);
    return parseFloat(stdout.trim());
  } catch { return 0; }
}

function listBgm(bgmDir) {
  if (!existsSync(bgmDir)) return [];
  return readdirSync(bgmDir)
    .filter((f) => /\.(mp3|wav|ogg|m4a|flac)$/i.test(f))
    .filter((f) => !f.startsWith("_"));   // "_" prefix = disabled
}

function pickOffset(trackDuration) {
  if (trackDuration <= MIN_TRACK_DURATION) return 0;
  const max = Math.max(0, trackDuration - STING_DURATION - 1);
  return Math.random() * max;
}

function pickForSlot(tracks, slot, moodTags, excludeFile) {
  const scored = tracks
    .filter((t) => t.file !== excludeFile)
    .map((t) => ({ ...t, score: scoreTrack(t.tags, slot, moodTags) }))
    .sort((a, b) => b.score - a.score);

  // Best match if score > 0
  if (scored.length && scored[0].score > 0) {
    // Pick uniformly among top-tier (ties)
    const top = scored.filter((t) => t.score === scored[0].score);
    return top[Math.floor(Math.random() * top.length)];
  }

  // Fallback: default track if present
  const fallback = tracks.find((t) => t.file === DEFAULT_TRACK);
  if (fallback) return { ...fallback, score: 0, fallback: true };

  // Last resort: random
  return tracks[Math.floor(Math.random() * tracks.length)];
}

function deriveSceneMood(episode) {
  const text = `${episode.plan?.topic} ${episode.plan?.setting} ${episode.dialogue?.sceneBrief || ""}`.toLowerCase();
  if (/on[- ]?call|incident|outage|paged|alert|p1|crash/.test(text)) return "on-call";
  if (/interview/.test(text)) return "interview";
  if (/review|pr|merge|pull request/.test(text)) return "review";
  if (/sprint|standup|planning/.test(text)) return "sprint";
  if (/design|architecture/.test(text)) return "design";
  return "default";
}

export async function mixerAgent(voiceWavPath, episodeId, outDir, bgmDir, episode = {}) {
  if (!(await hasFfmpeg())) {
    return { mixed: false, reason: "ffmpeg not installed" };
  }
  const files = listBgm(bgmDir);
  if (files.length === 0) {
    return { mixed: false, reason: `no music tracks in ${bgmDir}` };
  }

  // Build track index with inferred tags
  const tracks = files.map((f) => ({ file: f, tags: inferTrackTags(f) }));

  const mood = deriveSceneMood(episode);
  const moodTags = tagsForMood(mood);

  const intro = pickForSlot(tracks, "intro", moodTags, null);
  const outro = pickForSlot(tracks, "outro", moodTags, intro.file);

  const introPath = join(bgmDir, intro.file);
  const outroPath = join(bgmDir, outro.file);

  const introDur = await probeDuration(introPath);
  const outroDur = await probeDuration(outroPath);
  const introOffset = pickOffset(introDur);
  const outroOffset = pickOffset(outroDur);

  const outFile = join(outDir, `${episodeId}.mp3`);

  const filter = [
    `[0:a]atrim=start=${introOffset.toFixed(2)}:duration=${STING_DURATION},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=${FADE_IN},afade=t=out:st=${(STING_DURATION - FADE_OUT).toFixed(2)}:d=${FADE_OUT}[intro]`,
    `[2:a]atrim=start=${outroOffset.toFixed(2)}:duration=${STING_DURATION},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=${FADE_IN},afade=t=out:st=${(STING_DURATION - FADE_OUT).toFixed(2)}:d=${FADE_OUT}[outro]`,
    `[intro][1:a][outro]concat=n=3:v=0:a=1[out]`,
  ].join(";");

  await execFileP("ffmpeg", [
    "-y",
    "-i", introPath,
    "-i", voiceWavPath,
    "-i", outroPath,
    "-filter_complex", filter,
    "-map", "[out]",
    "-b:a", "192k",       // bumped from 96k — 96k introduced "compressed/strained" speech artifacts
    "-ac", "1",
    "-ar", "44100",       // standard MP3 sample rate (avoids odd 24kHz→44.1k resampling drift)
    outFile,
  ]);

  const stat = statSync(outFile);

  return {
    mixed: true,
    file: `${episodeId}.mp3`,
    sizeKb: Math.round(stat.size / 1024),
    sceneMood: mood,
    moodTags,
    intro: {
      track: intro.file,
      tags: [...intro.tags],
      score: intro.score,
      fallback: intro.fallback || false,
      offsetSec: Math.round(introOffset * 10) / 10,
      durationSec: STING_DURATION,
    },
    outro: {
      track: outro.file,
      tags: [...outro.tags],
      score: outro.score,
      fallback: outro.fallback || false,
      offsetSec: Math.round(outroOffset * 10) / 10,
      durationSec: STING_DURATION,
    },
    layout: `${STING_DURATION}s intro sting · voice (clean) · ${STING_DURATION}s outro sting`,
  };
}
