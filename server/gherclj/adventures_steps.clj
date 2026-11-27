(ns gherclj.adventures-steps
  "Step routing for an adventure's length, a hero's past adventures, and the account out of credit.
   Each phrase maps to a method on the TypeScript subject."
  (:require [gherclj.core :refer [defgiven defwhen defthen helper!]]
            [gherclj.frameworks.typescript.node-test :as typescript]))

(helper! "features/adventures_steps")

(typescript/describe-setup! "let quest: adventures_steps.AdventureSteps")
(typescript/describe-setup! "beforeEach(() => {\n  quest = new adventures_steps.AdventureSteps()\n})")

(defgiven "the party at the door is {party:string}" quest.party-at-the-door)
(defgiven "the dungeon master's account is out of credit" quest.account-out-of-credit)
(defgiven "{hero} has opened it for {count:int} scenes" quest.opens-for-scenes)
(defgiven "{hero} has opened it with no set length" quest.opens-with-no-set-length)
(defgiven "the party has played a scene" quest.plays-a-scene)
(defgiven "the party has played {count:int} scenes" quest.plays-scenes)

(defwhen "{hero} opens it for {count:int} scenes" quest.opens-for-scenes)
(defwhen "{hero} opens it with no set length" quest.opens-with-no-set-length)
(defwhen "the party plays a scene" quest.plays-a-scene)
(defwhen "the party plays {count:int} scenes" quest.plays-scenes)
(defwhen "the party plays the adventure to its end" quest.plays-to-the-end)
(defwhen "{hero} calls the ending" quest.calls-the-ending)
(defwhen "{hero} walks out of the adventure" quest.walks-out)

(defthen "{count:int} scenes are still to come" quest.scenes-still-to-come)
(defthen "{count:int} scene is still to come" quest.scenes-still-to-come)
(defthen "the last scene is being played" quest.last-scene-is-being-played)
(defthen "the scenes still to come are no longer counted" quest.no-longer-counted)
(defthen "the adventure has no set length" quest.has-no-set-length)
(defthen "the adventure is still going" quest.is-still-going)
(defthen "the adventure has reached its end" quest.has-reached-its-end)
(defthen "the door is still shut" quest.door-is-still-shut)
(defthen "the table hears that the ending was called" quest.table-hears-the-ending-was-called)
(defthen "{hero} is refused the ending" quest.is-refused-the-ending)
(defthen "the table hears the account is out of credit" quest.table-hears-the-account-is-out-of-credit)
(defthen "nobody is told to try again" quest.table-is-not-told-to-try-again)
(defthen "the quests of {hero} number {count:int}" quest.quests-number)
(defthen "the latest quest of {hero} has ended" quest.latest-quest-has-ended)
(defthen "the latest quest of {hero} is unfinished" quest.latest-quest-is-unfinished)
(defthen "the latest quest of {hero} keeps its pictures" quest.latest-quest-keeps-its-pictures)
(defthen "the latest quest of {hero} says how they came out" quest.latest-quest-says-how-they-came-out)
(defthen "the latest quest of {hero} was with {company:string}" quest.latest-quest-was-with)
