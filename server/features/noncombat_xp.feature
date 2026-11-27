Feature: Experience without a fight

  Heroes earn experience for what they do, not only for what they kill. Each
  scene outside a fight pays every hero who declared something: a little for
  taking part, more for a d20 that came good, some for a brave failure, and more
  for a trap overcome, a parley won, new ground, a discovery, a puzzle or a
  chapter closed. The amounts are a share of the SRD 5.2 Low encounter budget for
  the hero's level. The dungeon master may tag a choice; the engine owns every
  number, caps it, and still levels heroes up only at the quest's end.

  Scenario: Taking part earns a little; a hero who declared nothing earns nothing
    Given a level 1 party of "Bryn, Cleo"
    And the choice is "a story choice"
    When "Bryn" declares and rolls 9
    And the scene is resolved
    Then the dice log says "+5 XP: taking part (Bryn)."
    And the dice log has no XP for "Cleo"
    And "Bryn" now has 5 XP
    And "Cleo" now has 0 XP

  Scenario: A check that comes good pays more than a brave failure
    Given a level 1 party of "Bryn, Cleo"
    And the choice is "an Athletics check"
    When "Bryn" declares and rolls 20
    And "Cleo" declares and rolls 1
    And the scene is resolved
    Then the dice log says "+5 XP: taking part (Bryn, Cleo)."
    And the dice log says "+10 XP: a success (Bryn)."
    And the dice log says "+5 XP: a brave failure (Cleo)."

  Scenario: A hero whose die the clock threw earns half
    Given a level 1 party of "Bryn, Cleo"
    And the choice is "an Athletics check"
    When "Bryn" declares and rolls 20
    And "Cleo" declares but the clock throws their 20
    And the scene is resolved
    Then the dice log says "+10 XP: a success (Bryn)."
    And the dice log says "+5 XP: a success, halved: their die was left to the clock (Cleo)."
    And "Cleo" now has 7 XP

  Scenario: A parley won is a clever parley
    Given a level 1 party of "Bryn, Cleo"
    And the choice is "a parley with a goblin"
    When "Bryn" declares and rolls 20
    And "Cleo" declares and rolls 20
    And the scene is resolved
    Then the dice log says "+25 XP: a clever parley (Bryn, Cleo)."

  Scenario: A trap overcome
    Given a level 1 party of "Bryn, Cleo"
    And "Cleo" has a sharp eye
    And the choice is "a hidden pit"
    When "Bryn" declares and rolls 9
    And the scene is resolved
    Then the dice log says "+25 XP: a trap overcome (Bryn)."

  Scenario: New ground in a dungeon
    Given a level 1 party of "Bryn"
    And the choice is "the way into an unseen room"
    When "Bryn" declares and rolls 12
    And the scene is resolved
    Then the dice log says "+5 XP: new ground (Bryn)."

  Scenario: The dungeon master's tag pays when the choice's dice hold
    Given a level 1 party of "Bryn"
    And the choice is "an Athletics check"
    And the dungeon master tags it "discovery"
    When "Bryn" declares and rolls 20
    And the scene is resolved
    Then the dice log says "+10 XP: a discovery (Bryn)."
    And the dungeon master is told "+10 XP: a discovery (Bryn)."

  Scenario: The tag pays nothing when the dice fail
    Given a level 1 party of "Bryn"
    And the choice is "an impossible Athletics check"
    And the dungeon master tags it "discovery"
    When "Bryn" declares and rolls 1
    And the scene is resolved
    Then the dice log says "+5 XP: a brave failure (Bryn)."
    And the dice log does not mention "a discovery"

  Scenario: A tag the engine does not know is no tag
    Given a level 1 party of "Bryn"
    And the choice is "a story choice"
    And the dungeon master tags it "a chest of gold"
    When "Bryn" declares and rolls 9
    And the scene is resolved
    Then "Bryn" now has 5 XP

  Scenario: A fight pays its own XP, so a tag on it pays nothing
    Given a level 1 party of "Bryn"
    And the choice is "a fight with a goblin"
    And the dungeon master tags it "milestone"
    When "Bryn" declares and rolls 9
    And the scene is resolved
    Then the dice log says "+5 XP: taking part (Bryn)."
    And the dice log does not mention "a chapter closed"

  Scenario: A round of a fight earns nothing outside the fight's own XP
    Given a level 1 party of "Bryn"
    And the party is in a fight
    When "Bryn" declares and rolls 9
    And the scene is resolved
    Then the dice log has no XP

  Scenario: A chapter milestone is paid on top of the rest
    Given a level 1 party of "Bryn"
    And the choice is "a story choice"
    And the dungeon master tags it "milestone"
    And a chapter milestone was paid 3 scenes ago
    When "Bryn" declares and rolls 9
    And the scene is resolved
    Then the dice log says "+25 XP: a chapter closed (Bryn)."

  Scenario: A chapter milestone comes at most once every three scenes
    Given a level 1 party of "Bryn"
    And the choice is "a story choice"
    And the dungeon master tags it "milestone"
    And a chapter milestone was paid 2 scenes ago
    When "Bryn" declares and rolls 9
    And the scene is resolved
    Then the dice log does not mention "a chapter closed"
    And "Bryn" now has 5 XP

  Scenario: Awards grow with the hero's level
    Given a level 3 party of "Bryn"
    And the choice is "a story choice"
    And the dungeon master tags it "social"
    When "Bryn" declares and rolls 9
    And the scene is resolved
    Then the dice log says "+15 XP: taking part (Bryn)."
    And the dice log says "+75 XP: a clever parley (Bryn)."

  Scenario: A scene pays at most one unit outside a milestone
    Given a level 1 party of "Bryn"
    And "Bryn" has a sharp eye
    And the choice is "a hidden pit"
    And the dungeon master tags it "puzzle"
    When "Bryn" declares and rolls 9
    And the scene is resolved
    Then "Bryn" now has 50 XP

  Scenario: The sheet shows the running total and the next level
    Given a level 1 party of "Bryn"
    And "Bryn" starts with 120 XP
    And the choice is "an Athletics check"
    When "Bryn" declares and rolls 20
    And the scene is resolved
    Then the sheet shows "Bryn" at 135 of 300 XP
    And the sheet shows "Bryn" earned 15 XP on this adventure
    And "Bryn" is level 1

  Scenario: The adventure's end pays those who took part, and then they level up
    Given a level 1 party of "Bryn, Cleo"
    And "Bryn" starts with 260 XP
    And "Cleo" starts with 260 XP
    And the choice is "a story choice"
    When "Bryn" declares and rolls 9
    And the quest ends
    Then the dice log says "+50 XP: the adventure’s end (Bryn)."
    And "Bryn" is level 2
    And "Cleo" is level 1
    And the dungeon master is told "+50 XP: the adventure’s end (Bryn)."
