Feature: Experience from actions

  Every action a hero declares earns experience, and how much goes by how
  likely its result was. The engine works the chance out from the bonus,
  the DC or armour class, and Advantage or Disadvantage. What everyone
  expected earns what it always did; a sure thing earns very little; a
  success against the odds, a long shot that landed, and a failure that
  should not have happened earn more, the rarer the more. In a fight
  every hero who acts earns a little each round, and a surprise a quarter
  of what it earns outside one. Amounts are for a level 1 hero.

  Scenario: A plain success earns what it always did
    Given the hero Bryn has an Athletics bonus of 5
    And the party's choice is an Athletics check against DC 15
    When Bryn takes it and the d20 shows 12
    Then Bryn earns 5 XP for "taking part"
    And Bryn earns 10 XP for "a success"
    And what happened to Bryn had 55 chances in 100

  Scenario: A plain failure is a brave failure
    Given the hero Bryn has an Athletics bonus of 5
    And the party's choice is an Athletics check against DC 15
    When Bryn takes it and the d20 shows 4
    Then Bryn earns 5 XP for "a brave failure"
    And what happened to Bryn had 45 chances in 100

  Scenario: A sure thing earns very little
    Given the hero Bryn has an Athletics bonus of 9
    And the party's choice is an Athletics check against DC 10
    When Bryn takes it and the d20 shows 2
    Then Bryn earns 3 XP for "a sure thing"
    And Bryn earns 8 XP in all

  Scenario: A success against the odds earns twice a plain one
    Given the hero Bryn has an Athletics bonus of 0
    And the party's choice is an Athletics check against DC 17
    When Bryn takes it and the d20 shows 18
    Then Bryn earns 20 XP for "against the odds"
    And what happened to Bryn had 20 chances in 100

  Scenario: A long shot that lands earns four times a plain success
    Given the hero Bryn has an Athletics bonus of 1
    And the party's choice is an Athletics check against DC 20
    When Bryn takes it and the d20 shows 19
    Then Bryn earns 40 XP for "a long shot that landed"
    And Bryn earns 45 XP in all
    And the log of the turn tells "+40 XP: a long shot that landed (Bryn)."
    And what happened to Bryn had 10 chances in 100

  Scenario: A failure that should not have happened is a hard lesson
    Given the hero Bryn has an Athletics bonus of 5
    And the party's choice is an Athletics check against DC 10
    When Bryn takes it and the d20 shows 3
    Then Bryn earns 15 XP for "a hard lesson"
    And what happened to Bryn had 20 chances in 100

  Scenario: A sure thing that slips earns more still
    Given the hero Bryn has an Athletics bonus of 8
    And the party's choice is an Athletics check against DC 10
    When Bryn takes it and the d20 shows 1
    Then Bryn earns 30 XP for "a sure thing that slipped"
    And what happened to Bryn had 5 chances in 100

  Scenario: A long shot that fails is a brave failure, with no more for trying
    Given the hero Bryn has an Athletics bonus of 1
    And the party's choice is an Athletics check against DC 20
    When Bryn takes it and the d20 shows 10
    Then Bryn earns 5 XP for "a brave failure"
    And Bryn earns 10 XP in all

  Scenario: Advantage makes a likely success a sure thing
    Given the hero Bryn has an Athletics bonus of 5
    And the party's choice is an Athletics check against DC 12
    And that check is made with Advantage
    When Bryn takes it and the d20 shows 15
    Then Bryn earns 3 XP for "a sure thing"
    And what happened to Bryn had 91 chances in 100

  Scenario: A pick that rolls nothing earns for taking part alone
    Given the hero Bryn has an Athletics bonus of 5
    And the party's choice rolls nothing
    When Bryn takes it and the d20 shows 12
    Then Bryn earns 5 XP in all
    And no d20 decided what Bryn earned

  Scenario: A die the clock threw earns half of what the action would
    Given the hero Bryn has an Athletics bonus of 1
    And the party's choice is an Athletics check against DC 20
    When Bryn takes it but the clock throws a 20
    Then Bryn earns 20 XP for "a long shot that landed"
    And Bryn earns 22 XP in all

  Scenario: The turn's result says what each hero earned and why
    Given the hero Bryn has an Athletics bonus of 5
    And the party's choice is an Athletics check against DC 10
    When Bryn takes it and the d20 shows 3
    Then the turn's result gives Bryn 20 XP: "taking part" 5, "a hard lesson" 15

  Scenario: In a fight every action earns a little, without a line
    Given the hero Bryn is in a round of a fight
    When in that round Bryn dodges
    Then Bryn earns 1 XP for "in the fight"
    And the turn's log has no line about XP

  Scenario: A hit that was likely is no surprise
    Given the hero Bryn is in a round of a fight
    When in that round Bryn attacks armour class 15 at 5 to hit and the d20 shows 12
    Then Bryn earns 1 XP for "in the fight"
    And no d20 decided what Bryn earned

  Scenario: A miss that should have hit is a hard lesson, at a quarter
    Given the hero Bryn is in a round of a fight
    When in that round Bryn attacks armour class 12 at 6 to hit and the d20 shows 3
    Then Bryn earns 4 XP for "a hard lesson"
    And the log of the turn tells "+4 XP: a hard lesson (Bryn)."
    And what happened to Bryn had 25 chances in 100

  Scenario: A hit that needed a natural 20 is a long shot that landed
    Given the hero Bryn is in a round of a fight
    When in that round Bryn attacks armour class 25 at 4 to hit and the d20 shows 20
    Then Bryn earns 10 XP for "a long shot that landed"
    And what happened to Bryn had 5 chances in 100

  Scenario: A miss that only a natural 1 could bring is a sure thing that slipped
    Given the hero Bryn is in a round of a fight
    When in that round Bryn attacks armour class 10 at 9 to hit and the d20 shows 1
    Then Bryn earns 8 XP for "a sure thing that slipped"
    And what happened to Bryn had 5 chances in 100

  Scenario: A foe that fails a save it should have made counts for the caster
    Given the hero Bryn is in a round of a fight
    When in that round a foe saving at 9 against Bryn's spell, DC 13, shows 2
    Then Bryn earns 5 XP for "against the odds"
    And what happened to Bryn had 15 chances in 100

  Scenario: Darts that never miss earn only a little
    Given the hero Bryn is in a round of a fight
    When in that round Bryn casts darts that never miss
    Then Bryn earns 1 XP for "in the fight"

  Scenario: Two attacks in one action are paid once, for the more telling
    Given the hero Bryn is in a round of a fight
    When in that round Bryn attacks armour class 12 at 6 to hit and the d20 shows 15
    And in that round Bryn attacks armour class 12 at 6 to hit and the d20 shows 3
    Then Bryn earns 4 XP in all

  Scenario: An opportunity attack is not the hero's action
    Given the hero Bryn is in a round of a fight
    When in that round Bryn dodges
    And in that round Bryn's opportunity attack on armour class 25 at 4 to hit shows 20
    Then Bryn earns 1 XP in all

  Scenario: The clock's die halves a round's award too
    Given the hero Bryn is in a round of a fight
    And the clock threw Bryn's die
    When in that round Bryn attacks armour class 25 at 4 to hit and the d20 shows 20
    Then Bryn earns 5 XP in all

  Scenario: A hero who is down earns nothing in a round
    Given a goblin is fought by Bryn and Cleo
    And Cleo has fallen in that fight
    When both vote and the round is played
    Then Bryn earns 1 XP in all
    And Cleo earns no XP
