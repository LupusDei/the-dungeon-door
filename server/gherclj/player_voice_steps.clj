(ns gherclj.player-voice-steps
  "Step routing for the narrator leaving the heroes to the players."
  (:require [gherclj.core :refer [defgiven defwhen defthen helper!]]
            [gherclj.frameworks.typescript.node-test :as typescript]))

(helper! "features/player_voice_steps")

(typescript/describe-setup! "let subject: player_voice_steps.PlayerVoiceSteps")
(typescript/describe-setup! "beforeEach(() => {\n  subject = new player_voice_steps.PlayerVoiceSteps()\n})")

(defgiven "the heroes {names:string}" subject.the-heroes)
(defgiven "{name} has said:" subject.hero-said)

(defwhen "the narrator writes:" subject.narrator-writes)

(defthen "the narration does not contain {fragment:string}" subject.narration-omits)
(defthen "the narration contains {fragment:string}" subject.narration-keeps)
(defthen "the narrator is told not to speak for the heroes" subject.prompt-forbids-hero-speech)
(defthen "the narrator is handed those words to answer" subject.handed-to-the-narrator)
