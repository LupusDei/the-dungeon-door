import XCTest

/// Painting and repainting a hero's portrait (docs/api.md, POST /api/portrait; Core/PortraitRemake.swift):
/// what the app asks the painter for, and that the hero keeps their picture until a new one is accepted.
final class PortraitRemakeTests: XCTestCase {
    private func hero(appearance: String? = nil, portraitUrl: String? = nil, description: String = "copper braid") -> Character {
        var hero = Character.blank(ownerId: "p1")
        hero.name = "Vex"
        hero.description = description
        hero.appearance = appearance
        hero.portraitUrl = portraitUrl
        return hero
    }

    private let old = PortraitResult(appearance: "Vex, copper braid, green cloak.", portraitUrl: "https://x.test/old.png")
    private let new = PortraitResult(appearance: "Vex, copper braid, darker cloak.", portraitUrl: "https://x.test/new.png")

    func testAFirstPaintingAsksFreshAndIsKeptAtOnce() {
        var remake = PortraitRemake(hero())
        XCTAssertFalse(remake.hasPainting)
        XCTAssertEqual(remake.paintLabel, "Paint portrait")
        XCTAssertEqual(remake.saveLabel, "Seal without portrait")
        let asked = remake.request(description: "copper braid", note: "  ")
        XCTAssertNil(asked.previousAppearance, "a first paint omits previousAppearance")
        XCTAssertNil(asked.note)

        remake.painted(old)
        XCTAssertFalse(remake.awaitingChoice, "nothing to compare a first painting with")
        XCTAssertEqual(remake.kept.portraitUrl, old.portraitUrl)
        XCTAssertEqual(remake.paintLabel, "Repaint")
        XCTAssertEqual(remake.saveLabel, "Keep & save")
    }

    func testARepaintSendsThePaintingOnFileAndTheNote() {
        let remake = PortraitRemake(hero(appearance: old.appearance, portraitUrl: old.portraitUrl))
        let asked = remake.request(description: "copper braid", note: " darker cloak \n")
        XCTAssertEqual(asked.previousAppearance, old.appearance)
        XCTAssertEqual(asked.note, "darker cloak")
    }

    func testAnEditedLookIsPaintedFreshFromTheNewWords() {
        let remake = PortraitRemake(hero(appearance: old.appearance, portraitUrl: old.portraitUrl))
        let asked = remake.request(description: "copper braid, a raven on the shoulder", note: "older face")
        XCTAssertNil(asked.previousAppearance, "a revision keeps everything but the note, so a new look starts fresh")
        XCTAssertEqual(asked.note, "older face")
    }

    func testANewPaintingWaitsBesideTheOldUntilThePlayerChooses() {
        var remake = PortraitRemake(hero(appearance: old.appearance, portraitUrl: old.portraitUrl))
        remake.painted(new)
        XCTAssertTrue(remake.awaitingChoice)
        XCTAssertEqual(remake.shown.portraitUrl, new.portraitUrl, "the new one is on show")
        XCTAssertEqual(remake.kept.portraitUrl, old.portraitUrl, "but the old one is still what a save keeps")
        XCTAssertEqual(remake.applied(to: hero(appearance: old.appearance, portraitUrl: old.portraitUrl)).portraitUrl, old.portraitUrl)

        remake.keepNew()
        XCTAssertFalse(remake.awaitingChoice)
        XCTAssertEqual(remake.kept, PortraitRemake.Painting(new))
        let saved = remake.applied(to: hero(appearance: old.appearance, portraitUrl: old.portraitUrl))
        XCTAssertEqual(saved.portraitUrl, new.portraitUrl)
        XCTAssertEqual(saved.appearance, new.appearance)
    }

    func testBackToTheLastOneDropsTheNewPainting() {
        var remake = PortraitRemake(hero(appearance: old.appearance, portraitUrl: old.portraitUrl))
        remake.painted(new)
        remake.backToLast()
        XCTAssertFalse(remake.awaitingChoice)
        XCTAssertEqual(remake.shown, PortraitRemake.Painting(old))
        XCTAssertFalse(remake.changed, "nothing to save")
    }

    func testARepaintOfTheNewOneStillComparesWithTheOneOnFile() {
        var remake = PortraitRemake(hero(appearance: old.appearance, portraitUrl: old.portraitUrl))
        remake.painted(new)
        XCTAssertEqual(remake.request(description: "copper braid", note: "").previousAppearance, new.appearance,
                       "a repaint works from the painting on show")
        let newer = PortraitResult(appearance: "Vex, older.", portraitUrl: "https://x.test/newer.png")
        remake.painted(newer)
        XCTAssertEqual(remake.shown.portraitUrl, newer.portraitUrl)
        remake.backToLast()
        XCTAssertEqual(remake.shown.portraitUrl, old.portraitUrl, "back to the one on file, not the one in between")
    }

    func testAKeptPaintingIsAChangeToSave() {
        var remake = PortraitRemake(hero(appearance: old.appearance, portraitUrl: old.portraitUrl))
        XCTAssertFalse(remake.changed)
        remake.painted(new)
        XCTAssertFalse(remake.changed, "not until it is kept")
        remake.keepNew()
        XCTAssertTrue(remake.changed)
    }
}
