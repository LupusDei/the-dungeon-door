import XCTest

/// Which d20 the table shows while it is still choosing (Views/Game/PlayTurn.swift). A die that
/// decides nothing is not shown: it was the cause of "which roll counted?".
final class PlayTurnTests: XCTestCase {
    private func scene(combat: Bool, votes: String, mine: String = "") throws -> GameScene {
        let json = """
        { "index": 2, "title": "The Ford", "narration": "", "combat": \(combat), "canAct": true, "isFinale": false,
          "choices": [{ "id": "a", "label": "Calm the wolf", "detail": "", "rules": "Parley" },
                      { "id": "b", "label": "Slip past", "detail": "", "rules": "Stealth check, DC 10" }],
          "votes": \(votes), "myVote": null, "outcome": null\(mine) }
        """
        return try JSONDecoder().decode(GameScene.self, from: Data(json.utf8))
    }

    func testAPickOfAPlotChoiceShowsNoDie() throws {
        let scene = try scene(combat: false, votes: #"[{ "playerId": "p1", "choiceId": "a", "roll": 17 }]"#)
        XCTAssertNil(PlayTurn.roll(scene: scene, playerId: "p1"))
        let entry = PlayTurn.entry(of: "p1", in: scene, me: "p2")
        XCTAssertEqual(entry?.detail, "Calm the wolf")
        XCTAssertNil(entry?.roll, "its d20 lands on the result screen, with what it was for")
    }

    func testAnActionOfTheHerosOwnShowsTheDieTheyThrew() throws {
        let scene = try scene(combat: false, votes: #"[{ "playerId": "p1", "choiceId": "a", "roll": 12, "actionId": "skill:stealth", "label": "Stealth" }]"#)
        XCTAssertEqual(PlayTurn.roll(scene: scene, playerId: "p1"), 12)
    }

    func testInAFightEveryVoteIsTheHerosOwnActionAndShowsItsDie() throws {
        let scene = try scene(combat: true, votes: #"[{ "playerId": "p1", "choiceId": "a", "roll": 15, "label": "Attack with Shortbow" }]"#)
        XCTAssertEqual(PlayTurn.roll(scene: scene, playerId: "p1"), 15)
    }

    func testWordsTheServerCountedAsAPickAreKnownByTheirChoice() throws {
        // As the caller: the server answers with the pick and the words beside it.
        let mine = try scene(combat: false, votes: #"[{ "playerId": "p1", "choiceId": "b", "roll": 9, "intent": "I creep past the wolf" }]"#,
                             mine: #", "myAction": { "id": "choice:b", "targets": [], "intent": "I creep past the wolf" }"#)
        let counted = PlayTurn.wordsCounted(in: mine, playerId: "p1")
        XCTAssertEqual(counted?.offer, "choice:b")
        XCTAssertEqual(counted?.words, "I creep past the wolf")
        XCTAssertEqual(TableOffer.list(in: mine).map { $0.isChosen(in: mine, playerId: "p1") }, [false, true])
        // From the vote alone, on a server that sends no myAction.
        let polled = try scene(combat: false, votes: #"[{ "playerId": "p1", "choiceId": "a", "roll": 9, "intent": "I hum to the wolf" }]"#)
        XCTAssertEqual(PlayTurn.wordsCounted(in: polled, playerId: "p1")?.offer, "choice:a")
        XCTAssertNil(PlayTurn.wordsCounted(in: polled, playerId: "p2"), "someone else's words are not the caller's")
    }

    func testATapOnACardAndAnActionOfTheHerosOwnAreNotWordsCountedAsAPick() throws {
        let tapped = try scene(combat: false, votes: #"[{ "playerId": "p1", "choiceId": "a", "roll": 9 }]"#,
                               mine: #", "myAction": { "id": "choice:a", "targets": [] }"#)
        XCTAssertNil(PlayTurn.wordsCounted(in: tapped, playerId: "p1"), "no words went with the tap")
        let skill = try scene(combat: false, votes: #"[{ "playerId": "p1", "choiceId": "c", "roll": 9, "actionId": "skill:stealth", "intent": "I slip by" }]"#,
                              mine: #", "myAction": { "id": "skill:stealth", "targets": [], "intent": "I slip by" }"#)
        XCTAssertNil(PlayTurn.wordsCounted(in: skill, playerId: "p1"), "a skill from the sheet is the hero's own action")
    }

    func testTheStoryListIsTheScenesChoices() throws {
        let scene = try scene(combat: false, votes: "[]")
        let offers = TableOffer.list(in: scene)
        XCTAssertEqual(offers.map(\.label), ["Calm the wolf", "Slip past"])
        XCTAssertEqual(offers.map(\.note), ["Parley", "Stealth check, DC 10"])
        XCTAssertEqual(offers.map(\.id), ["choice:a", "choice:b"])
    }

    // MARK: - What the hero declared, as one action

    /// A round of a fight as a sorcerer reads it: three cards headed by what they stand for, and
    /// the hero's own actions (the wheels).
    private func round(votes: String = "[]", mine: String = "", headings: Bool = true, secondIsABlow: Bool = false) throws -> GameScene {
        func heading(_ words: String) -> String { headings ? #", "heading": "\#(words)""# : "" }
        let second = secondIsABlow
            ? #"{ "id": "b", "label": "Move closer", "detail": "Goblin Minion is too far to strike. Move to near.", "rules": null\#(heading("Attack")) }"#
            : #"{ "id": "b", "label": "Cast Magic Missile", "detail": "3 darts of 1d4+1 force that never miss, at Goblin Minion. Uses a level 1 slot (2 left).", "rules": null\#(heading("Cast a spell")) }"#
        let foe = #"[{ "id": "foe-1", "name": "Goblin Minion" }]"#
        let json = """
        { "index": 3, "title": "The Troll Limb Captive", "narration": "", "combat": true, "canAct": true, "isFinale": false,
          "choices": [{ "id": "a", "label": "Move closer", "detail": "Goblin Minion is too far to strike. Move to near.", "rules": null\(heading("Attack")) },
                      \(second),
                      { "id": "c", "label": "Dodge", "detail": "Keep your guard up.", "rules": null\(heading("Dodge")) }],
          "actions": [{ "id": "attack:dagger", "label": "Attack with Dagger", "kind": "attack", "detail": "+3 to hit, 1d4+1 piercing.", "targets": \(foe), "picks": "one", "available": true },
                      { "id": "spell:ray-of-frost", "label": "Cast Ray of Frost", "kind": "spell", "detail": "+5 to hit, 1d8 cold.", "targets": \(foe), "picks": "one", "available": true },
                      { "id": "spell:magic-missile", "label": "Cast Magic Missile", "kind": "spell", "detail": "3 darts of 1d4+1 force that never miss. Uses a level 1 slot (2 left).", "targets": \(foe), "picks": "many", "limit": 3, "available": true },
                      { "id": "spell:cure-wounds", "label": "Cast Cure Wounds", "kind": "spell", "detail": "Heals 2d8+3 hit points. Uses a level 1 slot (2 left).", "targets": [{ "id": "p2", "name": "Slagariel" }], "picks": "one", "available": true },
                      { "id": "common:dodge", "label": "Dodge", "kind": "common", "detail": "Attacks against you have disadvantage.", "targets": [], "picks": "none", "available": true },
                      { "id": "common:dash", "label": "Dash", "kind": "common", "detail": "Double your speed this turn.", "targets": [], "picks": "none", "available": true }],
          "votes": \(votes), "myVote": null, "outcome": null\(mine) }
        """
        return try JSONDecoder().decode(GameScene.self, from: Data(json.utf8))
    }

    private func picked(_ scene: GameScene) -> [Bool] {
        TableOffer.list(in: scene).map { $0.isChosen(in: scene, playerId: "p1") }
    }

    func testASpellFromTheWheelIsOnTheSpellCardAsItselfAndNotAsThePlainPick() throws {
        // What the owner saw: Ray of Frost from the wheel, stored with the spell choice's letter.
        let scene = try round(votes: #"[{ "playerId": "p1", "choiceId": "b", "roll": 7, "actionId": "spell:ray-of-frost", "targets": ["foe-1"], "label": "Cast Ray of Frost" }]"#,
                              mine: #", "myVote": "b", "myAction": { "id": "spell:ray-of-frost", "targets": ["foe-1"] }"#)
        let declared = try XCTUnwrap(PlayTurn.declared(in: scene, playerId: "p1"))
        XCTAssertEqual(declared, Declared(title: "Cast Ray of Frost", context: "At Goblin Minion. +5 to hit, 1d8 cold.", words: nil, card: "choice:b", named: true))
        XCTAssertEqual(declared.under, "At Goblin Minion. +5 to hit, 1d8 cold.")
        XCTAssertEqual(PlayTurn.chosenLine(scene: scene, playerId: "p1"), "Cast Ray of Frost")
        XCTAssertEqual(picked(scene), [false, true, false], "the spell card holds it")
        let card = TableOffer.list(in: scene)[1]
        XCTAssertEqual(card.heading, "Cast a spell")
        let line = card.line(for: declared)
        XCTAssertEqual(line.name, "Ray of Frost", "the card says the spell that was picked")
        XCTAssertEqual(line.detail, "At Goblin Minion. +5 to hit, 1d8 cold.")
        XCTAssertFalse("\(line.name ?? "") \(line.detail)".contains("Magic Missile"), "and not the spell a plain tap would cast")
        // The other cards still say what a plain tap of them does.
        let attack = TableOffer.list(in: scene)[0].line(for: declared)
        XCTAssertEqual(attack.name, "Move closer")
        XCTAssertEqual(attack.detail, "Goblin Minion is too far to strike. Move to near.")
    }

    func testATapOnTheSpellCardIsWhatAPlainPickCasts() throws {
        let before = try round()
        XCTAssertNil(PlayTurn.declared(in: before, playerId: "p1"))
        let offered = TableOffer.list(in: before)[1].line(for: nil)
        XCTAssertEqual(offered.name, "Magic Missile")
        XCTAssertEqual(offered.detail, "3 darts of 1d4+1 force that never miss, at Goblin Minion. Uses a level 1 slot (2 left).")
        let scene = try round(votes: #"[{ "playerId": "p1", "choiceId": "b", "roll": 7, "label": "Cast Magic Missile" }]"#,
                              mine: #", "myVote": "b", "myAction": { "id": "choice:b", "targets": [] }"#)
        let declared = try XCTUnwrap(PlayTurn.declared(in: scene, playerId: "p1"))
        XCTAssertEqual(declared.title, "Cast Magic Missile")
        XCTAssertEqual(declared.context, "3 darts of 1d4+1 force that never miss, at Goblin Minion. Uses a level 1 slot (2 left).")
        XCTAssertFalse(declared.named)
        XCTAssertEqual(picked(scene), [false, true, false])
        XCTAssertEqual(TableOffer.list(in: scene)[1].line(for: declared).name, "Magic Missile")
    }

    func testAWeaponFromTheWheelIsOnTheAttackCardAndTheWordsStayWithIt() throws {
        let scene = try round(votes: #"[{ "playerId": "p1", "choiceId": "a", "roll": 12, "actionId": "attack:dagger", "targets": ["foe-1"], "label": "Attack with Dagger", "intent": "I go for its eyes" }]"#)
        let declared = try XCTUnwrap(PlayTurn.declared(in: scene, playerId: "p1"))
        XCTAssertEqual(declared.card, "choice:a")
        XCTAssertEqual(declared.under, "At Goblin Minion. +3 to hit, 1d4+1 piercing. \u{201C}I go for its eyes\u{201D}")
        let line = TableOffer.list(in: scene)[0].line(for: declared)
        XCTAssertEqual(line.name, "Dagger")
        XCTAssertEqual(line.detail, "At Goblin Minion. +3 to hit, 1d4+1 piercing.")
        XCTAssertEqual(picked(scene), [true, false, false])
    }

    func testDodgeFromTheWheelIsTheDodgeCardAndDashIsNoneOfThem() throws {
        let dodge = try round(votes: #"[{ "playerId": "p1", "choiceId": "c", "roll": 3, "actionId": "common:dodge", "label": "Dodge" }]"#)
        XCTAssertEqual(picked(dodge), [false, false, true], "the same deed is the same card")
        let line = TableOffer.list(in: dodge)[2].line(for: PlayTurn.declared(in: dodge, playerId: "p1"))
        XCTAssertNil(line.name, "the heading already says it")
        // Dash is stored with the third letter too, and is not Dodge.
        let dash = try round(votes: #"[{ "playerId": "p1", "choiceId": "c", "roll": 3, "actionId": "common:dash", "label": "Dash" }]"#)
        XCTAssertEqual(picked(dash), [false, false, false], "no card says Dash, so none is marked")
        let declared = try XCTUnwrap(PlayTurn.declared(in: dash, playerId: "p1"))
        XCTAssertEqual(declared, Declared(title: "Dash", context: "Double your speed this turn.", words: nil, card: nil, named: true), "it gets a row of its own")
    }

    func testAHealingSpellIsOnSomeoneAndAHeroWithNoSpellCardGetsARowForIt() throws {
        // A hero whose second choice is the same blow has no spell card: a spell of theirs is on none.
        let scene = try round(votes: #"[{ "playerId": "p1", "choiceId": "b", "roll": 3, "actionId": "spell:cure-wounds", "targets": ["p2"], "label": "Cast Cure Wounds" }]"#, secondIsABlow: true)
        let declared = try XCTUnwrap(PlayTurn.declared(in: scene, playerId: "p1"))
        XCTAssertEqual(declared.context, "On Slagariel. Heals 2d8+3 hit points. Uses a level 1 slot (2 left).")
        XCTAssertNil(declared.card)
        XCTAssertEqual(picked(scene), [false, false, false])
    }

    func testAServerFromBeforeHeadingsMarksNoCardForAnotherSpell() throws {
        let scene = try round(votes: #"[{ "playerId": "p1", "choiceId": "b", "roll": 7, "actionId": "spell:ray-of-frost", "targets": ["foe-1"], "label": "Cast Ray of Frost" }]"#, headings: false)
        XCTAssertEqual(picked(scene), [false, false, false], "the card says Magic Missile and nothing says it stands for any spell")
        XCTAssertNil(TableOffer.list(in: scene)[1].heading)
        // The very spell the card names is that card, headings or not.
        let same = try round(votes: #"[{ "playerId": "p1", "choiceId": "b", "roll": 7, "actionId": "spell:magic-missile", "targets": ["foe-1"], "label": "Cast Magic Missile" }]"#, headings: false)
        XCTAssertEqual(picked(same), [false, true, false])
    }

    func testOutsideAFightASkillOfTheHerosOwnPicksNoneOfThePlotsChoices() throws {
        let skill = try scene(combat: false, votes: #"[{ "playerId": "p1", "choiceId": "b", "roll": 9, "actionId": "skill:stealth", "intent": "I slip by" }]"#,
                              mine: #", "myAction": { "id": "skill:stealth", "targets": [], "intent": "I slip by" }"#)
        XCTAssertEqual(TableOffer.list(in: skill).map { $0.isChosen(in: skill, playerId: "p1") }, [false, false])
        // A plot choice says its own words, with what it risks.
        let pick = try scene(combat: false, votes: #"[{ "playerId": "p1", "choiceId": "b", "roll": 9 }]"#)
        let declared = try XCTUnwrap(PlayTurn.declared(in: pick, playerId: "p1"))
        XCTAssertEqual(declared, Declared(title: "Slip past", context: "Stealth check, DC 10", words: nil, card: "choice:b", named: false))
        let line = TableOffer.list(in: pick)[1].line(for: declared)
        XCTAssertNil(line.name, "a plot choice has no heading: its card reads as it always did")
        XCTAssertEqual(line.detail, "")
    }

    func testACheckInThePlayersOwnWordsIsDeclaredAsThoseWords() throws {
        let written = try scene(combat: false, votes: "[]", mine: #", "myFreeform": { "playerId": "p1", "text": "I kick the brazier over", "roll": null, "pending": true }"#)
        let declared = try XCTUnwrap(PlayTurn.declared(in: written, playerId: "p1"))
        XCTAssertEqual(declared.title, "I kick the brazier over")
        XCTAssertNil(declared.card)
        XCTAssertFalse(declared.named)
    }
}
