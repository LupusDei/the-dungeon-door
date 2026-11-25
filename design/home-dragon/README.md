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
