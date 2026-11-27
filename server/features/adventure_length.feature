Feature: How long an adventure is

  A host opens the door for a number of scenes, or for none. With a number,
  the table can see how many scenes are still to come before the ending.
  With none, the adventure goes on until the host calls the ending.

  Scenario: The table sees the scenes still to come
    Given the party at the door is Bryn and Ilsa
    When Bryn opens it for 3 scenes
    Then 3 scenes are still to come
    When the party plays a scene
    Then 2 scenes are still to come

  Scenario: The count runs down to the last scene, and then the ending
    Given the party at the door is Bryn and Ilsa
    And Bryn has opened it for 2 scenes
    When the party plays 2 scenes
    Then the last scene is being played
    When the party plays a scene
    Then the adventure has reached its end

  Scenario: An adventure with no set length goes on
    Given the party at the door is Bryn and Ilsa
    When Bryn opens it with no set length
    And the party plays 12 scenes
    Then the adventure is still going
    And the adventure has no set length

  Scenario: The host calls the ending
    Given the party at the door is Bryn and Ilsa
    And Bryn has opened it with no set length
    And the party has played 3 scenes
    When Bryn calls the ending
    Then the table hears that the ending was called
    And the last scene is being played
    When the party plays a scene
    Then the adventure has reached its end

  Scenario: Calling the ending twice is said once
    Given the party at the door is Bryn and Ilsa
    And Bryn has opened it with no set length
    When Bryn calls the ending
    And Bryn calls the ending
    Then the table hears that the ending was called

  Scenario: Only the host calls the ending
    Given the party at the door is Bryn and Ilsa
    And Bryn has opened it with no set length
    When Ilsa calls the ending
    Then Ilsa is refused the ending
    And the adventure has no set length

  Scenario: The host cuts a set length short
    Given the party at the door is Bryn and Ilsa
    And Bryn has opened it for 8 scenes
    When Bryn calls the ending
    Then the last scene is being played
