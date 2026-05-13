// Align agent — uses OpenAI Whisper (CPU) to extract per-line start/end timestamps
// from the voice WAV, then maps Whisper's segments back to our known dialogue lines.
//
// Output: episode.audio.lineTimings = [{ lineIndex, start, end, durationSec }]
// The UI uses these to seek to a specific line on click and to loop a single line.
//
// Whisper is invoked via the CLI (~/.local/bin/whisper). Model: base.en (~150MB, CPU).
// Inference is ~25s for 80s audio. Runs once per episode generation.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync, mkdirSync, rmSync } from "node:fs";
import { join, basename, dirname } from "node:path";
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
    ],
    { maxBuffer: 50 * 1024 * 1024 },
  );
  const base = basename(wavPath).replace(/\.wav$/i, "");
  const jsonPath = join(outDir, `${base}.json`);
  const data = JSON.parse(readFileSync(jsonPath, "utf8"));
  rmSync(outDir, { recursive: true, force: true });
  return data.segments || [];
}

// Greedy alignment: walk Whisper segments and our lines in parallel.
// For each line, accumulate consecutive segments until their joined text covers
// ~enough of the line's normalized words.
function alignLinesToSegments(lines, segments) {
  const segs = segments.map((s) => ({ ...s, words: normalize(s.text).split(" ").filter(Boolean) }));
  const out = [];
  let segIdx = 0;
  for (let li = 0; li < lines.length; li++) {
    const lineWords = normalize(lines[li].text).split(" ").filter(Boolean);
    if (lineWords.length === 0) { out.push(null); continue; }

    const startSeg = segs[segIdx];
    if (!startSeg) { out.push(null); continue; }

    let acc = 0;
    let endSegIdx = segIdx;
    // Accumulate words until we cover ~90% of the line's word count
    while (endSegIdx < segs.length && acc < Math.max(1, Math.floor(lineWords.length * 0.9))) {
      acc += segs[endSegIdx].words.length;
      endSegIdx++;
    }
    const endSeg = segs[Math.min(endSegIdx - 1, segs.length - 1)];

    out.push({
      lineIndex: li,
      start: Number((startSeg.start || 0).toFixed(2)),
      end: Number((endSeg.end || startSeg.end || 0).toFixed(2)),
    });
    segIdx = endSegIdx;
  }
  return out.map((t, i) => t && { ...t, durationSec: Number((t.end - t.start).toFixed(2)) });
}

export async function alignAgent(episode, voiceWavPath, introDurationSec) {
  if (!(await hasWhisper())) {
    return { aligned: false, reason: "whisper not installed (~/.local/bin/whisper)" };
  }
  if (!existsSync(voiceWavPath)) {
    return { aligned: false, reason: `voice WAV not found: ${voiceWavPath}` };
  }
  const segments = await runWhisper(voiceWavPath);
  const timings = alignLinesToSegments(episode.dialogue.lines, segments);

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
    segmentCount: segments.length,
  };
}
