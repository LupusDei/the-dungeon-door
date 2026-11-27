(ns gherclj.choice-window-steps
  "Step routing for the choice window on a game view."
  (:require [gherclj.core :refer [defgiven defwhen defthen helper!]]
            [gherclj.frameworks.typescript.node-test :as typescript]))

(helper! "features/choice_window_steps")

(typescript/describe-setup! "let subject: choice_window_steps.ChoiceWindowSteps")
(typescript/describe-setup! "beforeEach(() => {\n  subject = new choice_window_steps.ChoiceWindowSteps()\n})")

(defgiven "the scene began at {at:string}" subject.scene-began)
(defgiven "the server clock reads {at:string}" subject.clock-reads)

(defwhen "the party is choosing its action" subject.table-is-choosing)
(defwhen "the dungeon master is writing the next turn" subject.table-is-resolving)

(defthen "the deadline is {iso:string}" subject.deadline-is)
(defthen "the window is {seconds:int} seconds" subject.window-is)
(defthen "the view carries the server clock {iso:string}" subject.view-carries)
(defthen "there is no choice window" subject.no-choice-window)
