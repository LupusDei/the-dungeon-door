Feature: Range bands

  A fight is a map of 5-foot squares. Distance is 5 times the Chebyshev distance. Each combatant
  is engaged within melee reach, near (30 feet or less), or far (beyond that). A room starts the
  sides 30 feet apart. A road starts them 60 feet apart. Dash spends the action and doubles speed.

  Scenario: A fight starts with both sides near
    Given a fight between Bryn and a goblin
    Then Bryn is near
    And the goblin is near

  Scenario: One move engages a foe who is near
    Given a fight between Bryn and a goblin
    When Bryn moves to engage the goblin
    Then Bryn is engaged with the goblin
    And the goblin is engaged with Bryn

  Scenario: Dash covers the two bands from near to a far foe
    Given a fight between Bryn and a goblin
    And the goblin stands far
    When Bryn dashes to engage the goblin
    Then Bryn is engaged with the goblin

  Scenario: Leaving melee without Disengage draws an opportunity attack
    Given a fight between Bryn and a goblin
    And they are engaged
    And the goblin hits
    When Bryn moves to near
    Then the goblin made an opportunity attack
    And Bryn is near

  Scenario: Disengage leaves melee with no opportunity attack
    Given a fight between Bryn and a goblin
    And they are engaged
    And the goblin hits
    When Bryn disengages to near
    Then the goblin made no opportunity attack
    And Bryn is near

  Scenario: A move that changes nothing is refused
    Given a fight between Bryn and a goblin
    When Bryn moves to near
    Then the move is refused

  Scenario: Attacking from near steps into melee
    Given a fight between Bryn and a goblin
    When Bryn attacks
    Then Bryn is engaged with the goblin

  Scenario: Burning hands catches the goblins the caster steps into
    Given Cleo fights two goblins
    When Cleo casts burning hands
    Then the spell catches 2 goblins

  Scenario: A room is 10 by 8 and the sides start 30 feet apart
    Given a fight between Bryn and a goblin
    Then the battlefield is 10 by 8
    And Bryn and the goblin are 30 feet apart
    And Bryn stands on the western edge

  Scenario: A road is 16 by 6 and the sides start 60 feet apart
    Given a fight on the road between Bryn and a goblin
    Then the battlefield is 16 by 6
    And Bryn and the goblin are 60 feet apart
    And Bryn is far

  Scenario: Stepping onto a neighbouring square engages
    Given a fight between Bryn and a goblin
    When Bryn steps beside the goblin
    Then Bryn is engaged with the goblin
    And Bryn and the goblin are 5 feet apart

  Scenario: A square out of reach draws an opportunity attack
    Given a fight between Bryn and a goblin
    And they are engaged
    And the goblin hits
    When Bryn steps out of the goblin's reach
    Then the goblin made an opportunity attack

  Scenario: Dash is what closes 60 feet
    Given a fight on the road between Bryn and a goblin
    Then Bryn cannot engage the goblin in one move
    And Bryn can engage the goblin with a Dash
