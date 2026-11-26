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
| `G-eleven-v4-brian-deep-resonant` | eleven-v4, Brian `nPczCjzI2devNBz1zQrb` | 20.7 s | 95 Hz | audio tags only | 7.2 cents |
| `H-eleven-v4-callum-husky` | eleven-v4, Callum `N2lVS1w4EtoT3dr4eOWO` | 23.3 s | 114 Hz | audio tags only | 7.2 cents |
| `I-eleven-v4-daniel-british-broadcaster` | eleven-v4, Daniel `onwK4e9ZLuTAKqWW03F9` | 22.3 s | 114 Hz | audio tags only | 7.2 cents |
| `J-eleven-v4-adam-firm` | eleven-v4, Adam `pNInz6obpgDQGcFmaJgB` | 21.8 s | 113 Hz | audio tags only | 7.2 cents |
| `K-eleven-v4-brian-directed-low-gravelly` | eleven-v4, Brian, with audio tags | 21.6 s | 81 Hz | (directed) | about 8 cents |
| `L-eleven-v4-bill-directed-low-gravelly` | eleven-v4, Bill, with audio tags | 23.1 s | 116 Hz | (directed) | about 8 cents |
| `M-eleven-v4-george-directed-low-gravelly` | eleven-v4, George, with audio tags | 22.2 s | 107 Hz | (directed) | about 8 cents |

Notes:

- Google's model follows the pace in the direction: "unhurried" gave 100 words a minute, "brisk as a
  newsreader" 120. It returns WAV (24 kHz mono, about 48 KB a second: 4 MB for an 83-second scene); the
  others return MP3 at a tenth of that.
- Google has no speed setting and no custom voices through the gateway: a prebuilt voice plus direction.
- To switch: set the three env vars on Vercel (for D, also `DD_VOICE_SPEED=0.9`). Scenes already read keep
  the voice they were read in.

## ElevenLabs (checked 2026-11-26)

- **Eleven v4 is ElevenLabs' current flagship speech model** (`eleven_v4`, and `eleven_v4_turbo` for low
  latency, at half the price), per https://elevenlabs.io/docs/models. The AI Gateway offers both, as
  `elevenlabs/eleven-v4` and `elevenlabs/eleven-v4-turbo`. E to M above are v4.
- **Direction is written into the text** as audio tags, not sent as instructions (the gateway reports
  `instructions` as unsupported for ElevenLabs). K, L and M open with `[low, gravelly voice] [an old
  storyteller, slow and grave]` and mark the last line `[quietly, with dread]`. Tags are billed as characters.
- **Through the gateway only ElevenLabs' stock voices can be used** (its own account answers: 21 "default"
  voices, listed without a key at `GET https://api.elevenlabs.io/v1/voices`). ElevenLabs says these
  default voices **expire on 31 December 2026**, replaced by "Infinity" voices in its Voice Library, so a
  stock voice is not a lasting choice.
- **A voice of the game's own** needs an ElevenLabs account: Voice Design makes three previews from a
  description (model `eleven_ttv_v3`), and the one kept becomes a voice id in that account, as the dragon's
  voice was made through Runway. Using it at runtime means the owner's key: bring-your-own-key on the
  gateway, or a direct call. Not set up yet.

## Trying another

```bash
cd server
npm run voice:check -- --out /tmp/try --voice Algenib
npm run voice:check -- --out /tmp/try --style "An old storyteller, deeper and slower, grave."
npm run voice:check -- --out /tmp/try --model openai/tts-1-hd --voice onyx --speed 0.9
```

Each run is one or a few real speech calls (a cent or two).
