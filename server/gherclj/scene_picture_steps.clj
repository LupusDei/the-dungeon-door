(ns gherclj.scene-picture-steps
  "Step routing for who is painted into a scene's picture. Each phrase maps to a method on the TypeScript subject."
  (:require [gherclj.core :refer [defgiven defwhen defthen helper!]]
            [gherclj.frameworks.typescript.node-test :as typescript]))

(helper! "features/scene_picture_steps")

(typescript/describe-setup! "let painter: scene_picture_steps.ScenePictureSteps")
(typescript/describe-setup! "beforeEach(() => {\n  painter = new scene_picture_steps.ScenePictureSteps()\n})")

(defgiven "the party to paint is {party:string}" painter.party-to-paint)
(defgiven "the dungeon master features {names:string}" painter.dungeon-master-features)
(defgiven "{hero} died on the way" painter.died-on-the-way)

(defwhen "the scene is painted" painter.scene-is-painted)

(defthen "the painter is told to paint {count:int} heroes" painter.painter-is-told-to-paint)
(defthen "everyone in the picture is {party:string}" painter.everyone-in-the-picture-is)
(defthen "{hero} stands nearest the viewer" painter.stands-nearest-the-viewer)
(defthen "{hero} is not in the picture" painter.is-not-in-the-picture)
