(ns gherclj.legal-steps
  "Step routing for a hero's legal actions. Each phrase maps to a method on the TypeScript subject."
  (:require [gherclj.core :refer [defgiven defwhen defthen helper!]]
            [gherclj.frameworks.typescript.node-test :as typescript]))

(helper! "features/legal_steps")

(typescript/describe-setup! "let subject: legal_steps.LegalSteps")
(typescript/describe-setup! "beforeEach(() => {\n  subject = new legal_steps.LegalSteps()\n})")

(defgiven "a fighter in a fight" subject.fighter-in-a-fight)
(defgiven "a wizard with {spell:string} prepared and no slots left" subject.wizard-with-no-slots)
(defgiven "a fighter who carries a greatsword in a fight" subject.fighter-with-greatsword)
(defgiven "the choices {a:string}, {b:string} and {c:string}" subject.with-choices)

(defwhen "the fighter swings the greatsword" subject.vote-greatsword)
(defwhen "the fighter votes to attack {target:string}" subject.vote-attack-at)

(defthen "a weapon attack is offered" subject.weapon-attack-is-offered)
(defthen "{id:string} is available" subject.action-is-available)
(defthen "{id:string} is unavailable because {reason:string}" subject.action-is-unavailable)
(defthen "{id:string} is labeled {label:string}" subject.action-is-labeled)
(defthen "the vote is accepted" subject.vote-is-accepted)
(defthen "the vote is refused" subject.vote-is-refused)
(defthen "the engine strikes with {weapon:string}" subject.engine-strikes-with)
