(ns gherclj.toughness-steps
  "Step routing for sizing up a fight. Each phrase maps to a method on the TypeScript subject."
  (:require [gherclj.core :refer [defgiven defwhen defthen helper!]]
            [gherclj.frameworks.typescript.node-test :as typescript]))

(helper! "features/toughness_steps")

(typescript/describe-setup! "let subject: toughness_steps.ToughnessSteps")
(typescript/describe-setup! "beforeEach(() => {\n  subject = new toughness_steps.ToughnessSteps()\n})")

(defgiven "a party of four level 1 heroes" subject.party-of-four)

(defwhen "the party is offered a fight with {count:int} {name:string}" subject.offered-fight)
(defthen "the fight choice reads {line:string}" subject.fight-choice-reads)

(defwhen "the party engages {count:int} {name:string}" subject.party-engages)
(defthen "the foe {name:string} is shown as {toughness:string}" subject.foe-shown-as)
(defthen "the fight is shown as {band:string}" subject.fight-shown-as)

(defwhen "the party steps into a room of {count:int} hostile {name:string} guarding {gold:int} gold" subject.steps-into-hostile-room)
(defthen "no fight has started" subject.no-fight-has-started)
(defthen "the party is offered {first:string}, {second:string} and {third:string}" subject.offered-choices)
(defthen "the waiting notice shows {foes:string}, each {toughness:string}, a {band:string} fight" subject.waiting-notice)
(defthen "engaging would be {line:string}" subject.engaging-would-be)

(defwhen "the party runs" subject.party-runs)
(defthen "the party has left that room" subject.left-that-room)
(defthen "that room is not cleared" subject.room-not-cleared)
(defthen "the party's gold is unchanged" subject.gold-unchanged)
(defthen "the party's experience is unchanged" subject.experience-unchanged)
