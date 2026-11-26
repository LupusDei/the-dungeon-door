Feature: Range bands

  A fight has no grid. Each combatant is engaged with specific foes, near (about 30 feet), or far
  (about 60 feet). A move changes one band. Dash changes two and spends the action.

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
