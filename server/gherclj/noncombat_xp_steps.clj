(ns gherclj.noncombat-xp-steps
  "Step routing for experience outside a fight."
  (:require [gherclj.core :refer [defgiven defwhen defthen helper!]]
            [gherclj.frameworks.typescript.node-test :as typescript]))

(helper! "features/noncombat_xp_steps")

(typescript/describe-setup! "let subject: noncombat_xp_steps.NoncombatXpSteps")
(typescript/describe-setup! "beforeEach(() => {\n  subject = new noncombat_xp_steps.NoncombatXpSteps()\n})")

(defgiven "a level {level:int} party of {names:string}" subject.party-of)
(defgiven "{name:string} starts with {xp:int} XP" subject.has-xp)
(defgiven "{name:string} has a sharp eye" subject.sharp-eye)
(defgiven "the choice is {kind:string}" subject.choice-is)
(defgiven "the dungeon master tags it {tag:string}" subject.tagged)
(defgiven "a chapter milestone was paid {scenes:int} scenes ago" subject.chapter-ago)
(defgiven "the party is in a fight" subject.in-a-fight)

(defwhen "{name:string} declares and rolls {roll:int}" subject.declares)
(defwhen "{name:string} declares but the clock throws their {roll:int}" subject.declares-idle)
(defwhen "the scene is resolved" subject.resolve)
(defwhen "the quest ends" subject.quest-ends)

(defthen "the dice log says {line:string}" subject.log-says)
(defthen "the dice log does not mention {words:string}" subject.log-does-not-mention)
(defthen "the dice log has no XP for {name:string}" subject.no-xp-for)
(defthen "the dice log has no XP" subject.no-xp)
(defthen "{name:string} now has {xp:int} XP" subject.now-has)
(defthen "{name:string} is level {level:int}" subject.is-level)
(defthen "the sheet shows {name:string} at {xp:int} of {next:int} XP" subject.sheet-shows)
(defthen "the sheet shows {name:string} earned {xp:int} XP on this adventure" subject.sheet-shows-earned)
(defthen "the dungeon master is told {line:string}" subject.dm-told)
