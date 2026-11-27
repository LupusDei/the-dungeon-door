Feature: The combat HUD

  In a fight every player sees the whole table at a glance: each hero's hit
  points, and each foe's general condition, never its hit points. A foe is
  Unhurt at full, Hurt below it, Bloodied at half or less, Near death at a
  quarter or less, and Dead at 0. The conditions on each of them show too,
  with the spell that brought them, so the table can choose whom to hit, who
  needs healing, and who is asleep.

  Scenario Outline: A foe's tier tells how hurt it is
    Given Bryn and Cleo fight a "Goblin Warrior" with 20 hit points
    When the foe "Goblin Warrior" is down to <hp> hit points
    Then the HUD shows the foe "Goblin Warrior" as "<tier>"
    And the HUD shows no foe's hit points

    Examples:
      | hp | tier       |
      | 20 | Unhurt     |
      | 19 | Hurt       |
      | 11 | Hurt       |
      | 10 | Bloodied   |
      | 6  | Bloodied   |
      | 5  | Near death |
      | 1  | Near death |

  Scenario: A slain foe is shown as dead
    Given Bryn and Cleo fight a "Goblin Warrior" with 20 hit points
    When the foe "Goblin Warrior" is slain
    Then the HUD shows the foe "Goblin Warrior" as "Dead"

  Scenario: The party's hit points are shown exactly
    Given Bryn and Cleo fight a "Goblin Warrior" with 20 hit points
    When the hero "Bryn" is down to 4 hit points
    Then the HUD shows the hero "Bryn" at 4 hit points of their maximum

  Scenario: A hero's condition shows with how it ends
    Given the hero "Bryn" is poisoned for 10 minutes
    And Bryn and Cleo fight a "Goblin Warrior" with 20 hit points
    Then the HUD shows the hero "Bryn" "Poisoned", ending in "10 minutes"

  Scenario: Sleep puts a foe to sleep, and the HUD shows it
    Given Bryn and Cleo fight a "Goblin Warrior" with 200 hit points
    And the foe "Goblin Warrior" cannot resist and cannot strike back
    When the hero "Cleo" casts "Sleep" on the foe "Goblin Warrior"
    Then the round tells "Cleo casts Sleep: Goblin Warrior fails the save: Incapacitated."
    And the HUD shows the hero "Cleo" "Concentrating" on "Sleep"
    When a round passes
    Then the HUD shows the foe "Goblin Warrior" "Asleep" by "Sleep"
    And the HUD shows the foe "Goblin Warrior" as "Unhurt"

  Scenario: Hurting a sleeping foe wakes it
    Given Bryn and Cleo fight a "Goblin Warrior" with 200 hit points
    And the foe "Goblin Warrior" cannot resist and cannot strike back
    When the hero "Cleo" casts "Sleep" on the foe "Goblin Warrior"
    And a round passes
    Then the HUD shows the foe "Goblin Warrior" "Asleep" by "Sleep"
    When the hero "Bryn" strikes with a natural 20
    Then the round tells "Goblin Warrior wakes from Sleep."
    And the HUD shows the foe "Goblin Warrior" free of conditions
    And the HUD shows the foe "Goblin Warrior" as "Hurt"

  Scenario: A sleeper wakes when its caster stops concentrating
    Given Bryn and Cleo fight a "Goblin Warrior" with 200 hit points
    And the foe "Goblin Warrior" cannot resist and cannot strike back
    When the hero "Cleo" casts "Sleep" on the foe "Goblin Warrior"
    And a round passes
    And the hero "Cleo" loses concentration
    And a round passes
    Then the round tells "Goblin Warrior wakes from Sleep."
    And the HUD shows the foe "Goblin Warrior" free of conditions

  Scenario: The undead do not sleep
    Given Bryn and Cleo fight a "Skeleton" with 13 hit points
    When the hero "Cleo" casts "Sleep" on the foe "Skeleton"
    Then the round tells "Cleo casts Sleep: Skeleton is unaffected."
    And the HUD shows the foe "Skeleton" free of conditions

  Scenario: No foe's hit points leave the server
    Given the party is in a fight with an "Ogre" at the table
    When the foe is down to half of its hit points
    Then no game state sent to a player holds a foe's hit points
    And every player's HUD shows the "Ogre" as "Bloodied"
