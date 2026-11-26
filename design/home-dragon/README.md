# Home screen dragon

Source frames and recipes for the clips, voice and sound behind the home screen
(`ios/DungeonDoor/Resources/Home/`). Build-time art is generated with the owner's Runway API
account; in-game art (portraits, scenes) uses the AI Gateway instead.

| File | Made with | Notes |
| --- | --- | --- |
| `perch.png` | Runway `gemini_image3_pro`, ratio `768:1344` | The dragon on his summit. Also the still shown with Reduce Motion. |
| `flight.png` | Runway `gemini_image3_pro`, `perch.png` as reference image | Same dragon in flight. |
| `empty.png` | Runway `gemini_image3_pro`, `perch.png` as reference image | Same summit with the dragon removed: first or last frame of every flight clip. |
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

## More reactions, and flights (app 0.2)

Seven more things he does when poked, made the same way. Four happen on the perch; three are
flights, where he leaves, the summit stands empty for a while, and he comes back carrying something
he looks over and drops off the cliff.

| File | `h3_max` 768p | First frame | Last frame |
| --- | --- | --- | --- |
| `dragon-react-ponder.mp4`, `-skygaze`, `-yawn`, `-smoke` | 8 s each | `perch.png` | `perch.png` |
| `dragon-depart.mp4` | 8 s | `perch.png` | `empty.png` |
| `dragon-empty.mp4` | 6 s, loops (157 of 158 frames) | `empty.png` | `empty.png` |
| `dragon-return-helm.mp4`, `-chest`, `-orb` | 10 s each | `empty.png` | `perch.png` |

A 6 s request comes back as 158 frames (6.58 s), an 8 s one as 192, a 10 s one as 243; `duration`
goes up to 15. Stills are 768x1376 and the video takes the middle 768x1344 of them. Encoding is the
same as above (`-an`, `libx264 -preset slow -crf 23`); the empty loop drops its duplicate last frame
with `-frames:v 157`.

**`empty.png`** was asked for as an edit of `perch.png`: "remove the dragon completely and leave
everything else exactly as it is", then a list of what must stay put (towers, cliffs, horizon,
clouds, moonlight, lightning, embers). Outside the dragon's outline it matches `perch.png` almost
pixel for pixel, which is what lets the flight clips cut to and from the perch clips.

**Prompts, in short.** Every one starts "Locked-off camera, no camera movement" and names "the
ancient, colossal black dragon with gold-edged obsidian scales and glowing amber eyes"; the four on
the perch end "settles back into his original perched pose, exactly as at the start".

- **ponder**: lowers his head and turns it to one side, studying the viewer with one eye; a slow
  blink; smoke from the nostrils. For lines that ask the player something.
- **skygaze**: lifts his head to the storm, eyes half closed, as lightning flickers; brings his gaze
  back down. For words of wisdom.
- **yawn**: an enormous yawn (rows of teeth, a furnace glow deep in the throat), both wings
  stretched wide and folded, a shake of the head.
- **smoke**: turns to face the camera and puffs one smoke ring straight at it, "seen face-on: a
  round, clear letter O", which grows until it passes around the edges of the frame and thins away.
  Without "face-on" the ring came out as a flat halo beside his head (first take, discarded).
- **empty loop**: the empty summit, "no dragon, no creature, no bird, no figure appears at any
  time"; clouds, distant lightning, embers, mist; "ending exactly as it began".
- **depart**: "unhurried and heavy", crouches, spreads his wings, lifts off with slow wing beats,
  climbs away from the viewer and vanishes into the clouds; "stays the same sharply detailed, scaled
  black dragon the whole time"; the summit is left empty. A 6 s first take turned him smooth and
  scale-less for half a second at the launch; 8 s and the slower wording fixed most of it.
- **returns**: a dark winged shape appears far off in the storm and glides in, carrying the thing in
  one front claw; he lands, folds his wings, regards it with one eye, drops it over the cliff edge
  where it tumbles out of sight; "his claws are empty"; settles into the perched pose. The things: a
  dented steel knight's great helm; a small iron-bound chest, lid open, spilling gold coins; a
  glowing crystal orb shining with pale blue light.

**Voice.** 26 more lines in voice A, same settings and the same chain as above: `wisdom-1…9` (the
skygaze clip, and every other turn of the speak clip), `ask-1…7` (ponder), `yawn-1,2`, `smoke-1,2`,
`leave-1…3` (said as he goes) and `return-helm|chest|orb` (said once the thing has gone over the
edge). Two wrinkles: where the AAC of a finished line touched full scale it was re-encoded up to
1.2 dB quieter (`volume=-1.2dB` after the limiter), and the two 1.3 s pauses that "..." put into
`smoke-2` were cut to 0.75 s in the raw take before processing.

**Sound.** Each clip's own audio track, as before, for the departure, the three returns, the yawn
and the smoke ring (`dragon-sfx-depart|return-helm|return-chest|return-orb|yawn|smoke.m4a`): a
0.15 s fade in, a fade out over the last second, then one fixed gain that brings it to -17 LUFS
(-21 for the smoke ring) without letting peaks pass -2 dBTP, and `afconvert -d aac -b 112000`.
The ponder and skygaze clips play silent under his voice, like the speak clip.
`dragon-sfx-distant-roar.m4a`, his answer when the empty summit is poked, is the roar out of
`dragon-sfx-roar.m4a` made far away:

```bash
ffmpeg -i sfx-roar.wav -af "atrim=1.2:5.2,asetpts=PTS-STARTPTS,highpass=f=70,lowpass=f=1100,\
aecho=0.8:0.7:190|340|560:0.45|0.32|0.2,apad=pad_dur=1.0,afade=t=in:st=0:d=0.35,\
afade=t=out:st=3.4:d=1.5,volume=-4dB" distant-roar.wav      # then to -22 LUFS, trimmed to 4.95 s
```

**In the app** (`DragonDirector.swift`, `DragonBackdrop.swift`). His turns come in hands of ten:
six of talk (speak, ponder, skygaze), three shows (fire, roar, yawn and smoke take turns sitting one
out) and one flight, shuffled so nothing comes twice running; the first flight falls on the fourth
to seventh poke. A flight is `dragon-depart`, then `dragon-empty` looping for 6 to 16 s, then one
of the returns, with a fade across each cut. A poke at the empty summit still throws sparks, and
brings him back 1.8 s later behind the distant roar. With Reduce Motion there is no video, so he
only talks. Debug builds take `-dragonAutoPoke`, `-dragonPokeEvery`, `-dragonAct` and `-dragonAway`
(see `AppConfig.swift`) to script all of this, for example a whole flight with the chest:

```bash
./run.sh -dd.soundOn NO -dragonAct flight-chest -dragonAway 8 -dragonAutoPoke 1
```

Costs (credits): `empty.png` 20; clips 8 a second, so 64 for 8 s, 48 for 6 s, 80 for 10 s; the 26
lines 44. The whole set came to 784: the still, eleven clips (720, two of them discarded first
takes, the departure and the smoke ring) and the lines. It adds 18.5 MB to the app.
