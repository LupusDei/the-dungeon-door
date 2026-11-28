# The tabbed play screen

Once the door is open, the game is four tabs under the party's heads-up display and one Act chip.
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

Leave and the chronicle stay in the navigation bar. The character sheet, chat and the dungeon
map are tabs, so those toolbar buttons are not repeated while playing. The caller's sheet stays
on the toolbar in the lobby, where there is no Sheet tab. The eight-button action bar is gone.
Common actions are rows in Story's offers and on the Sheet.

## The heads-up display and Act

The party is pinned at the top of every tab (`Views/Game/PartyHUD.swift`), in one of two shapes.

**Closed**, it is a slim row: the caller's hero in a ring with their name, hit points, armour
class and conditions, and every other hero as a health ring on the right (portrait or initials; a
tick for a hero who has chosen, an arrow for one who is down, a cross for one who has fallen). The
rings are as large as the row allows, 34 points with few heroes and 30 at a full table; with
larger text the numbers move to a line of their own before the rings shrink.

**Pulled down** (a tap or a pull on the row), the row unfolds into a compact card that stands in
its place and moves the rest of the screen down. Its top line says the round and where the caller
stands in it ("Choose your action", "Waiting on others", "Ready", "Throw your die", "You are down",
"Resolving…"); a tap on that line, on the handle, or a push up anywhere on the card closes it.
Under it every hero is a chip, three across on a phone: ring, first name, hit points and armour
class, conditions as badges. In a fight the foes follow as chips of their own, a ring of four
segments for the tier and the tier's word, never hit points. Each side is in initiative order, so
a chip keeps its place; whoever acts first when the round is played out is outlined in gold and
tagged Now, whoever is up after them Next (`rules.combat.hud`: `order`, `now`, `next`). The card's
words grow with the text size as far as the second large size, so it stays a card.

A fight pulls the card down by itself, since that is where the foes are, and its end puts it
away. The player can close it during a fight and it stays closed. Nobody is on the screen twice:
the card replaces the row, and there is no second strip under the Act bar.

Act is one chip. Choose jumps to Story and scrolls to the choices. After a pick or a written
action, the chip shows what was chosen, and Change jumps back to the choices. A new choice
replaces the old one until the scene resolves. What was chosen is always one action, said in full
(`PlayTurn.declared`): the action as the hero's own list names it ("Cast Ray of Frost"), then who
it is aimed at and what it rolls ("At Goblin Minion. +5 to hit, 1d8 cold."), then the player's
own words if it came from them. A tap on a card, a pick from a wheel, a tap on the map and
written words are all reduced to that one action, and the chip, the cards and the line under the
text box all read from it, so they cannot disagree. A pick of one of the plot's choices shows no die
(its d20 counts only if that choice wins and calls for a roll); an action of the hero's own shows
the die they threw. While a d20 is in the player's hand (`scene.myDie`) the chip is that die and
nothing else: "Throw your d20", what it is for, and a Throw button, on every tab.

## Story

The scene title, the clock and the light, the scene painting (a tap opens the existing
full-screen viewer), Listen, the dungeon master's narration, and what the heroes have said in
character. Then, in this order:

- **What do you do?** The scene's choices as cards (`scene.choices`): label, what it risks, and
  the rules line ("Stealth check, DC 10, with Advantage", "Fight: Wolf, Giant Rat"). A tap picks
  one (`POST /vote`); another tap changes the pick. The party goes with the choice most heroes
  pick. In a fight the cards are the hero's plain moves (Attack, Cast, a third that fits the
  moment), and the two quick-action wheels sit under them for a particular weapon, spell or item.
- **A fight's cards are kinds of action.** Each card is headed by what it stands for
  (`choice.heading`: "Attack", "Cast a spell", "Dodge"), and under the heading says what a plain
  tap of it does for this hero now ("Magic Missile", "3 darts … at Goblin Minion"). A weapon or
  spell the player picks for themselves, from a wheel or in their own words, is that kind of
  action: the card of its kind becomes the pick and shows *their* weapon or spell, who it is aimed
  at and what it rolls, in place of the plain tap's. The card never shows the plain tap's action
  as picked for another one. An action that is none of the cards (Dash, Hide, a potion, a move; a
  skill beside the plot's choices) gets a row of its own under them, so the list always holds the
  pick, once. On a server that sends no `heading`, a card is marked only for the very action it
  names, and any other gets that row.
- **Or in your own words** is `POST /action`. The dungeon master judges it and the player rolls
  for it. The page says plainly that it is the hero's own action beside the party's pick, and
  does not decide which way the party goes, with one exception it also states: words that match
  one of the choices count as picking it, and an attack counts as picking the fight. When that
  happens the choice's card shows "Your pick" with the player's words under it, and a line under
  the box says which choice the words were counted as (`scene.myAction.intent` on a `choice:` id).
  In a fight, words that name a weapon, spell or action of the hero's own are that action, aimed
  at whoever they name: the line under the box says what they were taken as, in full ("Taken as:
  Cast Ray of Frost. At Goblin Minion. +5 to hit, 1d8 cold."), and the card of its kind shows it.
- **Your die**, when `scene.myDie` is set, is a d20 the player taps or flicks (or throws from the
  Act chip). The face is the one the server rolled when they declared. If they have not thrown
  when the choice window ends, the server throws it and their XP for the turn is halved.
- **In character** is `POST /speak`. No roll. The line joins the scene's roleplay.
- **The table** lists every hero at once: portrait, name, and whether they have chosen or are
  still waiting, with a bar that drains across `turn` (90 seconds from when the scene was stored,
  counted against `turn.now`). A hero who has chosen shows a check and a full bar. The window is
  display only: nothing resolves at zero, and the host can still proceed early.

The scene's choices left this page for a while (players wrote every action instead). A game
played that way showed the cost: nobody could tell what steered the scene, so they are back.

## A streamlined game

The host picks how the game is told in the lobby, under the kind of game: "Full story" or
"Streamlined" (`catalog.tellings`, sent as `telling` with `POST /start`; the picker is hidden when
the catalog lists fewer than two, and the start then names none). `GameState.telling` says which a
game is, for every player. `-lobbyTelling <id>` preselects one.

A streamlined game is the same game told in a line or two: the server cuts the dungeon master's
words, not the rules (docs/api.md, "A streamlined game"). Its Story page is shorter to match
(`PlayStoryPage.streamlinedStory`). Top to bottom:

- The scene's place and title, smaller. No quest line or scene count here.
- **What happened** (`Views/Game/TurnBrief.swift`), when a turn has been played: the choice the
  party went with and whether its roll came good, who picked it (a party of more than one), then
  one line for each d20 that counted, a mark first (a tick or a cross), the hero, the roll against
  its number and the verdict in a word. A hero whose action had no die (a spell that asks a save,
  words of their own, being down) has the engine's own line. Under those, what the turn changed
  (five lines at most; "and N more" opens the rest), and the dungeon master's one sentence. "Every
  roll" opens the full result card. It is drawn from `chronicle.last.result` (`TurnResult.briefLines`).
- The scene's line: `scene.narration`, two sentences at most, and what the heroes said in character.
- The painting as a band (3:1). A tap opens it whole.
- **What do you do?** and **Or in your own words**: the same cards, box and rules as a full game,
  with the explanatory paragraphs under both headings left out. A choice's detail shows only when
  the server sent one.
- The table (who has chosen), as in a full game.
- Under the turn: Listen and the narrator's voice, the clock and the light, **In character** folded
  shut until tapped, and the quest with the scenes to go.

Left out of a streamlined page: the dice log (the dice are in What happened and on the result
card) and the "How the last turn went" button ("Every roll" is the same way back). The result card
between turns, the heads-up display, the Act chip and the Sheet, Map and Chat tabs are the same in
both tellings. A full game's page is unchanged.

## Between turns: the result

Once everyone has acted and `status` is `resolving`, a card covers every tab
(`Views/Game/TurnOutcome.swift`). First it lists every hero and what they did, under a turning
d20. As soon as the engine has rolled (`scene.result`, a `TurnResult`: it arrives while the
dungeon master is still writing) it becomes the result:

- what the party chose and how that was settled ("Fardock picked it; 2 acted on their own", or
  whose d20 broke a tie), its rules line, and Succeeded or Failed once its dice are in;
- a row for every hero, always: who rolled for the party's choice first, then the rest. Under
  each, what they did, and each of their d20s: it turns, lands on its face, and shows the sum
  against the number to beat and the verdict as a word and a mark (Succeeded, Failed, Hit,
  Missed). A die the table rolled for a hero says so; a die left to the clock says it cost half
  the XP. A hero who did not act, or could not, is still there and says that;
- what the turn changed, in the engine's own lines, and the dungeon master's telling once it is
  written.

Every die on it is one the engine used, under the hero it was rolled for. The card stays until
the player sends it away ("On with the story", there once the next scene is written); a tap lands
any dice still in the air. Each device remembers the last turn it has seen, so the card comes up
once per turn. "How the last turn went", at the foot of the Story page, brings it back. The dice
lines of the last resolved scene are still at the bottom of the page. The finale offers the way
back to the tavern.

## Sheet

A sideways row of chips: Abilities & Skills, Saves, Attacks, Spells, Items, Features.

Abilities and skills are the sheet the hero page already uses. Each skill has **This turn**, which
votes that `skill:` action (a medium check) and jumps back to Story. A line above the panes,
"How you do it", is sent as `text` with any sheet action, so a spell and a few words go together.
**Back to the story** jumps to the offers without voting. Saves adds the six saving
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
  `speedFeet` and a tap does not vote; a move with no squares is on the sheet, not in Story's offers.
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

## Return on the keyboard

Return means done, on every field a player types into. The keyboard goes away, and a field
with something to send sends it, as its button would: the action in your own words, the
in-character line, the chat line, the door code. Return does nothing a disabled button would
not do. Fields that only describe (the forge's prompts and portrait tweak, the hero's name,
how you use a sheet action) just close the keyboard. A multi-line field keeps no newline from
Return, and lines pasted in are joined with spaces. `Core/ReturnKey.swift` decides;
`UI/ReturnIsDone.swift` applies it to a field.

## What the app reads, and what it does not need yet

Every new field is optional. A missing key, a null, or a shape the app cannot read leaves that
one value empty. The rest of the game still loads, including against today's server.

| Field | Used for |
| --- | --- |
| `scene.offers[]` | The Story page: at most three plot choices, or a few tactical lines in a fight. |
| `scene.actions[]` | The sheet's taps and the map's Attack / Cast / move. Not the Story list. |
| `scene.actions[]` kind `skill` | A skill used as this turn's action. Id `skill:<id>`. |
| `scene.actions[].squares` | Gold squares. A `move` with none is voted from the sheet. |
| vote `text` | Words beside an action, or what a skill is attempting. |
| `scene.actions[].rangeFeet` `{normal, long}` | Range on the attack card and the target card. |
| `scene.actions[].reachFeet` | Melee reach, in feet. |
| `scene.battlefield` `{width, height, squareFeet, walls, cover?}` | The room, in squares. `squareFeet` is 5. `walls` and `cover` are squares `{x, y}`. |
| `combatant.square` `{x, y}` | Where that token stands. Null when the fight has no grid. |
| `combatant.speedFeet` | Feet this hero can move. A foe omits it. The party's `speed` is the fallback. |
| `scene.actions[]` id `move:dash` | The Dash move: its `squares` are double speed, and a tap sends `dash: true`. |
| vote `actionId`, `targets` | What a tap sends. |
| vote `move: {x, y, dash?, disengage?}` | A square. `dash` and `disengage` are sent only when that move is one. The older band move `{to, engage, dash, disengage}` still decodes. |
| `catalog.tellings[]`, `GameState.telling` | How the game is told: the lobby's picker, and the shorter Story page of a streamlined game. Absent: the full story. |
| `POST /action` `{sceneIndex, text}` | In your own words. |
| `POST /speak` `{text}` | In character. |
| `scene.myAction`, `scene.myFreeform`, `scene.freeforms` | The Act chip and the written line. |

The map does not invent a square vote when the server has not listed legal squares. Attack and
Cast on the map are enabled only when that action's `targets` include the token, so a tap is a
vote the current rules already accept.
