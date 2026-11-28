Feature: Companions are people

  The players someone has shared a game with are the people they can
  invite to a new party. A companion is a person, not the hero they last
  played: that hero may have died or been retired since. The list names
  the person and offers only their heroes who can still go, and an
  invitation is to the person, with or without one of those heroes by
  name.

  Background:
    Given I adventured beside a player whose hero was Slagette

  Scenario: A companion nobody has named is known by the hero they played
    Then my companions are called "Slagette's player"
    And that companion was named by nobody
    And that companion can bring Slagette

  Scenario: A fallen hero is not offered, and the person is still invited
    Given that companion also has the heroes Brannoch and Ilse
    And the companion's hero Slagette has fallen
    Then that companion can bring Brannoch and Ilse
    When I open a new door and invite that companion
    Then they are invited
    And their invitation asks for no hero

  Scenario: A retired hero is not offered
    Given that companion also has the heroes Brannoch and Ilse
    And the companion's hero Ilse is retired
    Then that companion can bring Brannoch and Slagette

  Scenario: A companion with no hero who can go is still listed and invited
    Given the companion's hero Slagette has fallen
    Then my companions are called "Slagette's player"
    And that companion can bring none
    When I open a new door and invite that companion
    Then they are invited

  Scenario: The name a player gives themselves is what their companions see
    Given that companion goes by "Micah"
    Then my companions are called "Micah"
    And that companion was named by them

  Scenario: My own name for a companion comes first
    Given that companion goes by "Slagyr"
    When I call that companion "Micah"
    Then my companions are called "Micah"
    And that companion was named by me

  Scenario: Forgetting my name for a companion gives theirs back
    Given that companion goes by "Slagyr"
    And I call that companion "Micah"
    When I call that companion ""
    Then my companions are called "Slagyr"
    And that companion was named by them

  Scenario: An invitation can ask for one hero
    Given that companion also has the heroes Brannoch and Ilse
    When I open a new door and invite that companion, asking for Brannoch
    Then they are invited
    And their invitation asks for Brannoch

  Scenario: The hero asked for can be changed
    Given that companion also has the heroes Brannoch and Ilse
    When I open a new door and invite that companion, asking for Brannoch
    And I ask for Ilse instead
    Then they were already invited
    And their invitation asks for Ilse

  Scenario: A fallen hero cannot be asked for
    Given the companion's hero Slagette has fallen
    When I open a new door and invite that companion, asking for Slagette
    Then the invitation is refused with "Slagette is dead"
    And they have no invitation

  Scenario: A retired hero cannot be asked for
    Given the companion's hero Slagette is retired
    When I open a new door and invite that companion, asking for Slagette
    Then the invitation is refused with "Slagette is retired"
    And they have no invitation

  Scenario: A hero that falls after the invitation is no longer asked for
    Given that companion also has the heroes Brannoch
    When I open a new door and invite that companion, asking for Brannoch
    And the companion's hero Brannoch has fallen
    Then their invitation asks for no hero

  Scenario: An invitation says who sent it
    Given I go by "Justin"
    When I open a new door and invite that companion
    Then their invitation is from the person "Justin"

  Scenario: An invitation from someone unnamed names only their hero
    When I open a new door and invite that companion
    Then their invitation names no person

  Scenario: A name is at most 24 characters
    When I try to go by a name of 25 letters
    Then the name is refused as too long
