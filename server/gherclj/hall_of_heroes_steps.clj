(ns gherclj.hall-of-heroes-steps
  "Step routing for the Hall of Heroes. Each phrase maps to a method on the TypeScript subject."
  (:require [gherclj.core :refer [defgiven defwhen defthen helper!]]
            [gherclj.frameworks.typescript.node-test :as typescript]))

(helper! "features/hall_of_heroes_steps")

(typescript/describe-setup! "let subject: hall_of_heroes_steps.HallOfHeroesSteps")
(typescript/describe-setup! "beforeEach(() => {\n  subject = new hall_of_heroes_steps.HallOfHeroesSteps()\n})")

(defgiven "I have the heroes {names:string}" subject.i-have-the-heroes)
(defgiven "{hero} has retired" subject.has-retired)
(defgiven "{hero} has died" subject.has-died)
(defgiven "{hero} fell in \"{place:string}\"" subject.fell-in)
(defgiven "{hero} has {gp:int} gold" subject.has-gold)
(defgiven "a stranger has opened a door with {hero}" subject.stranger-opened-a-door)
(defgiven "a stranger has the retired hero {hero}" subject.stranger-has-retired-hero)

(defwhen "I ask for my \"{status:string}\" heroes" subject.ask-for-heroes)
(defwhen "I retire {hero}" subject.retire)
(defwhen "I retire {hero} again" subject.retire)
(defwhen "I un-retire {hero}" subject.unretire)
(defwhen "I delete {hero}" subject.delete-hero)
(defwhen "{hero} tries to open a door" subject.tries-to-open-a-door)
(defwhen "{hero} tries to join {host}'s party" subject.tries-to-join)
(defwhen "{hero} is slain by a tyrannosaurus on an adventure" subject.slain-on-an-adventure)
(defwhen "the temple raises {hero}" subject.temple-raises)

(defthen "my {status} heroes are {names:string}" subject.my-heroes-are)
(defthen "all my heroes are {names:string}" subject.all-my-heroes-are)
(defthen "listing my heroes with no status gives {names:string}" subject.default-heroes-are)
(defthen "it is refused with \"{text:string}\"" subject.refused-with)
(defthen "it is refused as a bad request naming active, retired, dead and all" subject.refused-as-bad-request)
(defthen "it is not found" subject.not-found)
(defthen "{hero} is marked retired" subject.is-retired)
(defthen "{hero} is not retired" subject.is-not-retired)
(defthen "{hero} keeps the date of the first retirement" subject.keeps-first-retirement)
(defthen "the stranger's {hero} is still retired" subject.strangers-hero-still-retired)
(defthen "{hero} is marked dead" subject.is-dead)
(defthen "{hero}'s death names the adventure and a scene of it" subject.death-names-adventure-and-scene)
(defthen "{hero}'s death says \"{text:string}\"" subject.death-says)
(defthen "{hero} has no death" subject.has-no-death)
