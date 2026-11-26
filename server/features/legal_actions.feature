Feature: Legal actions

  Each hero, each turn, is offered every action they could take. A vote names
  one of them, and a target when the action needs one. An action they cannot
  take stays on the list with the reason.

  Scenario: A fighter in a fight sees weapons, Second Wind and the common actions
    Given a fighter in a fight
    Then a weapon attack is offered
    And "feature:second-wind" is available
    And "common:dodge" is available
    And "common:dash" is available
    And "common:help" is unavailable because "No one to help"

  Scenario: A prepared spell with no slot stays on the list
    Given a wizard with "magic-missile" prepared and no slots left
    Then "spell:magic-missile" is unavailable because "No level 1 spell slot or higher left"

  Scenario: A vote names a weapon, and that weapon strikes
    Given a fighter who carries a greatsword in a fight
    When the fighter swings the greatsword
    Then the vote is accepted
    And the engine strikes with "Greatsword"

  Scenario: A vote for a foe who is not there is refused
    Given a fighter in a fight
    When the fighter votes to attack "nobody"
    Then the vote is refused

  Scenario: Out of a fight the scene's choices join the list
    Given the choices "Engage", "Run" and "Parley"
    Then "choice:a" is available
    And "choice:a" is labeled "Engage"
    And "choice:b" is labeled "Run"
    And "common:attack" is unavailable because "Not in a fight"
