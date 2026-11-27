import XCTest

/// The turn result as the server sends it (docs/api.md, TurnResult), and what the result screen
/// says of it. The first case is a turn from a real game: one hero picked the parley while the
/// other two attacked in their own words.
final class TurnResultTests: XCTestCase {
    private let parley = """
    {
      "sceneIndex": 3, "combat": false,
      "choice": { "id": "b", "label": "Parley with the hive", "rules": "Parley with Giant Wasp, Swarm of Bats",
                  "backers": ["far"], "tally": { "a": 0, "b": 1, "c": 0 }, "tie": null, "success": true },
      "heroes": [
        { "playerId": "ras", "name": "Rastigar", "did": "own", "text": "Attack the wasp with burning hands", "label": "Dexterity",
          "byClock": true, "lines": [],
          "rolls": [{ "for": "own", "name": "Dexterity", "natural": 13, "dice": [13], "mode": "normal", "bonus": 1, "total": 14,
                      "against": { "kind": "dc", "value": 15 }, "success": false, "fresh": false, "helpers": [], "detail": null }] },
        { "playerId": "sla", "name": "Slagette", "did": "own", "text": "Attack the bat", "label": "Dexterity", "byClock": false, "lines": [],
          "rolls": [{ "for": "own", "name": "Dexterity", "natural": 20, "dice": [20], "mode": "normal", "bonus": 2, "total": 22,
                      "against": { "kind": "dc", "value": 15 }, "success": true, "fresh": false, "helpers": [],
                      "detail": "Improvised damage 2 slashing" }] },
        { "playerId": "far", "name": "Fardock", "did": "choice", "choiceId": "b", "label": "Parley with the hive", "byClock": false, "lines": [],
          "rolls": [{ "for": "choice", "name": "Persuasion", "natural": 17, "dice": [17, 4], "mode": "advantage", "bonus": -1, "total": 16,
                      "against": { "kind": "dc", "value": 15 }, "success": true, "fresh": false, "helpers": ["Slagette"], "detail": null }] }
      ],
      "notes": ["The Giant Wasp, Swarm of Bats let the party be."]
    }
    """

    private func decode(_ json: String) throws -> TurnResult {
        try JSONDecoder().decode(TurnResult.self, from: Data(json.utf8))
    }

    func testATurnDecodesWithEveryHeroAndEveryDie() throws {
        let turn = try decode(parley)
        XCTAssertEqual(turn.sceneIndex, 3)
        XCTAssertEqual(turn.heroes.map(\.name), ["Rastigar", "Slagette", "Fardock"])
        XCTAssertEqual(turn.rollCount, 3)
        XCTAssertEqual(turn.choice?.label, "Parley with the hive")
        XCTAssertEqual(turn.choice?.success, true)
        XCTAssertEqual(turn.heroes[0].deed, .own)
        XCTAssertTrue(turn.heroes[0].byClock)
        XCTAssertEqual(turn.heroes[2].rolls[0].purpose, "choice")
        XCTAssertEqual(turn.notes, ["The Giant Wasp, Swarm of Bats let the party be."])
    }

    func testWhoeverRolledForThePartysChoiceComesFirst() throws {
        let turn = try decode(parley)
        XCTAssertEqual(turn.inOrder.map(\.name), ["Fardock", "Rastigar", "Slagette"])
        XCTAssertEqual(turn.rollsBefore(turn.heroes[2]), 0)
        XCTAssertEqual(turn.rollsBefore(turn.heroes[0]), 1)
        XCTAssertEqual(turn.rollsBefore(turn.heroes[1]), 2)
    }

    func testTheScreenSaysWhoPickedAndWhoWentTheirOwnWay() throws {
        let turn = try decode(parley)
        XCTAssertEqual(turn.headline, "The party chose")
        XCTAssertEqual(turn.pickLine(), "Picked by Fardock. Rastigar and Slagette acted on their own.")
        XCTAssertEqual(turn.verdict, "Succeeded")
        XCTAssertEqual(turn.heroes[0].deedLine, "“Attack the wasp with burning hands”")
        XCTAssertEqual(turn.heroes[2].deedLine, "Picked: Parley with the hive")
    }

    func testARollSaysItsSumItsTargetAndItsVerdict() throws {
        let turn = try decode(parley)
        let own = turn.heroes[1].rolls[0]
        XCTAssertEqual(own.sum, "20 + 2 = 22")
        XCTAssertEqual(own.target, "DC 15")
        XCTAssertEqual(own.verdict, "Succeeded")
        XCTAssertNil(own.twoDice)
        let helped = turn.heroes[2].rolls[0]
        XCTAssertEqual(helped.sum, "17 − 1 = 16")
        XCTAssertEqual(helped.twoDice, "Advantage: 17, not 4")
        XCTAssertEqual(helped.helpers, ["Slagette"])
        XCTAssertEqual(turn.heroes[0].rolls[0].verdict, "Failed")
    }

    func testATieSaysWhoseDieDecided() throws {
        var turn = try decode(parley)
        turn.choice?.tie = TurnChoice.Tie(between: ["a", "b"], playerId: "far", roll: 17)
        XCTAssertEqual(turn.pickLine(), "The picks were level, so the highest d20 decided: Fardock's 17.")
    }

    func testEveryonePickingTheSameChoiceIsSaidPlainly() throws {
        let turn = try decode("""
        { "sceneIndex": 1,
          "choice": { "id": "a", "label": "Follow the open passage", "backers": ["x", "y", "z"], "tally": { "a": 3 } },
          "heroes": [
            { "playerId": "x", "name": "Xan", "did": "choice", "choiceId": "a", "label": "Follow the open passage" },
            { "playerId": "y", "name": "Yul", "did": "choice", "choiceId": "a", "label": "Follow the open passage" },
            { "playerId": "z", "name": "Zed", "did": "choice", "choiceId": "a", "label": "Follow the open passage" }
          ] }
        """)
        XCTAssertEqual(turn.pickLine(), "Everyone picked it.")
        XCTAssertNil(turn.verdict, "nothing to roll, so nothing to pass or fail")
        XCTAssertEqual(turn.rollCount, 0)
    }

    func testAHeroWhoPickedAnotherChoiceIsNamedToo() throws {
        let turn = try decode("""
        { "sceneIndex": 1,
          "choice": { "id": "b", "label": "Question the peddler", "backers": ["x", "y"], "tally": { "a": 1, "b": 2 } },
          "heroes": [
            { "playerId": "x", "name": "Xan", "did": "choice", "choiceId": "b" },
            { "playerId": "y", "name": "Yul", "did": "choice", "choiceId": "b" },
            { "playerId": "z", "name": "Zed", "did": "choice", "choiceId": "a" }
          ] }
        """)
        XCTAssertEqual(turn.pickLine(), "Picked by Xan and Yul. Zed picked another.")
        XCTAssertEqual(TurnResult.listed(["Bryn", "Mira", "Dax"]), "Bryn, Mira and Dax")
    }

    func testATurnWithNoPickSaysSo() throws {
        let turn = try decode("""
        { "sceneIndex": 5, "choice": null,
          "heroes": [{ "playerId": "x", "name": "Xan", "did": "own", "text": "Help Fardock" },
                     { "playerId": "y", "name": "Yul", "did": "nothing" },
                     { "playerId": "z", "name": "Zed", "did": "down" }] }
        """)
        XCTAssertEqual(turn.headline, "Each hero went their own way")
        XCTAssertEqual(turn.pickLine(), "Nobody picked one of the choices, so the scene did not turn on one.")
        XCTAssertEqual(turn.heroes.map(\.deedLine), ["“Help Fardock”", "Did not act", "Down: could not act"])
    }

    func testARoundOfAFightShowsAttacksAsHitsAndMisses() throws {
        let turn = try decode("""
        { "sceneIndex": 8, "combat": true, "choice": null,
          "heroes": [{ "playerId": "s", "name": "Slagette", "did": "action", "label": "Attack with Shortsword",
                       "lines": ["Slagette moves to engage Giant Wasp.", "Slagette attacks Swarm of Bats with Shortsword: 10 (total 14) vs AC 12, hit."],
                       "rolls": [{ "for": "attack", "name": "Shortsword", "natural": 10, "bonus": 4, "total": 14,
                                   "against": { "kind": "ac", "value": 12 }, "success": true }] }],
          "notes": ["Slagette moves to engage Giant Wasp.", "Giant Wasp attacks Rastigar with Sting: 20 (total 24) vs AC 11, critical hit for 19."] }
        """)
        XCTAssertEqual(turn.headline, "The round")
        XCTAssertNil(turn.pickLine())
        let attack = turn.heroes[0].rolls[0]
        XCTAssertEqual(attack.verdict, "Hit")
        XCTAssertEqual(attack.target, "AC 12")
        XCTAssertEqual(turn.heroes[0].plainLines, ["Slagette moves to engage Giant Wasp."], "the attack's own line is told by its die")
        XCTAssertEqual(turn.otherNotes, ["Giant Wasp attacks Rastigar with Sting: 20 (total 24) vs AC 11, critical hit for 19."])
    }

    func testAHeroTheAppCannotReadIsDroppedAndTheRestStillShow() throws {
        let turn = try decode("""
        { "sceneIndex": 2, "heroes": [{ "name": "No id" }, { "playerId": "x", "name": "Xan", "did": "a deed from a later server" }] }
        """)
        XCTAssertEqual(turn.heroes.map(\.name), ["Xan"])
        XCTAssertEqual(turn.heroes[0].deed, .nothing)
    }
}
