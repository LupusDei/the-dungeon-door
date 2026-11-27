(ns gherclj.app-version-steps
  "Step routing for the app-version gate. Each phrase maps to a method on the TypeScript subject."
  (:require [gherclj.core :refer [defgiven defwhen defthen helper!]]
            [gherclj.frameworks.typescript.node-test :as typescript]))

(helper! "features/app_version_steps")

(typescript/describe-setup! "let subject: app_version_steps.AppVersionSteps")
(typescript/describe-setup! "beforeEach(() => {\n  subject = new app_version_steps.AppVersionSteps()\n})")

(defgiven "the door's party is {party:string}" subject.the-doors-party)
(defgiven "{hero} sends no app version" subject.sends-no-app-version)
(defgiven "{hero} is on an old build" subject.on-an-old-build)
(defgiven "{hero} is on the current build" subject.on-the-current-build)

(defwhen "{hero} opens the door on a tale" subject.opens-the-door-on-a-tale)
(defwhen "{hero} opens the door on a dungeon" subject.opens-the-door-on-a-dungeon)

(defthen "the adventure has not begun" subject.adventure-has-not-begun)
(defthen "the adventure has begun" subject.adventure-has-begun)
(defthen "the refusal names {hero}" subject.refusal-names)
(defthen "the party marks {hero} outdated" subject.party-marks-outdated)
(defthen "the party does not mark {hero} outdated" subject.party-does-not-mark-outdated)
(defthen "{hero} is told to update the app" subject.is-told-to-update)
