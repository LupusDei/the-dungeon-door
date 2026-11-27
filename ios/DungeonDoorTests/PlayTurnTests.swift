import XCTest

/// Which d20 the table shows while it is still choosing (Views/Game/PlayTurn.swift). A die that
/// decides nothing is not shown: it was the cause of "which roll counted?".
final class PlayTurnTests: XCTestCase {
    private func scene(combat: Bool, votes: String) throws -> GameScene {
        let json = """
        { "index": 2, "title": "The Ford", "narration": "", "combat": \(combat), "canAct": true, "isFinale": false,
          "choices": [{ "id": "a", "label": "Calm the wolf", "detail": "", "rules": "Parley" },
                      { "id": "b", "label": "Slip past", "detail": "", "rules": "Stealth check, DC 10" }],
          "votes": \(votes), "myVote": null, "outcome": null }
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

    func testTheStoryListIsTheScenesChoices() throws {
        let scene = try scene(combat: false, votes: "[]")
        let offers = TableOffer.list(in: scene)
        XCTAssertEqual(offers.map(\.label), ["Calm the wolf", "Slip past"])
        XCTAssertEqual(offers.map(\.note), ["Parley", "Stealth check, DC 10"])
        XCTAssertEqual(offers.map(\.id), ["choice:a", "choice:b"])
    }
}
