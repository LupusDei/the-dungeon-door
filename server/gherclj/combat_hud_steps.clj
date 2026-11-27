(ns gherclj.combat-hud-steps
  "Step routing for the combat HUD: tiers for foes, hit points for heroes, and the conditions on both."
  (:require [gherclj.core :refer [defgiven defwhen defthen helper!]]
            [gherclj.frameworks.typescript.node-test :as typescript]))

(helper! "features/combat_hud_steps")

(typescript/describe-setup! "let subject: combat_hud_steps.CombatHudSteps")
(typescript/describe-setup! "beforeEach(() => {\n  subject = new combat_hud_steps.CombatHudSteps()\n})")

(defgiven "the hero {hero:string} is poisoned for {minutes:int} minutes" subject.hero-poisoned)
(defgiven "Bryn and Cleo fight a {name:string} with {hp:int} hit points" subject.fight-a)
(defgiven "the foe {name:string} cannot resist and cannot strike back" subject.foe-helpless)
(defgiven "the party is in a fight with an {name:string} at the table" subject.at-the-table)
(defgiven "the turn order is {order:string}" subject.turn-order)
(defgiven "it is the turn of {name:string}" subject.turn-of)
(defgiven "the foe {name:string} is held asleep by Cleo's Sleep" subject.foe-held-asleep)

(defwhen "the foe {name:string} is down to {hp:int} hit points" subject.foe-down-to)
(defwhen "the foe {name:string} is slain" subject.foe-slain)
(defwhen "the hero {hero:string} is down to {hp:int} hit points" subject.hero-down-to)
(defwhen "the hero {hero:string} casts {spell:string} on the foe {foe:string}" subject.casts)
(defwhen "a round passes" subject.round-passes)
(defwhen "the hero {hero:string} strikes with a natural 20" subject.strikes)
(defwhen "the hero {hero:string} loses concentration" subject.loses-concentration)
(defwhen "the foe is down to {share:string} of its hit points" subject.foe-down-to-share)
(defwhen "the fight is won" subject.fight-won)

(defthen "the HUD shows the foe {name:string} as {label:string}" subject.foe-shown-as)
(defthen "the HUD shows no foe's hit points" subject.no-foe-hit-points)
(defthen "the HUD shows the hero {hero:string} at {hp:int} hit points of their maximum" subject.hero-shown-at)
(defthen "the HUD shows the foe {name:string} {label:string} by {source:string}" subject.foe-shown-with)
(defthen "the HUD shows the hero {hero:string} {label:string} on {source:string}" subject.hero-shown-with)
(defthen "the HUD shows the hero {hero:string} {label:string}, ending in {ends:string}" subject.hero-shown-ending)
(defthen "the HUD shows the foe {name:string} free of conditions" subject.foe-free)
(defthen "the round tells {line:string}" subject.round-tells)
(defthen "the round says the {name:string} is still held by {spell:string}: {condition:string}" subject.round-tells-held)
(defthen "no game state sent to a player holds a foe's hit points" subject.sent-no-foe-hit-points)
(defthen "every player's HUD shows the {name:string} as {label:string}" subject.every-player-sees)
(defthen "the HUD's turn order is {order:string}" subject.hud-turn-order)
(defthen "the HUD shows {now:string} acting now and {next:string} next" subject.now-and-next)
(defthen "the HUD shows no one acting" subject.no-one-acting)
