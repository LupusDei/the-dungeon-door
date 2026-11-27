Feature: The turn's result

  As soon as everyone has acted the engine rolls, and the table is shown how
  the turn came out before the dungeon master has written a word: which choice
  the party went with and who picked it, what each hero did, and every d20
  under the hero it was rolled for. The party's check is rolled by those who
  picked it: the one of them best at it throws their own d20, and a hero busy
  with their own action is left out of it. A written action is that hero's
  own, never a pick.

  Scenario: The hero who picked the choice rolls its check with their own d20
    Given a table of "Bryn, Mira"
    And the hero "Mira" is the better talker
    And the first choice is a Persuasion check for one hero
    When the hero "Bryn" picks the first choice with a 17
    And the hero "Mira" writes "I watch the door" with a 6
    And the turn is resolved
    Then the party's choice was picked by "Bryn"
    And the hero "Bryn" rolled "Persuasion" with their own 17
    And the hero "Mira" rolled nothing for the party's choice

  Scenario: A written action is listed under its hero and is not a pick
    Given a table of "Bryn, Mira"
    And the first choice is a Persuasion check for one hero
    When the hero "Bryn" picks the first choice with a 17
    And the hero "Mira" writes "I watch the door" with a 6
    And the turn is resolved
    Then the party's choice was picked by "Bryn"
    And the hero "Mira" did their own "I watch the door"
    And the hero "Mira" rolled "Perception" with their own 6

  Scenario: Every hero is in the result, including one who did not act
    Given a table of "Bryn, Mira, Dax"
    And the first choice is a Persuasion check for one hero
    When the hero "Bryn" picks the first choice with a 17
    And the turn is resolved
    Then the result lists "Bryn, Mira, Dax"
    And the hero "Dax" did nothing
    And the hero "Dax" rolled nothing for the party's choice
