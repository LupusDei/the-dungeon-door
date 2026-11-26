Feature: Freeform turns

  A player may write their own action. The dungeon master classifies the words.
  The engine owns every number, in a fight and out of one.

  Scenario: A known action maps onto today's attack
    Given a fight is underway
    When the player names their weapon
    Then the action maps to today's choice "a"
    And the turn is spent

  Scenario: Kicking the brazier is a check with the engine's DC and damage
    Given a fight is underway
    When the player writes "I kick the brazier onto the goblins"
    Then the turn is spent
    And the check is against DC 15
    And the damage dice are "2d6"
    And the dice log contains "vs DC 15"
    And the foe has lost hit points

  Scenario: The same check is adjudicated outside a fight
    Given no fight is underway
    When the player writes "I kick the brazier onto the goblins"
    Then the turn is spent
    And the check is against DC 15
    And the damage dice are "2d6"
    And the dice log contains "vs DC 15"

  Scenario: An impossible action does not spend the turn
    Given no fight is underway
    When the player writes "I fly to the moon"
    Then the narration refuses the action
    And the turn is not spent

  Scenario: A classification the engine cannot read does not spend the turn
    Given no fight is underway
    When the dungeon master returns something unreadable
    Then the turn is not spent
