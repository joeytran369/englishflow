// Align agent — uses OpenAI Whisper word-level timestamps to extract per-line
// start/end times from the voice WAV, then maps Whisper's words to our known dialogue lines.
//
// Word-level alignment (vs segment-level) avoids the failure mode where Whisper groups
// multiple dialogue lines into one segment, starving later lines of timing data.
//
// Output: episode.audio.align.lineTimings = [{ lineIndex, start, end, durationSec }]

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync, mkdirSync, rmSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir, tmpdir } from "node:os";

const execFileP = promisify(execFile);

const WHISPER_BIN = process.env.WHISPER_BIN || join(homedir(), ".local/bin/whisper");
const WHISPER_MODEL = process.env.WHISPER_MODEL || "base.en";

function normalize(s) {
  return s
    .toLowerCase()
    .replace(/\[[^\]]+\]/g, " ")     // drop audio tags like [sighs]
    .replace(/\*+/g, "")              // drop markdown emphasis
    .replace(/[—–\-,.!?:;'"`*()…]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokensOf(s) {
  return normalize(s).split(" ").filter(Boolean);
}

async function hasWhisper() {
  if (!existsSync(WHISPER_BIN)) return false;
  try { await execFileP(WHISPER_BIN, ["--help"]); return true; }
  catch { return false; }
}

async function runWhisper(wavPath) {
  const outDir = join(tmpdir(), `whisper-${Date.now()}`);
  mkdirSync(outDir, { recursive: true });
  await execFileP(
    WHISPER_BIN,
    [
      wavPath,
      "--model", WHISPER_MODEL,
      "--language", "en",
      "--output_format", "json",
      "--output_dir", outDir,
      "--fp16", "False",
      "--verbose", "False",
      "--word_timestamps", "True",
    ],
    { maxBuffer: 50 * 1024 * 1024 },
  );
  const base = basename(wavPath).replace(/\.wav$/i, "");
  const jsonPath = join(outDir, `${base}.json`);
  const data = JSON.parse(readFileSync(jsonPath, "utf8"));
  rmSync(outDir, { recursive: true, force: true });
  return data;
}

// Flatten Whisper output into [{word, start, end}, ...] across all segments.
// Contractions ("It's", "don't") split into multiple tokens after normalization
// — we proportionally split the time range so each subtoken gets a timestamp.
function flattenWords(whisperJson) {
  const out = [];
  function push(rawText, start, end) {
    const toks = normalize(rawText || "").split(" ").filter(Boolean);
    if (!toks.length) return;
    const dur = (end - start) / toks.length;
    toks.forEach((t, i) => out.push({
      word: t,
      start: start + i * dur,
      end: start + (i + 1) * dur,
    }));
  }
  for (const seg of whisperJson.segments || []) {
    if (seg.words?.length) {
      for (const w of seg.words) push(w.word, w.start, w.end);
    } else {
      push(seg.text, seg.start, seg.end);
    }
  }
  return out;
}

// Sliding-window match: find the best contiguous run of Whisper words starting at/after
// `from` that matches the line's expected word sequence. Returns {firstIdx, lastIdx} or null.
function matchLine(lineTokens, whisperWords, from) {
  const need = lineTokens.length;
  if (!need) return null;
  const minCover = Math.max(1, Math.ceil(need * 0.35)); // ≥35% word matches — Whisper drops fillers

  let best = null;
  // Try anchoring on each potential starting word within a window.
  const maxStart = Math.min(whisperWords.length - 1, from + Math.max(20, need * 3));
  for (let i = from; i <= maxStart; i++) {
    if (whisperWords[i].word !== lineTokens[0]) continue;

    // Greedy walk: line cursor advances on match, whisper cursor always advances.
    let li = 0, wi = i, hits = 0, lastHit = i;
    const limit = Math.min(whisperWords.length, i + need * 4 + 10);
    while (li < need && wi < limit) {
      if (whisperWords[wi].word === lineTokens[li]) {
        hits++;
        lastHit = wi;
        li++; wi++;
      } else {
        // Skip a whisper word OR skip a line word — pick whichever advances the cleanest.
        // Cheap heuristic: peek ahead — if next whisper word matches current line token, skip whisper word; else skip line word.
        if (wi + 1 < whisperWords.length && whisperWords[wi + 1].word === lineTokens[li]) {
          wi++;
        } else {
          li++;
        }
      }
    }
    if (hits >= minCover && (!best || hits > best.hits)) {
      best = { firstIdx: i, lastIdx: lastHit, hits };
    }
  }
  return best;
}

function alignLinesToWords(lines, whisperWords) {
  const raw = [];
  let cursor = 0;
  for (let li = 0; li < lines.length; li++) {
    const lineTokens = tokensOf(lines[li].text);
    if (!lineTokens.length) { raw.push(null); continue; }

    const m = matchLine(lineTokens, whisperWords, cursor);
    if (!m) { raw.push(null); continue; }

    raw.push({
      lineIndex: li,
      start: whisperWords[m.firstIdx].start,
      end: whisperWords[m.lastIdx].end,
    });
    cursor = m.lastIdx + 1;
  }

  // Fallback: fill nulls by linear interpolation between known neighbors.
  // Without this, the UI gets stuck on the last matched line as audio plays past it.
  const totalEnd = whisperWords[whisperWords.length - 1]?.end ?? 0;
  const totalStart = whisperWords[0]?.start ?? 0;
  // Compute proportional positions for unmatched lines by word count.
  const lineWordCounts = lines.map((l) => tokensOf(l.text).length || 1);
  const cumulative = [];
  let sum = 0;
  for (const c of lineWordCounts) { sum += c; cumulative.push(sum); }
  const totalWords = sum || 1;

  for (let i = 0; i < raw.length; i++) {
    if (raw[i]) continue;
    // Find previous known timing and next known timing
    let prev = null, next = null;
    for (let j = i - 1; j >= 0; j--) if (raw[j]) { prev = raw[j]; break; }
    for (let j = i + 1; j < raw.length; j++) if (raw[j]) { next = raw[j]; break; }
    const prevEnd = prev ? prev.end : totalStart;
    const nextStart = next ? next.start : totalEnd;
    // Distribute the gap proportionally by word count among the consecutive nulls.
    // Simple: just allocate by position within the null-run.
    let runStart = i, runEnd = i;
    while (runEnd + 1 < raw.length && !raw[runEnd + 1]) runEnd++;
    const runLen = runEnd - runStart + 1;
    const slot = (nextStart - prevEnd) / runLen;
    for (let k = runStart; k <= runEnd; k++) {
      raw[k] = {
        lineIndex: k,
        start: prevEnd + (k - runStart) * slot,
        end: prevEnd + (k - runStart + 1) * slot,
        interpolated: true,
      };
    }
    i = runEnd; // skip past the run
  }

  return raw.map((t) => t && {
    ...t,
    start: Number(t.start.toFixed(2)),
    end: Number(t.end.toFixed(2)),
    durationSec: Number((t.end - t.start).toFixed(2)),
  });
}

export async function alignAgent(episode, voiceWavPath, introDurationSec) {
  if (!(await hasWhisper())) {
    return { aligned: false, reason: "whisper not installed (~/.local/bin/whisper)" };
  }
  if (!existsSync(voiceWavPath)) {
    return { aligned: false, reason: `voice WAV not found: ${voiceWavPath}` };
  }
  const whisperJson = await runWhisper(voiceWavPath);
  const words = flattenWords(whisperJson);
  const timings = alignLinesToWords(episode.dialogue.lines, words);

  // Voice WAV doesn't include intro sting; offset by introDurationSec so timings
  // match the FINAL mixed MP3 (which has intro prepended).
  const offset = introDurationSec || 0;
  const offsetTimings = timings.map((t) => t && {
    ...t,
    start: Number((t.start + offset).toFixed(2)),
    end: Number((t.end + offset).toFixed(2)),
  });

  return {
    aligned: true,
    model: WHISPER_MODEL,
    introOffsetSec: offset,
    lineTimings: offsetTimings,
    segmentCount: (whisperJson.segments || []).length,
    wordCount: words.length,
  };
}
