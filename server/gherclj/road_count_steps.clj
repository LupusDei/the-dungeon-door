(ns gherclj.road-count-steps
  "Step routing for the road counted apart from the tale."
  (:require [gherclj.core :refer [defgiven defwhen defthen helper!]]
            [gherclj.frameworks.typescript.node-test :as typescript]))

(helper! "features/road_count_steps")

(typescript/describe-setup! "let subject: road_count_steps.RoadCountSteps")
(typescript/describe-setup! "beforeEach(() => {\n  subject = new road_count_steps.RoadCountSteps()\n})")

(defgiven "a game of {asked:int} scenes is started" subject.game-started)
(defgiven "a game with no set length is started" subject.open-game-started)

(defwhen "the party walks on" subject.walk-on)
(defwhen "the party fights {rounds:int} rounds on the road" subject.fight-rounds)
(defwhen "the party plays a scene of the tale" subject.play-scene)

(defthen "the game has {scenes:int} scenes" subject.game-has)
(defthen "the scene is stretch {stretch:int} of {of:int} of the road, with {tale:int} scenes of the tale to follow" subject.on-the-road)
(defthen "the scene is stretch {stretch:int} of {of:int} of the road, the tale with no set length" subject.on-the-road-open)
(defthen "the scene is scene {scene:int} of {of:int} of the tale" subject.in-the-tale)
(defthen "the scene is scene {scene:int} of the tale, with no set length" subject.in-an-open-tale)
(defthen "the scene is told to the dungeon master as {label:string}" subject.dm-is-told)
