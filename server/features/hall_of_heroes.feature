Feature: The Hall of Heroes

  A player's heroes leave the home screen's roster when they retire or
  fall, but they are kept. The retired can come back; the fallen are
  remembered with how and where they died, until a temple raises them.
  Nothing deletes a hero for good: an older app's delete retires it.

  Scenario: The roster asks for the active, the retired, the dead or all
    Given I have the heroes Bryn, Ilsa, Cleo and Dag
    And Ilsa has retired
    And Cleo has died
    And Dag has died
    And Dag has retired
    Then my active heroes are Bryn
    And my retired heroes are Ilsa
    And my dead heroes are Cleo and Dag
    And all my heroes are Bryn, Cleo, Dag and Ilsa
    And listing my heroes with no status gives Bryn and Cleo

  Scenario: Only the four statuses are asked for
    Given I have the heroes Bryn
    When I ask for my "buried" heroes
    Then it is refused as a bad request naming active, retired, dead and all

  Scenario: Retiring stamps the hero, and once only
    Given I have the heroes Bryn and Ilsa
    When I retire Bryn
    And I retire Bryn again
    Then Bryn is marked retired
    And Bryn keeps the date of the first retirement
    And my active heroes are Ilsa

  Scenario: A retired hero cannot open a door
    Given I have the heroes Bryn
    And Bryn has retired
    When Bryn tries to open a door
    Then it is refused with "Bryn is retired"

  Scenario: A retired hero cannot join a party
    Given I have the heroes Bryn
    And a stranger has opened a door with Ilsa
    And Bryn has retired
    When Bryn tries to join Ilsa's party
    Then it is refused with "Bryn is retired"

  Scenario: Un-retiring brings a hero back to the roster
    Given I have the heroes Bryn
    And Bryn has retired
    When I un-retire Bryn
    Then Bryn is not retired
    And my active heroes are Bryn
    And my retired heroes are none

  Scenario: The dead are not un-retired
    Given I have the heroes Cleo
    And Cleo has died
    And Cleo has retired
    When I un-retire Cleo
    Then it is refused with "Cleo is dead: the dead are not un-retired, but a temple can raise them"
    And my dead heroes are Cleo

  Scenario: A hero who is not retired cannot be un-retired
    Given I have the heroes Bryn
    When I un-retire Bryn
    Then it is refused with "Bryn is not retired"

  Scenario: Someone else's hero is not found
    Given a stranger has the retired hero Ilsa
    When I un-retire Ilsa
    Then it is not found
    And the stranger's Ilsa is still retired

  Scenario: An older app's delete retires the hero
    Given I have the heroes Bryn
    When I delete Bryn
    Then Bryn is marked retired
    And my retired heroes are Bryn
    And listing my heroes with no status gives none

  Scenario: A hero slain on an adventure has a death entry
    Given I have the heroes Bryn
    When Bryn is slain by a tyrannosaurus on an adventure
    Then Bryn is marked dead
    And Bryn's death names the adventure and a scene of it
    And Bryn's death says "Bryn is dead."
    And my dead heroes are Bryn
    And my active heroes are none

  Scenario: Raise Dead clears the retirement and the death
    Given I have the heroes Cleo
    And Cleo fell in "The Flooded Crypt"
    And Cleo has retired
    And Cleo has 2500 gold
    When the temple raises Cleo
    Then Cleo is not retired
    And Cleo has no death
    And my active heroes are Cleo
