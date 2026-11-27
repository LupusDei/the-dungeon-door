(ns gherclj.turn-result-steps
  "Step routing for the turn's result: who picked the party's choice, who rolled for it, and what each hero did."
  (:require [gherclj.core :refer [defgiven defwhen defthen helper!]]
            [gherclj.frameworks.typescript.node-test :as typescript]))

(helper! "features/turn_result_steps")

(typescript/describe-setup! "let subject: turn_result_steps.TurnResultSteps")
(typescript/describe-setup! "beforeEach(() => {\n  subject = new turn_result_steps.TurnResultSteps()\n})")

(defgiven "a table of {names:string}" subject.table-of)
(defgiven "the hero {name:string} is the better talker" subject.better-talker)
(defgiven "the first choice is a Persuasion check for one hero" subject.persuasion-choice)

(defwhen "the hero {name:string} picks the first choice with a {roll:int}" subject.picks-first)
(defwhen "the hero {name:string} writes {text:string} with a {roll:int}" subject.writes)
(defwhen "the turn is resolved" subject.resolve)

(defthen "the party's choice was picked by {names:string}" subject.picked-by)
(defthen "the hero {name:string} rolled {check:string} with their own {roll:int}" subject.rolled-own)
(defthen "the hero {name:string} rolled nothing for the party's choice" subject.rolled-nothing)
(defthen "the hero {name:string} did their own {text:string}" subject.did-own)
(defthen "the result lists {names:string}" subject.lists)
(defthen "the hero {name:string} did nothing" subject.did-nothing)
