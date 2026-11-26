Feature: Players speak for their own heroes

  The narrator describes the world and answers what the players say. It does not
  invent a hero's words. A staff that hiccups may stay; a line the player never
  wrote may not.

  Scenario: A line the player never said is not kept
    Given the heroes Bryn and Cleo
    When the narrator writes:
      """
      Bryn says, "Draw your swords." The innkeeper eyes you warily. What do you say?
      """
    Then the narration does not contain Draw your swords
    And the narration contains The innkeeper eyes you warily

  Scenario: A line the player wrote may be repeated
    Given the heroes Bryn and Cleo
    And Bryn has said:
      """
      We come in peace.
      """
    When the narrator writes:
      """
      Bryn says, "We come in peace." The innkeeper lowers the axe.
      """
    Then the narration contains We come in peace
    And the narration contains The innkeeper lowers the axe

  Scenario: NPC speech and a quirky item stay
    Given the heroes Bryn and Cleo
    When the narrator writes:
      """
      The staff hiccups. The innkeeper says, "Mind the door." What do you say?
      """
    Then the narration contains The staff hiccups
    And the narration contains Mind the door

  Scenario: The narrator is told to leave the heroes to the players
    Then the narrator is told not to speak for the heroes

  Scenario: A hero's own words are given back to the narrator to answer
    Given the heroes Bryn and Cleo
    And Bryn has said:
      """
      We come in peace.
      """
    Then the narrator is handed those words to answer
