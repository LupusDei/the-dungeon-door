(ns gherclj.streamlined-steps
  "Step routing for a streamlined game: the telling a host picks at the door, and the length the engine holds it to."
  (:require [gherclj.core :refer [defgiven defwhen defthen helper!]]
            [gherclj.frameworks.typescript.node-test :as typescript]))

(helper! "features/streamlined_steps")

(typescript/describe-setup! "let subject: streamlined_steps.StreamlinedSteps")
(typescript/describe-setup! "beforeEach(() => {\n  subject = new streamlined_steps.StreamlinedSteps()\n})")

(defgiven "a dungeon master who writes at length" subject.wordy-dungeon-master)

(defwhen "the host opens the door without naming a telling" subject.opens-without-a-telling)
(defwhen "the host opens the door on a {telling:string} game" subject.opens-on-a)
(defwhen "the party picks the second choice" subject.party-picks-the-second-choice)

(defthen "the catalog offers the tellings {ids:string}" subject.catalog-offers)
(defthen "the game is told {telling:string}" subject.game-is-told)
(defthen "the dungeon master was asked for a {telling:string} game" subject.dungeon-master-was-asked-for)
(defthen "the scene is told in at most {sentences:int} sentences" subject.scene-in-at-most)
(defthen "the scene is told in more than {sentences:int} sentences" subject.scene-in-more-than)
(defthen "every choice's label is at most {words:int} words" subject.labels-at-most)
(defthen "every choice's detail is at most {words:int} words" subject.details-at-most)
(defthen "every choice still carries its dice" subject.choices-carry-their-dice)
(defthen "the dungeon master's aside is posted" subject.aside-is-posted)
(defthen "the dungeon master's aside is not posted" subject.aside-is-not-posted)
(defthen "what happened is told in {sentences:int} sentence" subject.what-happened-in)
(defthen "what happened is told in {sentences:int} sentences" subject.what-happened-in)
(defthen "the turn's result names every hero" subject.result-names-every-hero)
(defthen "the choice's check is in the dice log" subject.check-is-in-the-dice-log)
(defthen "the start is refused" subject.start-is-refused)
(defthen "the party is still at the door" subject.still-at-the-door)
