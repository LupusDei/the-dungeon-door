(ns gherclj.fight-choices-steps
  "Step routing for a fight's three choices: what each stands for, and that a weapon or spell the player names stays theirs."
  (:require [gherclj.core :refer [defgiven defwhen defthen helper!]]
            [gherclj.frameworks.typescript.node-test :as typescript]))

(helper! "features/fight_choices_steps")

(typescript/describe-setup! "let subject: fight_choices_steps.FightChoicesSteps")
(typescript/describe-setup! "beforeEach(() => {\n  subject = new fight_choices_steps.FightChoicesSteps()\n})")

(defgiven "a {hero} fights {foes:string}" subject.hero-fights)
(defgiven "the {foe:string} has lost half its hit points" subject.has-lost-half)

(defwhen "the player picks {name:string} for the {foe:string}" subject.picks-for)
(defwhen "the words {text:string} are written in the fight" subject.words-are-written)

(defthen "the round's choices are headed {a:string}, {b:string} and {c:string}" subject.choices-are-headed)
(defthen "a plain pick of the spell choice casts {spell:string}" subject.plain-pick-casts)
(defthen "the pick plays as choice {choice:string}" subject.pick-plays-as)
(defthen "the pick is {label:string} at {foe:string}" subject.pick-is)
(defthen "the written action is {label:string} at {foe:string}" subject.written-action-is)
