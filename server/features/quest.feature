Feature: The quest's goal ends the adventure

  An adventure of a set length has a quest: a goal chosen at the start and
  sized to the party, a high fight for its level (slay or drive off a foe,
  recover an item from its keepers, rescue a captive). The scenes asked for
  are a plan, not a limit: the goal is placed so the shortest way to it fits
  them, and reaching it ends the adventure. Wrong turns, fights and rests may
  take longer, as many scenes again; then the ending is called.

  Scenario: A fixed map holds the goal where the planned scenes reach it
    Given a fixed-map adventure of 4 scenes for two level-1 heroes
    Then the goal is in room r2
    And the goal is a high fight for the party

  Scenario: The goal reached, the next scene is the epilogue
    Given a tale of 4 scenes with its quest
    When the party plays 1 scene of the tale
    And the party reaches the goal
    Then the next scene is the epilogue

  Scenario: Past the plan the adventure goes on toward the goal
    Given a tale of 4 scenes with its quest
    When the party plays 4 scenes of the tale
    Then the quest goes on
    And the scene is scene 5 of about 4
    And the first choice faces the goal

  Scenario: Twice the plan calls the ending
    Given a tale of 4 scenes with its quest
    When the party plays 6 scenes of the tale
    Then the quest goes on
    And the next scene is the epilogue

  Scenario: The host calls the ending past the plan
    Given a tale of 4 scenes with its quest
    When the party plays 5 scenes of the tale
    And the ending is called
    Then the next scene is the epilogue
