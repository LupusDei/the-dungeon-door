import XCTest

/// What a hero earned in a turn, and why (docs/api.md, `TurnResult.heroes[].xp`; docs/rules-design.md,
/// "Experience from actions"): how it decodes, and the words the result card and a streamlined
/// page put on it.
final class TurnXpTests: XCTestCase {
    private func turn(_ heroes: String, combat: Bool = false) throws -> TurnResult {
        let json = #"{ "sceneIndex": 4, "combat": \#(combat), "choice": null, "heroes": [\#(heroes)], "notes": [] }"#
        return try JSONDecoder().decode(TurnResult.self, from: Data(json.utf8))
    }

    private func hero(_ id: String, _ name: String, xp: String?) -> String {
        let earned = xp.map { #", "xp": \#($0)"# } ?? ""
        return #"{ "playerId": "\#(id)", "name": "\#(name)", "did": "choice", "byClock": false, "rolls": [], "lines": []\#(earned) }"#
    }

    private let longShot = #"""
    { "total": 45, "idle": false, "chance": 0.1,
      "reasons": [{ "reason": "took-part", "label": "taking part", "xp": 5 }, { "reason": "long-shot", "label": "a long shot that landed", "xp": 40 }] }
    """#
    private let braveFailure = #"""
    { "total": 10, "idle": false, "chance": 0.45,
      "reasons": [{ "reason": "took-part", "label": "taking part", "xp": 5 }, { "reason": "brave-failure", "label": "a brave failure", "xp": 5 }] }
    """#
    private let tookPart = #"{ "total": 5, "idle": false, "chance": null, "reasons": [{ "reason": "took-part", "label": "taking part", "xp": 5 }] }"#

    func testALongShotThatLandedSaysItsAmountEveryReasonAndTheChance() throws {
        let xp = try XCTUnwrap(try turn(hero("p1", "Nillort", xp: longShot)).heroes[0].xp)
        XCTAssertEqual(xp.total, 45)
        XCTAssertEqual(xp.amount, "+45 XP")
        XCTAssertEqual(xp.headline, "a long shot that landed", "the most telling reason leads")
        XCTAssertEqual(xp.odds, "a 10% chance")
        XCTAssertEqual(xp.why, "a long shot that landed (+40, a 10% chance), taking part (+5)")
        XCTAssertEqual(xp.line, "+45 XP · a long shot that landed (+40, a 10% chance), taking part (+5)")
        XCTAssertEqual(xp.spoken, "45 XP: a long shot that landed, 40, a 10% chance; taking part, 5")
        XCTAssertTrue(xp.surprising)
    }

    func testAPlainResultSaysItsChanceTooAndTakingPartAloneIsJustThat() throws {
        let success = #"""
        { "total": 15, "idle": false, "chance": 0.55,
          "reasons": [{ "reason": "took-part", "label": "taking part", "xp": 5 }, { "reason": "success", "label": "a success", "xp": 10 }] }
        """#
        let rolled = try XCTUnwrap(try turn(hero("p1", "Maud", xp: success)).heroes[0].xp)
        XCTAssertEqual(rolled.line, "+15 XP · a success (+10, a 55% chance), taking part (+5)")
        XCTAssertFalse(rolled.surprising, "what was likely is no surprise")
        let alone = try XCTUnwrap(try turn(hero("p1", "Maud", xp: tookPart)).heroes[0].xp)
        XCTAssertEqual(alone.line, "+5 XP · taking part", "one reason needs no amount of its own, and no d20 decided it")
        XCTAssertNil(alone.odds)
    }

    func testEqualAmountsPutWhatTheHeroDidBeforeTakingPart() throws {
        let xp = try XCTUnwrap(try turn(hero("p1", "Maud", xp: braveFailure)).heroes[0].xp)
        XCTAssertEqual(xp.headline, "a brave failure")
        XCTAssertEqual(xp.line, "+10 XP · a brave failure (+5, a 45% chance), taking part (+5)")
    }

    func testWhatThePartySharedIsListedByItsSizeAndTheChanceStaysWithTheRoll() throws {
        let shared = #"""
        { "total": 40, "idle": false, "chance": 0.7,
          "reasons": [{ "reason": "took-part", "label": "taking part", "xp": 5 }, { "reason": "success", "label": "a success", "xp": 10 },
                      { "reason": "trap", "label": "a trap overcome", "xp": 25 }] }
        """#
        let xp = try XCTUnwrap(try turn(hero("p1", "Maud", xp: shared)).heroes[0].xp)
        XCTAssertEqual(xp.line, "+40 XP · a trap overcome (+25), a success (+10, a 70% chance), taking part (+5)")
    }

    func testARoundSaysInTheFightOrTheSurpriseWithItsChance() throws {
        let inFight = #"{ "total": 1, "idle": false, "chance": null, "reasons": [{ "reason": "in-fight", "label": "in the fight", "xp": 1 }] }"#
        let lesson = #"{ "total": 4, "idle": false, "chance": 0.25, "reasons": [{ "reason": "hard-lesson", "label": "a hard lesson", "xp": 4 }] }"#
        let round = try turn([hero("p1", "Nillort", xp: lesson), hero("p2", "Slagariel", xp: inFight)].joined(separator: ","), combat: true)
        XCTAssertEqual(round.heroes.map { $0.xp?.line }, ["+4 XP · a hard lesson (a 25% chance)", "+1 XP · in the fight"])
        XCTAssertEqual(round.heroes.map { $0.xp?.surprising }, [true, false])
    }

    func testASureThingSaysItCouldNotFailAndATinyChanceIsNeverNought() throws {
        let sure = #"""
        { "total": 8, "idle": false, "chance": 1,
          "reasons": [{ "reason": "took-part", "label": "taking part", "xp": 5 }, { "reason": "sure-thing", "label": "a sure thing", "xp": 3 }] }
        """#
        XCTAssertEqual(try turn(hero("p1", "Maud", xp: sure)).heroes[0].xp?.line, "+8 XP · taking part (+5), a sure thing (+3, it could not fail)")
        let sliver = #"{ "total": 8, "idle": false, "chance": 0.0025, "reasons": [{ "reason": "sure-slip", "label": "a sure thing that slipped", "xp": 8 }] }"#
        XCTAssertEqual(try turn(hero("p1", "Maud", xp: sliver)).heroes[0].xp?.line, "+8 XP · a sure thing that slipped (a 1% chance)")
    }

    func testAReasonTheAppHasNotSeenIsShownByItsLabel() throws {
        let later = #"{ "total": 12, "idle": false, "reasons": [{ "reason": "a-reason-from-a-later-server", "label": "a marvel witnessed", "xp": 12 }] }"#
        XCTAssertEqual(try turn(hero("p1", "Maud", xp: later)).heroes[0].xp?.line, "+12 XP · a marvel witnessed")
    }

    func testAServerThatSendsNoExperienceStillShowsTheTurn() throws {
        // An older server (no key), a hero who earned nothing (null or nought), and something unreadable.
        let heroes = [hero("p1", "Maud", xp: nil), hero("p2", "Corin", xp: "null"), hero("p3", "Wren", xp: #"{ "total": 0, "idle": false, "reasons": [] }"#),
                      hero("p4", "Dag", xp: #""a lot""#)]
        let old = try turn(heroes.joined(separator: ","))
        XCTAssertEqual(old.heroes.map(\.name), ["Maud", "Corin", "Wren", "Dag"], "every hero still decodes")
        XCTAssertTrue(old.heroes.allSatisfy { $0.xp == nil })
        XCTAssertNil(old.briefXp, "and a streamlined page says nothing of XP")
    }

    func testTheClocksDieIsSaidByTheAmountsItHalved() throws {
        let idle = #"{ "total": 2, "idle": true, "chance": null, "reasons": [{ "reason": "took-part", "label": "taking part", "xp": 2 }] }"#
        let xp = try XCTUnwrap(try turn(hero("p1", "Maud", xp: idle)).heroes[0].xp)
        XCTAssertTrue(xp.idle)
        XCTAssertEqual(xp.line, "+2 XP · taking part", "the amounts arrive halved; the card's own line says why")
    }

    func testInAFewLinesTheTurnSaysWhatEachHeroEarned() throws {
        let mixed = try turn([hero("p1", "Nillort", xp: longShot), hero("p2", "Slagariel", xp: braveFailure), hero("p3", "Maud", xp: tookPart)].joined(separator: ","))
        XCTAssertEqual(mixed.briefXp, "Nillort +45 XP (a long shot that landed), Slagariel +10 XP (a brave failure), Maud +5 XP")
        let same = try turn([hero("p1", "Nillort", xp: tookPart), hero("p2", "Slagariel", xp: tookPart)].joined(separator: ","))
        XCTAssertEqual(same.briefXp, "+5 XP each for taking part", "everyone the same: said once")
        let one = try turn(hero("p1", "Nillort", xp: tookPart))
        XCTAssertEqual(one.briefXp, "Nillort +5 XP")
        let some = try turn([hero("p1", "Nillort", xp: tookPart), hero("p2", "Slagariel", xp: nil)].joined(separator: ","))
        XCTAssertEqual(some.briefXp, "Nillort +5 XP", "a hero who earned nothing is not listed")
    }
}
