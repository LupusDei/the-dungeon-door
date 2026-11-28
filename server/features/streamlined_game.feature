Feature: A streamlined game

  The host may open the door on a streamlined game: the same rules and dice as any game,
  told in a line or two. The engine holds the length, whatever the dungeon master writes.

  Scenario: The catalog offers the full story and the streamlined game
    Then the catalog offers the tellings "full, streamlined"

  Scenario: A door opened without a telling is the full story
    Given a dungeon master who writes at length
    When the host opens the door without naming a telling
    Then the game is told "full"
    And the scene is told in more than 2 sentences
    And the dungeon master's aside is posted

  Scenario: A streamlined game says what stands before the party in two sentences at most
    Given a dungeon master who writes at length
    When the host opens the door on a "streamlined" game
    Then the game is told "streamlined"
    And the dungeon master was asked for a "streamlined" game
    And the scene is told in at most 2 sentences
    And every choice's label is at most 6 words
    And every choice's detail is at most 10 words
    And every choice still carries its dice
    And the dungeon master's aside is not posted

  Scenario: What happened is one sentence, and the dice are as in any game
    Given a dungeon master who writes at length
    When the host opens the door on a "streamlined" game
    And the party picks the second choice
    Then what happened is told in 1 sentence
    And the turn's result names every hero
    And the choice's check is in the dice log

  Scenario: The same turn in a full game is told at length
    Given a dungeon master who writes at length
    When the host opens the door on a "full" game
    And the party picks the second choice
    Then what happened is told in 3 sentences

  Scenario: A telling the server does not know is refused
    When the host opens the door on a "terse" game
    Then the start is refused
    And the party is still at the door
