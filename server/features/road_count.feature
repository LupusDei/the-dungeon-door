Feature: The road does not count against the tale

  Every game opens on the road from the tavern: two stretches, a scene each.
  The road is counted apart from the tale, the dungeon's or the one told, so
  the tale gets every scene the host asked for, its epilogue the last. A fight
  on the road adds its rounds to the road, never to the tale.

  Scenario: A tale of four scenes gets all four after the road
    Given a game of 4 scenes is started
    Then the game has 6 scenes
    And the scene is stretch 1 of 2 of the road, with 4 scenes of the tale to follow
    When the party walks on
    Then the scene is stretch 2 of 2 of the road, with 4 scenes of the tale to follow
    When the party walks on
    Then the scene is scene 1 of 4 of the tale
    And the scene is told to the dungeon master as "scene 1 of 4"

  Scenario: A fight on the road takes the road's scenes, not the tale's
    Given a game of 4 scenes is started
    When the party fights 2 rounds on the road
    Then the scene is stretch 1 of 2 of the road, with 4 scenes of the tale to follow
    When the party walks on
    And the party walks on
    Then the game has 8 scenes
    And the scene is scene 1 of 4 of the tale

  Scenario: The epilogue is the tale's last scene
    Given a game of 2 scenes is started
    When the party walks on
    And the party walks on
    And the party plays a scene of the tale
    Then the scene is scene 2 of 2 of the tale

  Scenario: An adventure with no set length counts the road, and nothing else
    Given a game with no set length is started
    Then the scene is stretch 1 of 2 of the road, the tale with no set length
    When the party walks on
    And the party walks on
    Then the scene is scene 1 of the tale, with no set length
    And the scene is told to the dungeon master as "scene 1; the adventure has no set length, so the story goes on"
