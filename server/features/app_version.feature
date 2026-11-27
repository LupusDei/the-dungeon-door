Feature: The party updates before the adventure begins

  A tale or a dungeon stays shut while anyone at the table is on a build
  older than the server allows, or on a build that sends no version at all.
  The host sees who is holding the door. That player's own request is told
  to update.

  Scenario: A hero who sends no version holds the door
    Given the door's party is Bryn and Ilsa
    And Ilsa sends no app version
    When Bryn opens the door on a tale
    Then the adventure has not begun
    And the refusal names Ilsa
    And the party marks Ilsa outdated

  Scenario: An old build holds a dungeon the same way
    Given the door's party is Bryn and Ilsa
    And Ilsa is on an old build
    When Bryn opens the door on a dungeon
    Then the adventure has not begun
    And the refusal names Ilsa
    And the party marks Ilsa outdated

  Scenario: The door opens once everyone is current
    Given the door's party is Bryn and Ilsa
    And Ilsa is on an old build
    And Ilsa is on the current build
    When Bryn opens the door on a tale
    Then the adventure has begun
    And the party does not mark Ilsa outdated

  Scenario: A versionless player is told to update
    Given the door's party is Bryn
    And Bryn sends no app version
    When Bryn opens the door on a tale
    Then Bryn is told to update the app
    And the adventure has not begun
