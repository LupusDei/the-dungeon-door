(ns gherclj.quest-steps
  "Step routing for the quest's goal and the scene count as a plan."
  (:require [gherclj.core :refer [defgiven defwhen defthen helper!]]
            [gherclj.frameworks.typescript.node-test :as typescript]))

(helper! "features/quest_steps")

(typescript/describe-setup! "let subject: quest_steps.QuestSteps")
(typescript/describe-setup! "beforeEach(() => {\n  subject = new quest_steps.QuestSteps()\n})")

(defgiven "a fixed-map adventure of {planned:int} scenes for two level-1 heroes" subject.fixed-map)
(defgiven "a tale of {planned:int} scenes with its quest" subject.tale)

(defwhen "the party plays {scenes:int} scenes of the tale" subject.plays-tale)
(defwhen "the party plays {scenes:int} scene of the tale" subject.plays-tale)
(defwhen "the party reaches the goal" subject.reaches-goal)
(defwhen "the ending is called" subject.host-calls)

(defthen "the goal is in room {room}" subject.goal-in)
(defthen "the goal is a high fight for the party" subject.high-fight)
(defthen "the next scene is the epilogue" subject.next-is-epilogue)
(defthen "the quest goes on" subject.still-going)
(defthen "the scene is scene {scene:int} of about {of:int}" subject.scene-of-about)
(defthen "the first choice faces the goal" subject.faces-goal)
