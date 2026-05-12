# joeytran.dev

Personal portfolio with two routes:

- `/`            — career portfolio
- `/english/`    — **EnglishFlow**, an AI-agent demo that generates a daily
                   English-for-engineers dialogue with multi-voice audio +
                   bgm stings, all at build time.

## Stack

Astro 6 · Tailwind v4 · TypeScript · Node 22 · Gemini API · ffmpeg ·
deployable to GitHub Pages (zero runtime backend).

## EnglishFlow pipeline

A 6-step agent flow that runs once per day (locally or via GitHub Actions),
commits the result to the repo, and lets the static site render it.

```
[1] Planner    →  pick topic + setting + level + key concepts
[2] Writer     →  draft 8-12 line dialogue with personality, emotion, VN translation
[3] Editor     →  level + naturalness review
[4] Vocab      →  extract terms + IPA + VN gloss
[5] TTS        →  Gemini Flash TTS multi-speaker, voice picked by character profile
[6] Mixer      →  ffmpeg combines intro sting · clean voice · outro sting

content/YYYY-MM-DD.json  +  public/audio/YYYY-MM-DD.mp3  →  committed → deployed
```

The site itself never calls an LLM — all generation happens at build time.
Zero per-user cost, no rate limits, no backend.

## Run the pipeline

```bash
# Mock mode (no API key, returns canned output for layout testing)
node pipeline/generate.mjs

# Real Gemini run
export GEMINI_API_KEY="..."           # get free key at aistudio.google.com/apikey
MOCK_MODE=false node pipeline/generate.mjs

# Re-mix only (different bgm pick, reuses existing voice WAV — burns no quota)
node pipeline/remix.mjs
```

## Voice profiles → Gemini voices

The writer assigns each character a `voiceProfile` based on scene context;
the TTS agent maps that to one of Gemini's prebuilt voices:

| Profile             | Voice candidates       | Vibe                       |
| ------------------- | ---------------------- | -------------------------- |
| `junior-anxious`    | Leda, Callirrhoe       | young female, anxious      |
| `junior-excited`    | Fenrir, Puck           | excitable                  |
| `senior-calm`       | Charon, Sadaltager     | mature male, calm          |
| `senior-firm`       | Kore, Orus             | firm authority             |
| `tired-veteran`     | Alnilam, Achernar      | gruff, weathered           |
| `bright-friendly`   | Aoede, Autonoe         | warm, soft                 |
| `stern-authority`   | Orus, Kore             | boss-like                  |
| `youthful-curious`  | Leda, Sulafat          | young, inquisitive         |

The TTS prompt also includes a scene brief + character bios + audio tags
(`[chuckles]`, `[sighs]`, `[exhales]`, ...) inline with each line to steer
delivery into "real person, not narrator" territory.

## Background music

Drop royalty-free MP3 / WAV / OGG into `public/bgm/`. The mixer parses
filenames for mood keywords (`intro`, `outro`, `tense`, `mysterious`,
`energetic`, `podcast`, ...) and matches them against the scene mood
derived from the planner's output. If nothing matches, falls back to
`BGM_DEFAULT` (default `faderproducer-intro-530690.mp3`).

Files prefixed with `_` are skipped (use to disable a track without
deleting it).

## Development

```bash
npm install
npm run dev    # http://localhost:4321
npm run build  # static output → dist/
```

## License

MIT — code only. Background music in `public/bgm/` is third-party content
under its own license (check each file's source).
