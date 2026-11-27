Feature: The table is told when the dungeon master cannot be paid

  An account that pays for the dungeon master can run out of credit, and
  then starting again cannot help. The table is told that, not to try again.

  Scenario: A door that cannot open says why
    Given the party at the door is Bryn and Ilsa
    And the dungeon master's account is out of credit
    When Bryn opens it for 2 scenes
    Then the door is still shut
    And the table hears the account is out of credit
    And nobody is told to try again
