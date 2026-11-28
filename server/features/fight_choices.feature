Feature: A fight's choices are kinds of action

  In a fight each hero is offered three choices: attack, cast a spell, and a
  third (dodge, break free or help a dying friend). Each says what a plain
  pick of it does for that hero now. A weapon or a spell the player names
  for themselves, on the app's wheels or in their own words, is that kind of
  action and stays the one they named: the engine's pick does not replace it.

  Scenario: Each choice is headed by the kind of action it stands for
    Given a sorcerer fights a goblin warrior
    Then the round's choices are headed "Attack", "Cast a spell" and "Dodge"
    And a plain pick of the spell choice casts "Magic Missile"

  Scenario: A hero with no spell to hurl is offered an attack twice
    Given a fighter fights a goblin warrior
    Then the round's choices are headed "Attack", "Attack" and "Dodge"

  Scenario: A spell picked by name plays as the spell choice and stays that spell
    Given a sorcerer fights a goblin warrior
    When the player picks "Ray of Frost" for the goblin warrior
    Then the pick plays as choice "b"
    And the pick is "Cast Ray of Frost" at "Goblin Warrior"

  Scenario: A weapon picked by name plays as the attack choice and stays that weapon
    Given a fighter fights a goblin warrior
    When the player picks "Javelin" for the goblin warrior
    Then the pick plays as choice "a"
    And the pick is "Attack with Javelin" at "Goblin Warrior"

  Scenario: A spell written in the player's own words is that spell, at the foe they name
    Given a sorcerer fights a goblin warrior and a wolf
    When the words "I cast ray of frost at the wolf" are written in the fight
    Then the written action is "Cast Ray of Frost" at "Wolf"

  Scenario: Words that name no one are aimed at the most wounded foe
    Given a sorcerer fights a goblin warrior and a wolf
    And the wolf has lost half its hit points
    When the words "I cast ray of frost" are written in the fight
    Then the written action is "Cast Ray of Frost" at "Wolf"

  Scenario: Words that name a foe who is not there are aimed at the most wounded foe
    Given a sorcerer fights a goblin warrior and a wolf
    And the goblin warrior has lost half its hit points
    When the words "I cast fire bolt at the dragon" are written in the fight
    Then the written action is "Cast Fire Bolt" at "Goblin Warrior"

  Scenario: A weapon written in the player's own words is that weapon
    Given a fighter fights a goblin warrior and a wolf
    When the words "I attack with javelin at the wolf" are written in the fight
    Then the written action is "Attack with Javelin" at "Wolf"
