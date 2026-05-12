# EnglishFlow

> Daily English for the Cloud team — short dialogues from real work moments.

**Live:** [joeytran369.github.io/englishflow](https://joeytran369.github.io/englishflow/)

---

An AI-agent pipeline that generates 1–2 minute English lessons for cloud / SRE /
DevOps engineers:

- Realistic on-the-job dialogues (incident debugging, code review, sprint, design
  review, ...) with banter, interruptions, audible reactions.
- Multi-voice **Gemini Flash TTS**, voice picked per character profile.
- **ffmpeg**-mixed intro / outro stings from a royalty-free music pool.
- Per-line Vietnamese translation, vocab cards with IPA + examples.

All content is generated **at build time** — the deployed site is fully static.
Zero runtime API calls, no backend, free on GitHub Pages.

## Architecture

```
[ Local CLI  or  GitHub Actions cron ]
        │
        ▼
[1] Planner   →  topic + level + key concepts
[2] Writer    →  dialogue with personality, emotion, VN translation
[3] Editor    →  CEFR level + naturalness review
[4] Vocab     →  key terms with IPA + Vietnamese gloss
[5] TTS       →  Gemini Flash multi-speaker (voice picked by character profile)
[6] Mixer     →  ffmpeg: intro sting + clean voice + outro sting → MP3
        │
        ▼
content/<slug>.json   +   public/audio/<slug>.mp3
        │
        ▼
Astro static build  →  GitHub Pages
```

## Quickstart

```bash
npm install

# Local dev preview
npm run dev          # http://localhost:4321

# Production build
npm run build        # → dist/
```

## Generate a new episode

```bash
# Real run — needs a free key from https://aistudio.google.com/apikey
export GEMINI_API_KEY="..."

EPISODE_ID=openstack-launch-vm \
TOPIC_SCOPE="An OpenStack operator helps a junior teammate launch their first VM \
  via the dashboard or CLI. Cover image selection, flavor, network, key-pair, \
  and verifying the instance boots." \
LEVEL_HINT=B1 \
MOCK_MODE=false \
  node pipeline/generate.mjs
```

Re-mix an existing episode with different background music (zero API cost):

```bash
node pipeline/remix.mjs <slug>
```

Mock mode (no API key, canned content for layout testing):

```bash
node pipeline/generate.mjs
```

## Deploy

```bash
npm run build
npx gh-pages -d dist --dotfiles
```

GitHub Pages auto-serves the `gh-pages` branch within ~30 seconds.

## Voice profile → Gemini voice

The writer assigns each character a profile based on the scene; the TTS agent maps
that profile to a Gemini prebuilt voice (two candidates per profile so consecutive
episodes don't sound identical).

| Profile             | Voice candidates       | Vibe                  |
| ------------------- | ---------------------- | --------------------- |
| `junior-anxious`    | Leda, Callirrhoe       | young, anxious        |
| `junior-excited`    | Fenrir, Puck           | excitable             |
| `senior-calm`       | Charon, Sadaltager     | mature, calm          |
| `senior-firm`       | Kore, Orus             | firm authority        |
| `tired-veteran`     | Alnilam, Achernar      | gruff, weathered      |
| `bright-friendly`   | Aoede, Autonoe         | warm, soft            |
| `stern-authority`   | Orus, Kore             | boss-like             |
| `youthful-curious`  | Leda, Sulafat          | young, inquisitive    |

The TTS prompt also includes a scene brief, character bios, and inline audio tags
(`[chuckles]`, `[sighs]`, `[exhales]`, ...) to push delivery into *real person,
not narrator* territory.

## Background music

Drop royalty-free **MP3 / WAV / OGG** files into `public/bgm/`. The mixer scores
each track against the scene mood (derived from planner output) by filename
keywords — `intro`, `outro`, `tense`, `mysterious`, `energetic`, `podcast`,
`corporate`, `cinematic` — and picks the best match. Falls back to a configurable
default track when nothing scores well.

Filenames prefixed with `_` are skipped (use to disable a track without
deleting it).

Recommended sources (royalty-free / CC0):

- [Pixabay Music](https://pixabay.com/music/)
- [YouTube Audio Library](https://studio.youtube.com)
- [Mixkit Free Stock Music](https://mixkit.co/free-stock-music/)

## Stack

Astro 6 · Tailwind v4 · TypeScript · Node 22 · Gemini API · ffmpeg · GitHub Pages

## License

MIT for code. Background music files under `public/bgm/` are third-party
content under their respective licenses — check each file's source.
