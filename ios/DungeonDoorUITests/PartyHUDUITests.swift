import XCTest

/// The heads-up display at the top of the play screen (Views/Game/PartyHUD.swift), with real taps
/// and drags: the slim row opens into the card and the card closes back into the row.
///
/// Needs a local game, as the other UI tests do (DD_PLAYER, DD_GAME, DD_API_BASE). DD_FIGHT names a
/// game that is in a fight, for the test that a fight opens the card by itself.
final class PartyHUDUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    private func launch(game key: String = "DD_GAME", _ arguments: [String] = []) throws {
        let env = ProcessInfo.processInfo.environment
        guard let player = env["DD_PLAYER"], let game = env[key] else {
            throw XCTSkip("needs a local game: DD_PLAYER and \(key)")
        }
        app = XCUIApplication()
        app.launchArguments = ["-apiBase", env["DD_API_BASE"] ?? "http://localhost:3000", "-playerId", player,
                               "-openGame", game, "-dd.soundOn", "NO", "-turnResult", "NO"] + arguments
        app.launch()
    }

    /// The row: one button that names the party.
    private var row: XCUIElement {
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Party:")).firstMatch
    }

    /// The card's top line, which closes it.
    private var close: XCUIElement { app.buttons["Close the party"] }

    /// The card's chips: each says its armour class (a hero) or that it is a foe.
    private func chips(_ word: String) -> XCUIElementQuery {
        app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", word))
    }

    func testATapOpensTheRowIntoTheCardAndATapOnItsTopLineClosesIt() throws {
        try launch(["-hudOpen", "NO"])
        XCTAssertTrue(row.waitForExistence(timeout: 20), "the row")
        save("hud-row")
        row.tap()
        XCTAssertTrue(close.waitForExistence(timeout: 5), "the card")
        XCTAssertGreaterThan(chips("armour class").count, 0, "a chip for each hero")
        XCTAssertFalse(row.exists, "the card stands in the row's place")
        save("hud-card")
        close.tap()
        XCTAssertTrue(row.waitForExistence(timeout: 5), "the row again")
        XCTAssertFalse(close.exists)
    }

    func testAPullDownOpensTheCardAndAPushUpClosesIt() throws {
        try launch(["-hudOpen", "NO"])
        XCTAssertTrue(row.waitForExistence(timeout: 20), "the row")
        sleep(2)  // the scene settles under it
        // The row is its own height and no more: under the navigation bar, not behind it.
        XCTAssertGreaterThan(row.frame.minY, 80, "the row's frame starts under the navigation bar")
        XCTAssertLessThan(row.frame.height, 120)
        let from = row.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        from.press(forDuration: 0.05, thenDragTo: from.withOffset(CGVector(dx: 0, dy: 90)))
        XCTAssertTrue(close.waitForExistence(timeout: 5), "pulled down")
        save("hud-pulled")
        // Up from the middle of the card, over the chips.
        let chip = chips("armour class").firstMatch
        let grip = chip.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        grip.press(forDuration: 0.05, thenDragTo: grip.withOffset(CGVector(dx: 0, dy: -90)))
        XCTAssertTrue(row.waitForExistence(timeout: 5), "pushed up")
        save("hud-pushed")
    }

    func testAFightOpensTheCardWithItsFoesAndThePlayerCanPutItAway() throws {
        try launch(game: "DD_FIGHT")
        XCTAssertTrue(close.waitForExistence(timeout: 20), "the card, without a tap")
        XCTAssertGreaterThan(chips(", foe,").count, 0, "a chip for each foe")
        XCTAssertGreaterThan(chips("armour class").count, 0, "a chip for each hero")
        save("hud-fight")
        close.tap()
        XCTAssertTrue(row.waitForExistence(timeout: 5), "the row, while the fight goes on")
        // Still put away after a look at another tab and back.
        app.buttons["Sheet"].firstMatch.tap()
        app.buttons["Story"].firstMatch.tap()
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        XCTAssertFalse(close.exists, "the card stays where the player put it")
        save("hud-fight-put-away")
    }

    private func save(_ name: String) {
        let png = XCUIScreen.main.screenshot().pngRepresentation
        let shot = XCTAttachment(data: png, uniformTypeIdentifier: "public.png")
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
        if let dir = ProcessInfo.processInfo.environment["DD_SHOTS"] {
            try? png.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(name).png"))
        }
    }
}
