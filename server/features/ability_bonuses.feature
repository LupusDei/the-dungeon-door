Feature: Background ability bonuses

  Under the 2024 rules the background, not the species, raises the hero's
  scores: +2 to one of its three abilities and +1 to another, or +1 to each
  of the three. The player places them at the forge, and the preview shows
  the hero that will be saved. A hero the forge placed them for can place
  them once, later. A hero seated at a table plays the adventure with the
  sheet they sat down with, so a placement made then waits for the
  adventure to end.

  Background:
    Given Bryn is a human fighter whose soldier background raises "str", "dex" and "con"

  Scenario: The player puts +2 on one background ability and +1 on another
    When Bryn is forged with +2 to "con" and +1 to "str"
    Then the request is accepted
    And Bryn's sheet records +2 to "con" and +1 to "str"
    And Bryn's "con" is 1 above the forge's own placement
    And Bryn's "str" is 1 below the forge's own placement
    And Bryn's "dex" matches the forge's own placement
    And Bryn's bonuses are not open

  Scenario: The preview is the hero that gets saved
    When Bryn's sheet is previewed with +2 to "con" and +1 to "str"
    And Bryn is forged with +2 to "con" and +1 to "str"
    Then the preview matches Bryn's saved sheet

  Scenario: The player puts +1 on each of the three
    When Bryn is forged with +1 to each of the background's abilities
    Then the request is accepted
    And Bryn's sheet records +1 to each of the background's abilities
    And Bryn's "str" is 1 below the forge's own placement
    And Bryn's "dex" is 1 above the forge's own placement
    And Bryn's "con" matches the forge's own placement
    And Bryn's bonuses are not open

  Scenario: An ability the background does not raise is refused
    When Bryn is forged with +2 to "int" and +1 to "str"
    Then the request is refused as invalid with "int is not one of this background's abilities (str, dex, con)"
    And Bryn was not saved

  Scenario: The preview refuses an ability the background does not raise
    When Bryn's sheet is previewed with +2 to "cha" and +1 to "str"
    Then the request is refused as invalid with "cha is not one of this background's abilities (str, dex, con)"

  Scenario: The +2 and the +1 cannot land on the same ability
    When Bryn is forged with +2 to "str" and +1 to "str"
    Then the request is refused as invalid with "the +2 and +1 go to two different abilities"
    And Bryn was not saved

  Scenario: A total other than +2/+1 or +1/+1/+1 is refused
    When Bryn is forged with +3 to "str"
    Then the request is refused as invalid
    And Bryn was not saved

  Scenario: A hero the forge placed the bonuses for can place them once
    Given Bryn was forged without choosing the bonuses
    Then Bryn's bonuses are open
    And Bryn's "str" matches the forge's own placement
    When Bryn places +2 to "con" and +1 to "str"
    Then the request is accepted
    And Bryn's sheet records +2 to "con" and +1 to "str"
    And Bryn's "con" is 1 above the forge's own placement
    And Bryn's bonuses are not open
    When Bryn places +1 to each of the background's abilities
    Then the request is refused as a conflict with "the ability bonuses are already chosen"
    And Bryn's sheet records +2 to "con" and +1 to "str"

  Scenario: A hero who chose at the forge has nothing to place
    Given Bryn was forged with +2 to "con" and +1 to "str"
    When Bryn places +1 to each of the background's abilities
    Then the request is refused as a conflict with "the ability bonuses are already chosen"

  Scenario: Scores that have moved since the forge cannot take the bonuses
    Given Bryn was forged without choosing the bonuses
    And Bryn's "str" has since risen by 1
    Then Bryn's bonuses are not open
    When Bryn places +2 to "con" and +1 to "str"
    Then the request is refused as a conflict with "these scores are no longer the ones the forge assigned, so the bonuses cannot be placed"

  Scenario: Bonuses placed during an adventure wait for it to end
    Given Bryn was forged without choosing the bonuses
    And Bryn sits at a table with Ilsa
    And the adventure is under way
    When Bryn places +2 to "con" and +1 to "str"
    Then the request is accepted
    And at the table Bryn's "con" still matches the forge's own placement
    When the adventure ends
    Then Bryn's sheet records +2 to "con" and +1 to "str"
    And Bryn's "con" is 1 above the forge's own placement
    And Bryn's bonuses are not open

  Scenario: Bonuses placed in the lobby wait for the adventure too
    Given Bryn was forged without choosing the bonuses
    And Bryn sits at a table with Ilsa
    When Bryn places +2 to "con" and +1 to "str"
    And the adventure is under way
    Then at the table Bryn's "con" still matches the forge's own placement
    When the adventure ends
    Then Bryn's sheet records +2 to "con" and +1 to "str"
    And Bryn's "con" is 1 above the forge's own placement
