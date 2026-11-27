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

  Scenario: A whisper is heard only by the people it names
    Given the table is Bryn and Ilsa and Mara
    When Bryn whispers "The door is trapped" to "Ilsa"
    Then the line is a whisper to the hero "Ilsa"
    And only Bryn and Ilsa can see that line
    And the narrator never hears "The door is trapped"

  Scenario: A whisper can name two heroes
    Given the table is Bryn and Ilsa and Mara
    When Bryn whispers "Stay back" to "Ilsa and Mara"
    Then the line is a whisper to the hero "Ilsa"
    And the line is a whisper to the hero "Mara"
    And only Bryn and Ilsa and Mara can see that line
    And the narrator never hears "Stay back"

  Scenario: A slash whisper names a hero, spaces and all
    Given the table is Bryn and Ilsa of the Gate and Mara
    When Bryn says in character "/whisper Ilsa of the Gate the left door"
    Then the line reads "the left door"
    And the line is a whisper to the hero "Ilsa of the Gate"
    And only Bryn and Ilsa of the Gate can see that line
    And the narrator never hears "the left door"

  Scenario: A slash whisper can name the player
    When Bryn says out of character "/w player:Ilsa, look here"
    Then the line reads "look here"
    And the line is a whisper to the player of "Ilsa"
    And the narrator never hears "look here"

  Scenario: A reply to a whisper stays inside it
    Given the table is Bryn and Ilsa and Mara
    When Bryn whispers "The door is trapped" to "Ilsa"
    And Ilsa replies in character "I saw it" to that line
    Then only Bryn and Ilsa can see that line
    And the narrator never hears "I saw it"
    And the narrator never hears "The door is trapped"

  Scenario: An in-character emote is something the hero does
    When Bryn emotes in character "draws her sword"
    Then the line is an emote by "Bryn" saying "draws her sword"
    And the narrator keeps it as something "Bryn" does: "draws her sword"

  Scenario: An out-of-character emote is not a deed of the hero
    When Bryn emotes out of character "checks the time"
    Then the line is an emote by "Bryn" saying "checks the time"
    And the narrator does not keep "checks the time" as a deed

  Scenario: A slash emote is the same deed
    When Bryn says in character "/me draws her sword"
    Then the line is an emote by "Bryn" saying "draws her sword"
    And the narrator keeps it as something "Bryn" does: "draws her sword"

  Scenario: A line names a hero and a player, spaces included
    Given the table is Bryn and Ilsa of the Gate
    When Bryn says out of character "Ask @Ilsa of the Gate and @player:Ilsa of the Gate"
    Then the line mentions the hero "Ilsa of the Gate"
    And the line mentions the player of "Ilsa of the Gate"
