(ns gherclj.party-chat-steps
  "Step routing for party chat. Each phrase maps to a method on the TypeScript subject."
  (:require [gherclj.core :refer [defgiven defwhen defthen helper!]]
            [gherclj.frameworks.typescript.node-test :as typescript]))

(helper! "features/party_chat_steps")

(typescript/describe-setup! "let subject: party_chat_steps.PartyChatSteps")
(typescript/describe-setup! "beforeEach(() => {\n  subject = new party_chat_steps.PartyChatSteps()\n})")

(defgiven "the table is {party:string}" subject.the-table)
(defgiven "{hero} said in character \"{text:string}\"" subject.said-in-character)

(defwhen "{hero} says in character \"{text:string}\"" subject.says-in-character)
(defwhen "{hero} says out of character \"{text:string}\"" subject.says-out-of-character)
(defwhen "{hero} replies in character \"{text:string}\" to that line" subject.replies-in-character)
(defwhen "{hero} reacts to that line with \"{emoji:string}\"" subject.reacts)
(defwhen "{hero} is typing" subject.is-typing)

(defthen "the reply quotes \"{text:string}\"" subject.reply-quotes)
(defthen "the reply is in character as the hero \"{hero}\"" subject.reply-is-in-character)
(defthen "the reply keeps its own id, distinct from the line it quotes" subject.reply-has-its-own-id)
(defthen "the line is out of character from the player of \"{hero}\"" subject.line-is-out-of-character)
(defthen "the line mentions the hero \"{hero}\"" subject.mentions-hero)
(defthen "the line mentions the player of \"{hero}\"" subject.mentions-player)
(defthen "that line still has its original id" subject.line-id-unchanged)
(defthen "that line has no \"{emoji:string}\" reaction" subject.no-reaction)
(defthen "that line has {count:int} \"{emoji:string}\" reactions including \"{a}\" and \"{b}\"" subject.reaction-count)
(defthen "the next look at the table shows \"{hero}\" typing" subject.shows-typing)
