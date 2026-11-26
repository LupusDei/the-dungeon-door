# The tabbed play screen

Once the door is open, the game is four tabs under a slim strip of the hero and one Act chip.
`GameView` opens this (`PlayShell`) for every status except the lobby and the beat before the
first scene. iPhone portrait is the layout it is built for. The column is held to 720 points, the
same measure as the other screens.

The DEBUG harness `-ddDemo <name>` still draws the approved prototype (`ios/DungeonDoor/Prototype`,
`ios/DungeonDoor/App/DemoHarness.swift`) with fixture heroes. It compiles out of release. The
production screen is the one a live game uses.

```
┌─────────────────────────────────┐
│ portrait  name  HP  AC  cond.   │  pinned
│              Round n · Your turn│
├─────────────────────────────────┤
│ Act          Choose / Change    │  pinned
├─────────────────────────────────┤
│                                 │
│   Story · Sheet · Map · Chat    │  the selected tab
│                                 │
├─────────────────────────────────┤
│ Story   Sheet   Map   Chat      │  pinned
└─────────────────────────────────┘
```

Leave, the chronicle and another hero's full sheet stay in the navigation bar. Chat and the
dungeon map are tabs, so those toolbar buttons are not repeated while playing. The eight-button
action bar is gone. Common actions are rows in Story's offers and on the Sheet.

## The strip and Act

The strip is the caller's portrait, name, hit points, armour class, conditions, and the round
with whose turn it is. "Your turn" means the table is taking this hero's vote. After they have
voted or written an action it says they are waiting, or that everyone is ready. A hero who
cannot act reads "You are down". Resolving reads "Resolving…".

Act is one chip. Choose jumps to Story and scrolls to the offers. After a vote or a written
action, the chip shows the d20 and what was chosen, and Change jumps back to the offers. A new
choice replaces the old one until the scene resolves.

## Story

The scene title, the party (names wrap), the clock and the light, the scene painting (a tap
opens the existing full-screen viewer), Listen, the dungeon master's narration, and what the
heroes have said in character.

Under that, two different boxes:

- **In character** is `POST /speak`. No roll. The line joins the scene's roleplay.
- **The table offers** is `scene.actions` for this hero, including `kind: "move"`. A tap votes
  that `actionId`. An action that needs one target among several asks who. An action the hero
  cannot take stays in the list, grey, with the server's reason. A move that lists squares
  opens the Map. When the server sent no `actions` (a game from before that list), the three
  `choices` are the offers and a tap still votes the letter.
- **In your own words** is `POST /action`. The dungeon master classifies it. A known deed
  becomes the vote; a check shows here as the written line.

Votes already in, who the table is waiting on, and the host's "resolve now" sit under the
offers. The dice of the last resolved scene are at the bottom. The finale offers the way back
to the tavern.

## Sheet

A sideways row of chips: Abilities & Skills, Saves, Attacks, Spells, Items, Features.

Abilities and skills are the sheet the hero page already uses. Saves adds the six saving
throws, the conditions the hero carries, and the death-save track. The track is six open marks:
the server does not say how many have landed, and the caption says Standing, Down, Dying,
Stable or Fallen.

Attacks lists each weapon and damaging spell with to-hit, damage and range. Range is
`rangeFeet` or `reachFeet` when the action carries them, and otherwise "5 ft", "Ranged" or
"Spell". A tap votes that attack's `actionId` and, when it needs a target, asks who. The common
actions (Dash, Dodge, and the rest) are on this pane too, when `scene.actions` lists them.

Spells shows slots left, cantrips and prepared spells. A tap votes the matching spell action.
Items shows gold, what is equipped (weapons and armour), and the rest of the pack. Use votes an
`item` action when one is offered. Features shows resources such as Arcane Recovery, then class
features, feats and traits. A resource or feature the table is offering can be tapped to spend
it; the others open the rule text.

Anything the table is not offering stays visible and does not vote.

## Map

During a fight the tab is a room of 5-foot squares.

- Tokens wear the hero's portrait when the game has one, and initials otherwise. A ring shows
  hit points, or a foe's vigor.
- The initiative strip sits above the grid. Tapping a name selects that token.
- Rings around the caller are engaged (5 ft), near (30 ft) and far (60 ft).
- Gold squares are where this hero can move. When a `move` action lists `squares`, those are
  the gold squares, and a tap votes that action with `move: {x, y}`. A square listed by both a
  step and a Dash (`move:dash`) sends the step. A Dash square sends `dash: true`. A disengage
  sends `disengage: true`. Until the server lists squares, the gold wash is this hero's
  `speedFeet` and a tap does not vote; the band moves stay in Story's offers.
- Tapping a token draws a dashed line and a card: distance in feet (5 times the squares, and a
  diagonal counts as one), in reach or out of it, and Attack / Cast for the legal action that
  names that token. Those buttons vote the action with that target.
- Walls are squares a token cannot enter. Cover tints a square.

`scene.battlefield` sizes the room in squares. A room is 10 by 8 and a road fight is 16 by 6.
`squareFeet` is 5. `x` grows east and `y` grows south, from the north-west corner. A battlefield
the app cannot read is ignored.

When `battlefield` is missing, or a combatant has no `square`, tokens are laid out from
`position` and `engagedWith`: the party toward the south of the room, foes they are engaged
with one square north of them, near and far foes toward the far wall. The room's feet come
from the area name ("Grand chamber (50 x 40 ft.)") when it has them, and otherwise 50 by 40.
The card still shows the server's band word next to the measured feet.

Outside a fight the tab is the dungeon map the app already draws, or a line that this stretch
of road has no map. An ember dot sits on the Map tab while `scene.combat` is true.

## Chat

The party's thread and the composer live on this tab. A line shows only the reactions people
have used, plus a button to add one. System lines and the dungeon master's lines have none.
Names wrap. The unread count on the tab is lines that arrived while Chat was not showing.

## What the app reads, and what it does not need yet

Every new field is optional. A missing key, a null, or a shape the app cannot read leaves that
one value empty. The rest of the game still loads, including against today's server.

| Field | Used for |
| --- | --- |
| `scene.actions[]` | Offers, the sheet's taps, the map's Attack / Cast / move. Already on the server. |
| `scene.actions[].squares` | Gold squares. A `move` with none is voted from Story as that action id. |
| `scene.actions[].rangeFeet` `{normal, long}` | Range on the attack card and the target card. |
| `scene.actions[].reachFeet` | Melee reach, in feet. |
| `scene.battlefield` `{width, height, squareFeet, walls, cover?}` | The room, in squares. `squareFeet` is 5. `walls` and `cover` are squares `{x, y}`. |
| `combatant.square` `{x, y}` | Where that token stands. Null when the fight has no grid. |
| `combatant.speedFeet` | Feet this hero can move. A foe omits it. The party's `speed` is the fallback. |
| `scene.actions[]` id `move:dash` | The Dash move: its `squares` are double speed, and a tap sends `dash: true`. |
| vote `actionId`, `targets` | What a tap sends. |
| vote `move: {x, y, dash?, disengage?}` | A square. `dash` and `disengage` are sent only when that move is one. The older band move `{to, engage, dash, disengage}` still decodes. |
| `POST /action` `{sceneIndex, text}` | In your own words. |
| `POST /speak` `{text}` | In character. |
| `scene.myAction`, `scene.myFreeform`, `scene.freeforms` | The Act chip and the written line. |

The map does not invent a square vote when the server has not listed legal squares. Attack and
Cast on the map are enabled only when that action's `targets` include the token, so a tap is a
vote the current rules already accept.
