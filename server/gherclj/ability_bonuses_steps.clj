(ns gherclj.ability-bonuses-steps
  "Step routing for background ability bonuses. Each phrase maps to a method on the TypeScript subject."
  (:require [gherclj.core :refer [defgiven defwhen defthen helper!]]
            [gherclj.frameworks.typescript.node-test :as typescript]))

(helper! "features/ability_bonuses_steps")

(typescript/describe-setup! "let subject: ability_bonuses_steps.AbilityBonusesSteps")
(typescript/describe-setup! "beforeEach(() => {\n  subject = new ability_bonuses_steps.AbilityBonusesSteps()\n})")

(defgiven "Bryn is a human fighter whose soldier background raises \"{a:string}\", \"{b:string}\" and \"{c:string}\"" subject.background-raises)
(defgiven "Bryn was forged without choosing the bonuses" subject.forged-without-choosing)
(defgiven "Bryn was forged with +2 to \"{plus-two:string}\" and +1 to \"{plus-one:string}\"" subject.was-forged-with-two-one)
(defgiven "Bryn's \"{ability:string}\" has since risen by {by:int}" subject.score-has-risen)
(defgiven "Bryn sits at a table with {other:string}" subject.sits-with)
(defgiven "the adventure is under way" subject.adventure-has-begun)

(defwhen "Bryn is forged with +2 to \"{plus-two:string}\" and +1 to \"{plus-one:string}\"" subject.forged-with-two-one)
(defwhen "Bryn is forged with +1 to each of the background's abilities" subject.forged-with-one-one-one)
(defwhen "Bryn is forged with +3 to \"{ability:string}\"" subject.forged-with-three)
(defwhen "Bryn's sheet is previewed with +2 to \"{plus-two:string}\" and +1 to \"{plus-one:string}\"" subject.previewed-with-two-one)
(defwhen "Bryn places +2 to \"{plus-two:string}\" and +1 to \"{plus-one:string}\"" subject.places-two-one)
(defwhen "Bryn places +1 to each of the background's abilities" subject.places-one-one-one)
(defwhen "the adventure ends" subject.adventure-ends)

(defthen "the request is accepted" subject.accepted)
(defthen "the request is refused as invalid" subject.refused-as-invalid)
(defthen "the request is refused as invalid with \"{message:string}\"" subject.refused-as-invalid-with)
(defthen "the request is refused as a conflict with \"{message:string}\"" subject.refused-as-conflict-with)
(defthen "Bryn was not saved" subject.not-saved)
(defthen "Bryn's sheet records +2 to \"{plus-two:string}\" and +1 to \"{plus-one:string}\"" subject.records-two-one)
(defthen "Bryn's sheet records +1 to each of the background's abilities" subject.records-one-one-one)
(defthen "Bryn's \"{ability:string}\" is {by:int} above the forge's own placement" subject.above-forge)
(defthen "Bryn's \"{ability:string}\" is {by:int} below the forge's own placement" subject.below-forge)
(defthen "Bryn's \"{ability:string}\" matches the forge's own placement" subject.matches-forge)
(defthen "at the table Bryn's \"{ability:string}\" still matches the forge's own placement" subject.at-table-matches-forge)
(defthen "Bryn's bonuses are open" subject.bonuses-open)
(defthen "Bryn's bonuses are not open" subject.bonuses-not-open)
(defthen "the preview matches Bryn's saved sheet" subject.preview-matches-saved)
