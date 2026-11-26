(ns gherclj.band-steps
  "Routes the range-band feature onto features/band_steps.ts."
  (:require [gherclj.core :refer [defgiven defwhen defthen helper!]]
            [gherclj.frameworks.typescript.node-test :as typescript]))

(helper! "features/band_steps")

(typescript/describe-setup! "let steps: band_steps.BandSteps")
(typescript/describe-setup! "beforeEach(() => {\n  steps = new band_steps.BandSteps()\n})")

(defgiven "a fight between Bryn and a goblin" steps.start)
(defgiven "a fight on the road between Bryn and a goblin" steps.road)
(defgiven "the goblin stands far" steps.goblin-far)
(defgiven "they are engaged" steps.both-engaged)
(defgiven "the goblin hits" steps.goblin-hits)
(defgiven "Cleo fights two goblins" steps.cleo)

(defwhen "Bryn moves to engage the goblin" steps.engage)
(defwhen "Bryn dashes to engage the goblin" steps.dash-engage)
(defwhen "Bryn moves to near" steps.move-near)
(defwhen "Bryn disengages to near" steps.disengage-near)
(defwhen "Bryn attacks" steps.attack)
(defwhen "Cleo casts burning hands" steps.burning-hands)
(defwhen "Bryn steps beside the goblin" steps.step-beside)
(defwhen "Bryn steps out of the goblin's reach" steps.step-out)

(defthen "Bryn is {position}" steps.bryn-at)
(defthen "the goblin is {position}" steps.goblin-at)
(defthen "Bryn is engaged with the goblin" steps.bryn-holds-goblin)
(defthen "the goblin is engaged with Bryn" steps.goblin-holds-bryn)
(defthen "the goblin made an opportunity attack" steps.opportunity-attack)
(defthen "the goblin made no opportunity attack" steps.no-opportunity-attack)
(defthen "the move is refused" steps.refused)
(defthen "the spell catches {count:int} goblins" steps.caught)
(defthen "the battlefield is {width:int} by {height:int}" steps.battlefield-size)
(defthen "Bryn and the goblin are {feet:int} feet apart" steps.feet-apart)
(defthen "Bryn stands on the western edge" steps.western-edge)
(defthen "Bryn cannot engage the goblin in one move" steps.cannot-engage)
(defthen "Bryn can engage the goblin with a Dash" steps.can-dash)
