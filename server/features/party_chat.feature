Feature: Party chat

  When a situation comes up, the party talks it over before anyone chooses.
  A line can answer another, name someone at the table, be the hero or the
  player, and carry a reaction. The line keeps its id, so a later proposal
  can hang off it and a reaction can count as agreement.

  Background:
    Given the table is Bryn and Ilsa

  Scenario: A hero answers another hero, and the quote comes along
    When Bryn says in character "We should take the left door"
    And Ilsa replies in character "The left door it is" to that line
    Then the reply quotes "We should take the left door"
    And the reply is in character as the hero "Ilsa"
    And the reply keeps its own id, distinct from the line it quotes

  Scenario: A player steps out of character and names a hero
    When Bryn says out of character "What do you think, @Ilsa?"
    Then the line is out of character from the player of "Bryn"
    And the line mentions the hero "Ilsa"

  Scenario: A line can name the player rather than the hero
    When Ilsa says out of character "Ask @player:Bryn before we open it"
    Then the line mentions the player of "Bryn"

  Scenario: A reaction toggles off and the line keeps its id
    Given Bryn said in character "Hold here"
    When Ilsa reacts to that line with "👍"
    And Ilsa reacts to that line with "👍"
    Then that line still has its original id
    And that line has no "👍" reaction

  Scenario: Reactions count who marked the line
    Given Bryn said in character "Hold here"
    When Ilsa reacts to that line with "❤️"
    And Bryn reacts to that line with "❤️"
    Then that line has 2 "❤️" reactions including "Ilsa" and "Bryn"
    And that line still has its original id

  Scenario: The rest of the table can see who is writing
    When Ilsa is typing
    Then the next look at the table shows "Ilsa" typing
