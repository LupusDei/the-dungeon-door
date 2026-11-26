(ns gherclj.freeform-steps
  "Step routing for a player writing their own action."
  (:require [gherclj.core :refer [defgiven defwhen defthen helper!]]
            [gherclj.frameworks.typescript.node-test :as typescript]))

(helper! "features/freeform_steps")

(typescript/describe-setup! "let subject: freeform_steps.FreeformSteps")
(typescript/describe-setup! "beforeEach(() => {\n  subject = new freeform_steps.FreeformSteps()\n})")

(defgiven "a fight is underway" subject.fight-underway)
(defgiven "no fight is underway" subject.no-fight)

(defwhen "the player writes {text:string}" subject.player-writes)
(defwhen "the dungeon master returns something unreadable" subject.unreadable)

(defthen "the action maps to today's choice {choice:string}" subject.maps-to)
(defthen "the turn is spent" subject.turn-is-spent)
(defthen "the turn is not spent" subject.turn-is-not-spent)
(defthen "the check is against DC {dc:int}" subject.against-dc)
(defthen "the damage dice are {dice:string}" subject.damage-dice)
(defthen "the dice log contains {fragment:string}" subject.log-contains)
(defthen "the narration refuses the action" subject.narration-refuses)
(defthen "the foe has lost hit points" subject.foe-has-lost-hit-points)
