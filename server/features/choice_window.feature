Feature: The choice window

  While the party is choosing, the game view says when that window ends.
  The window is for the table to see. A vote is still taken after it,
  and the scene does not resolve by itself.

  Scenario: Choosing opens a window from when the scene began
    Given the scene began at "2026-11-27T00:00:00.000Z"
    And the server clock reads "2026-11-27T00:00:10.000Z"
    When the party is choosing its action
    Then the deadline is "2026-11-27T00:01:30.000Z"
    And the window is 90 seconds
    And the view carries the server clock "2026-11-27T00:00:10.000Z"

  Scenario: The window stays visible after it has run out
    Given the scene began at "2026-11-27T00:00:00.000Z"
    And the server clock reads "2026-11-27T00:02:00.000Z"
    When the party is choosing its action
    Then the deadline is "2026-11-27T00:01:30.000Z"
    And the window is 90 seconds

  Scenario: The window is closed while the next turn is written
    Given the scene began at "2026-11-27T00:00:00.000Z"
    And the server clock reads "2026-11-27T00:00:10.000Z"
    When the dungeon master is writing the next turn
    Then there is no choice window
