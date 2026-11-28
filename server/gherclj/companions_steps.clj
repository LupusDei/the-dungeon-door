(ns gherclj.companions-steps
  "Step routing for companions: the people a player has shared a game with, their names, and the heroes they can bring."
  (:require [gherclj.core :refer [defgiven defwhen defthen helper!]]
            [gherclj.frameworks.typescript.node-test :as typescript]))

(helper! "features/companions_steps")

(typescript/describe-setup! "let subject: companions_steps.CompanionsSteps")
(typescript/describe-setup! "beforeEach(() => {\n  subject = new companions_steps.CompanionsSteps()\n})")

(defgiven "I adventured beside a player whose hero was {hero}" subject.adventured-beside)
(defgiven "that companion also has the heroes {names:string}" subject.also-has-the-heroes)
(defgiven "the companion's hero {hero} has fallen" subject.hero-has-fallen)
(defgiven "the companion's hero {hero} is retired" subject.hero-is-retired)
(defgiven "that companion goes by \"{name:string}\"" subject.companion-goes-by)
(defgiven "I go by \"{name:string}\"" subject.i-go-by)

(defwhen "I call that companion \"{name:string}\"" subject.i-call-that-companion)
(defwhen "I call that companion \"\"" subject.i-forget-my-name-for-them)
(defwhen "I open a new door and invite that companion" subject.invite-the-person)
(defwhen "I open a new door and invite that companion, asking for {hero}" subject.invite-asking-for)
(defwhen "I ask for {hero} instead" subject.ask-for-instead)
(defwhen "I try to go by a name of {letters:int} letters" subject.try-a-name-of)

(defthen "my companions are called \"{names:string}\"" subject.companions-are-called)
(defthen "that companion was named by {who}" subject.was-named-by)
(defthen "my nickname for that companion is \"{name:string}\"" subject.nickname-is)
(defthen "I have no nickname for that companion" subject.no-nickname)
(defthen "that companion can bring {names:string}" subject.can-bring)
(defthen "they are invited" subject.they-are-invited)
(defthen "they were already invited" subject.they-were-already-invited)
(defthen "they have no invitation" subject.they-have-no-invitation)
(defthen "their invitation asks for {hero}" subject.invitation-asks-for)
(defthen "their invitation asks for no hero" subject.invitation-asks-for-no-hero)
(defthen "their invitation is from the person \"{name:string}\"" subject.invitation-is-from)
(defthen "their invitation names no person" subject.invitation-names-no-person)
(defthen "the invitation is refused with \"{text:string}\"" subject.invitation-refused-with)
(defthen "the name is refused as too long" subject.name-refused-as-too-long)
