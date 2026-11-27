Feature: Everyone is in the picture

  A scene's picture shows the whole party. The heroes the dungeon master
  features stand nearest the viewer; nobody alive is left out.

  Scenario: A party of six is all painted
    Given the party to paint is Tiny, Rastigar, Ilsa, Bryn, Corin and Maud
    When the scene is painted
    Then the painter is told to paint 6 heroes
    And everyone in the picture is Tiny, Rastigar, Ilsa, Bryn, Corin and Maud

  Scenario: The heroes the dungeon master features stand nearest
    Given the party to paint is Tiny, Rastigar, Ilsa, Bryn, Corin and Maud
    And the dungeon master features Corin
    When the scene is painted
    Then Corin stands nearest the viewer
    And the painter is told to paint 6 heroes

  Scenario: The fallen are not painted
    Given the party to paint is Tiny, Rastigar, Ilsa, Bryn, Corin and Maud
    And Bryn died on the way
    When the scene is painted
    Then the painter is told to paint 5 heroes
    And Bryn is not in the picture
