Feature: A hero's past adventures

  Every adventure a hero has been on is kept: its pictures, how it ended
  and how the hero came out of it. A door that never opened is not one,
  and a player who walks out gives theirs up.

  Scenario: A finished adventure is kept for each hero who went on it
    Given the party at the door is Bryn and Ilsa
    And Bryn has opened it for 2 scenes
    When the party plays the adventure to its end
    Then the quests of Bryn number 1
    And the latest quest of Bryn has ended
    And the latest quest of Bryn keeps its pictures
    And the latest quest of Bryn says how they came out
    And the latest quest of Bryn was with Ilsa
    And the quests of Ilsa number 1
    And the latest quest of Ilsa was with Bryn

  Scenario: A door that never opened is not an adventure
    Given the party at the door is Bryn and Ilsa
    Then the quests of Bryn number 0

  Scenario: An adventure still going is kept as unfinished
    Given the party at the door is Bryn and Ilsa
    And Bryn has opened it for 4 scenes
    When the party plays a scene
    Then the quests of Bryn number 1
    And the latest quest of Bryn is unfinished

  Scenario: Walking out gives the adventure up
    Given the party at the door is Bryn and Ilsa
    And Bryn has opened it for 4 scenes
    And the party has played a scene
    When Ilsa walks out of the adventure
    Then the quests of Ilsa number 0
    And the quests of Bryn number 1
