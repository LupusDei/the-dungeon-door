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
}
