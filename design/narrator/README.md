# The narrator's voice

The voice that reads scenes aloud in a game (`server/lib/voice.ts`; docs/dungeon-master.md, "The
narrator"). The brief, 2026-11-26: a deep voice, an old sage telling the tale. It is an original design:
a stock synthetic voice with our own direction, never an imitation of a real person or of a known
performance.

Unlike the dragon's lines (made once with Runway and shipped in the app), scenes are written during
play, so this voice is made at runtime through the AI Gateway, on demand, and kept on the server.

## What is live

| Setting | Value |
| --- | --- |
| `DD_VOICE_MODEL` | `google/gemini-3.8-flash-tts` |
| `DD_VOICE_NAME` | `Charon` |
| `DD_VOICE_STYLE` | the direction in `DEFAULT_VOICE_STYLE` (old storyteller, deep, gravelly, warm, a flowing pace) |

These are the defaults in code; the env vars change them with no app release.

## Candidates

All read the same 52-word passage (`npm run voice:check`). Pitch is the median fundamental of the voiced
frames, measured with an autocorrelation script; I cannot hear audio, so the choice by ear is the owner's.

| Sample | Model, voice | Length | Median pitch | Takes direction | A 900-character scene |
| --- | --- | --- | --- | --- | --- |
| `A-google-charon-slow` | gemini-3.8-flash-tts, Charon, "unhurried" | 32.5 s | 81 Hz | yes | about 2 cents |
| `B-google-charon-brisk` | the same, "as brisk as a newsreader" (live) | 25.9 s | 100 Hz | yes | 1.9 cents (measured) |
| `C-google-algenib-gravelly` | gemini-3.8-flash-tts, Algenib | 32.1 s | 92 Hz | yes | about 2 cents |
| `D-openai-onyx` | openai/tts-1-hd, onyx, speed 0.9 | 19.5 s | 86 Hz | no | 2.7 cents |
| `E-elevenlabs-george` | elevenlabs/eleven-v4, voice `JBFqnCBsd6RMkjVDRZzb` | 22.0 s | 121 Hz | audio tags only | 7.2 cents |
| `F-elevenlabs-bill` | elevenlabs/eleven-v4, voice `pqHfZKP75CvOlQylNhV4` | 23.3 s | 129 Hz | audio tags only | 7.2 cents |

Notes:

- Google's model follows the pace in the direction: "unhurried" gave 100 words a minute, "brisk as a
  newsreader" 120. It returns WAV (24 kHz mono, about 48 KB a second: 4 MB for an 83-second scene); the
  others return MP3 at a tenth of that.
- Google has no speed setting and no custom voices through the gateway: a prebuilt voice plus direction.
- To switch: set the three env vars on Vercel (for D, also `DD_VOICE_SPEED=0.9`). Scenes already read keep
  the voice they were read in.

## Trying another

```bash
cd server
npm run voice:check -- --out /tmp/try --voice Algenib
npm run voice:check -- --out /tmp/try --style "An old storyteller, deeper and slower, grave."
npm run voice:check -- --out /tmp/try --model openai/tts-1-hd --voice onyx --speed 0.9
```

Each run is one or a few real speech calls (a cent or two).
