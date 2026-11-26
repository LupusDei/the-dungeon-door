# Home screen dragon

Source frames and recipe for the two clips behind the home screen
(`ios/DungeonDoor/Resources/Home/`). Build-time art is generated with the owner's Runway API
account; in-game art (portraits, scenes) uses the AI Gateway instead.

| File | Made with | Notes |
| --- | --- | --- |
| `perch.png` | Runway `gemini_image3_pro`, ratio `768:1344` | The dragon on his summit. Also the still shown with Reduce Motion. |
| `flight.png` | Runway `gemini_image3_pro`, `perch.png` as reference image | Same dragon in flight. |
| `dragon-watcher.mp4` | Runway `h3_max` image-to-video, 768p, 8 s | First **and** last frame = `perch.png`, so it loops. |
| `dragon-return.mp4` | Runway `h3_max` image-to-video, 768p, 8 s | First frame `flight.png`, last frame `perch.png`, so it hands off to the loop. |

`h3_max` has no ratio setting: the clip follows the first frame's shape. Request body:
`{ model: "h3_max", promptText, promptImage: [{uri, position: "first"}, {uri, position: "last"}],
resolution: "768p", duration: 8 }` on `POST /v1/image_to_video`. Cost: 8 credits per second.

Encoding for the app (audio stripped; the loop drops its duplicate last frame):

```bash
ffmpeg -i watcher.mp4 -an -frames:v 191 -c:v libx264 -preset slow -crf 23 -pix_fmt yuv420p -movflags +faststart dragon-watcher.mp4
ffmpeg -i return.mp4  -an               -c:v libx264 -preset slow -crf 23 -pix_fmt yuv420p -movflags +faststart dragon-return.mp4
```

Prompts, in short: an ancient, colossal black dragon, old and wise, gold-edged obsidian scales,
deeply intelligent amber eyes, perched beside the ruins of his castle under a night storm; dragon
centred, open sky in the top fifth, dark cliffs in the bottom third (room for the title and the
controls). The loop asks for a locked-off camera, slow breathing, a turn of the head, drifting
embers, "ending in exactly the same pose". The arrival asks for a heavy-winged glide toward the
viewer, a landing on the summit, wings folding, the head turning to the viewer.

## Tap reactions and sound

Poking the dragon plays one of three 6-second `h3_max` clips over the loop
(`dragon-react-speak|fire|roar.mp4`). Each uses `perch.png` as first **and** last frame, so it fades
in from the loop and hands back on the loop's first frame. Prompts all start "Locked-off camera, no
camera movement" and end "settles back into his original perched pose, exactly as at the start":

- **speak**: lowers his head to the viewer until his face fills the frame, jaws moving as he speaks.
- **fire**: rears back, chest glowing, a torrent of fire into the storm clouds.
- **roar**: unfurls both wings and bellows at the sky as lightning splits the clouds.

`h3_max` clips come with their own audio track. The fire, roar and arrival effects
(`dragon-sfx-*.m4a`) are that native audio (it is in sync with the picture), faded and normalised.
The speak clip's native audio is not used; his voice plays instead.

**Voice.** An original voice designed from a text description with Runway's voice API
(`POST /v1/voices`, `from: {type: "text", model: "eleven_ttv_v3"}`), not a copy of any real
person's voice. Lines are spoken with `eleven_v3` (`speed: 0.85, stability: 0.5`), which accepts
stage directions such as `[low growl]`.

- Voice A (in the app), Runway voice id `ce5e6696-0e45-49bf-b0da-0d502eecaff8`: "An ancient,
  colossal dragon speaking. A very deep, resonant, gravelly bass male voice with a refined,
  aristocratic English accent. Slow, deliberate and unhurried, dripping with dark amusement and
  quiet menace. Rich chest resonance, a low rumbling growl beneath every word, crisp theatrical
  diction and a faint hiss on the sibilants. He sounds immense, old, wise and dangerous, as if
  speaking from the depths of a vast cavern."
- Voice B (alternate), id `4c537090-ef56-4764-87e5-fbf45fedb526`: "A huge, ancient creature with a
  subterranean bass voice: extremely low pitched, dark, velvety and rumbling, with cultured English
  diction…"

The lines and their captions live in `DragonDirector.swift`. Each raw line then goes through:

```bash
ffmpeg -i raw.mp3 -filter_complex "aresample=44100,highpass=f=45,asplit[a][b];\
[b]asetrate=44100*0.84,aresample=44100,atempo=1.190476,lowpass=f=2400,volume=0.32[low];\
[a][low]amix=inputs=2:normalize=0,bass=g=3:f=120:w=0.7,equalizer=f=2800:t=q:w=1.2:g=3,\
aecho=0.85:0.55:38|85|160:0.26|0.18|0.11,apad=pad_dur=0.7,\
acompressor=threshold=-18dB:ratio=3:attack=8:release=120:makeup=2,\
loudnorm=I=-15:TP=-1.5:LRA=9,alimiter=limit=0.89" -ac 1 -ar 44100 voice.wav
afconvert -f m4af -d aac -b 80000 voice.wav dragon-voice-NAME.m4a
```

(a darker copy three semitones down mixed underneath, a cavern echo, and a presence lift so he
survives phone speakers).

**Ambience.** `dragon-ambience.caf`: Runway `eleven_text_to_sound_v2`, 22 s with `loop: true`
("Night wind sweeping across a high mountain summit, distant rolling thunder, a deep ominous low
drone, and the slow, heavy breathing of an enormous sleeping beast"), then crossfaded tail-into-head
for a seamless loop and stored as AAC in CAF.

Costs (credits): reaction clips 48 each; voice design about 50 per voice; speech 1 per 50
characters; ambience 1 per second.
