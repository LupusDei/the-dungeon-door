Feature: Sizing up a fight

  Players can see how hard each monster is against this party, and how hard the
  fight is altogether, before anyone draws steel and again once the fight is on.
  Hostile foes wait for the party to engage, run or parley.

  Scenario Outline: A fight choice rates the foe and the fight
    Given a party of four level 1 heroes
    When the party is offered a fight with 1 <monster>
    Then the fight choice reads "<line>"

    Examples:
      | monster         | line                                   |
      | Goblin Warrior  | Fight: Goblin Warrior (weak) — low     |
      | Bugbear Warrior | Fight: Bugbear Warrior (strong) — high |
      | Ogre            | Fight: Ogre (deadly) — deadly          |

  Scenario: The ratings stay once the fight begins
    Given a party of four level 1 heroes
    When the party engages 1 Ogre
    Then the foe "Ogre" is shown as "deadly"
    And the fight is shown as "deadly"

  Scenario: Hostile foes let the party engage, run or parley
    Given a party of four level 1 heroes
    When the party steps into a room of 3 hostile Skeleton guarding 60 gold
    Then no fight has started
    And the party is offered "Engage", "Run" and "Parley"
    And the waiting notice shows "Skeleton ×3", each "weak", a "moderate" fight
    And engaging would be "Fight: 3 Skeletons (weak) — moderate"

  Scenario: Running leaves the room uncleared and unlooted
    Given a party of four level 1 heroes
    When the party steps into a room of 3 hostile Skeleton guarding 60 gold
    And the party runs
    Then the party has left that room
    And that room is not cleared
    And the party's gold is unchanged
    And the party's experience is unchanged
    And no fight has started
