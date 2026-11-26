# The play dashboard

The game is played from the character sheet. Every region stays in the same place from turn to
turn. What the table is not offering greys out; it is not hidden, and it does not move.

iPhone portrait is the layout this is built for. On a wider phone the map and the freeform box sit
side by side; on a narrow one they stack. iPad uses the same column, held to 720 points, which is
how the other screens already sit.

```
┌─────────────────────────────────┐
│ VITALS (pinned)                 │
│ name                            │
│ HP bar          AC   EXH  SAVES │
│ conditions, one scrolling row   │
├─────────────────────────────────┤
│ SCENE                           │
│ title, art, narration           │
│ initiative strip (always)       │
│ three offer slots               │
│ votes, dice                     │
├──────────────┬──────────────────┤
│ MAP          │ IN YOUR OWN      │
│ placeholder  │ WORDS placeholder│
├──────────────┴──────────────────┤
│ ATTACKS                         │
│ SPELLS and slots                │
│ ITEMS                           │
│ FEATURES and resources          │
├─────────────────────────────────┤
│ Voted · …                       │
│ Attack  Dash  Disengage  Dodge  │  pinned
│ Help    Hide  Ready   Use Object│
└─────────────────────────────────┘
```

Vitals are hit points, armour class, conditions, exhaustion (0 through 6, always shown) and death
saves. The death-save track is always six marks. The client is not sent how many have landed, so
the marks stay open and the caption says Standing, Down, Dying, Stable or Fallen. The dice log
still carries each save as the server wrote it.

The map is a placeholder. An interactive battle map is a later task. When the adventure has a
dungeon, the placeholder opens the dungeon map the app already has. The freeform box is a
placeholder too: it does not send a turn.

Abilities, skills and the story stay on the full sheet, opened from the toolbar (My hero) or from
a portrait in the party strip. Rule text stays there as well. A tap on the dashboard acts.

## What a tap does today

`PlayBoard` (ios/DungeonDoor/Views/Game/PlayBoard.swift) turns the scene's choices into
`PlayControl`s. A control has the choice a tap votes for, or none, and whether a tap sends it
now. The views draw controls. They do not know that Attack is choice `a`.

| Control | Votes |
| --- | --- |
| Attack, in a fight | Choice `a`, the hero's Attack |
| Attack, out of a fight | A choice labelled Attack, if there is one |
| A weapon, in a fight | The same Attack vote. The server still picks the weapon. Only the weapon the label names is marked chosen; any other says which blow a tap sends |
| Dodge, Help, Dash, Disengage, Hide, Ready | A choice whose label is that action, or starts with it ("Help Bryn") |
| Use an Object | "Use an Object", or a choice that starts with "Drink" |
| A spell | The choice labelled "Cast \(that spell)". Choice `b` is ignored when it is a copy of Attack |
| An item | A choice whose label names the item ("Drink a Potion of Healing"). A weapon's Attack stays on the Attacks row. Gold is always the first line, not a button |
| A feature or resource | A choice whose label names it. Second Wind is not a choice today, so it stays grey |
| A condition the hero must break | Break Free, when that choice names the condition |
| A scene offer | That scene choice, in order. This is how a check, a rest, Engage, Run and Parley are voted |

Dash, Disengage, Hide and Ready have no choice on the server yet, so they are on the bar and grey.
The scene panel keeps three offer slots even when a scene has fewer choices, so the panel does not
shrink, and shows every choice when a scene has more than three, so none are dropped. A fight's
offers are the same votes the sheet casts, which keeps the round playable from either place.

While the table is not taking this hero's vote (the round is resolving, the hero is down, the tale
is over, the vote is in flight) every bound control greys out together. The one that was voted
stays highlighted.

## Swapping in legal actions

A later task sends the actions the hero may take. Fill `PlayControl` from that list instead of from
`scene.choices`, in `PlayBoard`, and leave the views. Each weapon, spell, item and common action
then carries its own choice. The regions do not change.
