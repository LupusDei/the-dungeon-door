(ns gherclj.action-xp-steps
  "Step routing for experience from actions: a hero's d20 paid by the chance its result had, outside a fight and in a round."
  (:require [gherclj.core :refer [defgiven defwhen defthen helper!]]
            [gherclj.frameworks.typescript.node-test :as typescript]))

(helper! "features/action_xp_steps")

(typescript/describe-setup! "let subject: action_xp_steps.ActionXpSteps")
(typescript/describe-setup! "beforeEach(() => {\n  subject = new action_xp_steps.ActionXpSteps()\n})")

(defgiven "the hero {name} has an Athletics bonus of {bonus:int}" subject.hero-with-bonus)
(defgiven "the party's choice is an Athletics check against DC {dc:int}" subject.choice-is-a-check)
(defgiven "that check is made with Advantage" subject.with-advantage)
(defgiven "the party's choice rolls nothing" subject.choice-rolls-nothing)
(defgiven "the hero {name} is in a round of a fight" subject.hero-in-a-round)
(defgiven "the clock threw {name}'s die" subject.clock-threw)
(defgiven "a goblin is fought by {first} and {second}" subject.fighting-a-goblin)
(defgiven "{name} has fallen in that fight" subject.has-fallen)

(defwhen "{name} takes it and the d20 shows {roll:int}" subject.takes-it)
(defwhen "{name} takes it but the clock throws a {roll:int}" subject.takes-it-by-clock)
(defwhen "in that round {name} dodges" subject.dodges)
(defwhen "in that round {name} attacks armour class {ac:int} at {bonus:int} to hit and the d20 shows {roll:int}" subject.attacks)
(defwhen "in that round {name}'s opportunity attack on armour class {ac:int} at {bonus:int} to hit shows {roll:int}" subject.opportunity-attack)
(defwhen "in that round a foe saving at {bonus:int} against {name}'s spell, DC {dc:int}, shows {roll:int}" subject.foe-saves)
(defwhen "in that round {name} casts darts that never miss" subject.casts-darts)
(defwhen "both vote and the round is played" subject.round-is-played)

(defthen "{name} earns {xp:int} XP for {label:string}" subject.earns-for)
(defthen "{name} earns {xp:int} XP in all" subject.earns-in-all)
(defthen "{name} earns no XP" subject.earns-nothing)
(defthen "what happened to {name} had {chances:int} chances in 100" subject.had-chances)
(defthen "no d20 decided what {name} earned" subject.no-die-decided)
(defthen "the log of the turn tells {line:string}" subject.log-tells)
(defthen "the turn's log has no line about XP" subject.log-tells-no-xp)
(defthen "the turn's result gives {name} {xp:int} XP: {first:string} {a:int}, {second:string} {b:int}" subject.result-gives)
