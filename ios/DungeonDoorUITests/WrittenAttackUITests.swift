import XCTest

/// An attack written in the player's own words while a fight is on offer. The server counts the
/// words as a pick of that choice (docs/rules-design.md, "A written attack outside a fight"), and
/// the Story page says so: on the choice's card and under the box (Views/Game/PlayStoryPage.swift).
///
/// Needs a local game of TWO players, so one hero's action does not resolve the turn, at a scene
/// that is not a fight and has a choice that starts one: DD_PLAYER, DD_ATTACK and DD_API_BASE.
/// The test spends that hero's action: give it a fresh game.
final class WrittenAttackUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        let env = ProcessInfo.processInfo.environment
        guard let player = env["DD_PLAYER"], let game = env["DD_ATTACK"] else {
            throw XCTSkip("needs a local two-player game with a fight on offer: DD_PLAYER and DD_ATTACK")
        }
        app = XCUIApplication()
        app.launchArguments = ["-apiBase", env["DD_API_BASE"] ?? "http://localhost:3000", "-playerId", player,
                               "-openGame", game, "-dd.soundOn", "NO", "-hudOpen", "NO", "-turnResult", "NO"]
        app.launch()
    }

    func testAnAttackInYourOwnWordsIsAPickOfTheFightOnOffer() throws {
        let choose = app.buttons["Choose an action"]
        XCTAssertTrue(choose.waitForExistence(timeout: 20), "the Act bar")
        choose.tap()
        // The card whose rules line starts a fight.
        let fight = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Fight:")).firstMatch
        XCTAssertTrue(fight.waitForExistence(timeout: 10), "a choice that starts a fight")
        XCTAssertFalse(fight.label.contains("your pick"), "nothing picked yet")
        save("attack-before")

        let field = app.textViews["Say what you do…"].exists ? app.textViews["Say what you do…"] : app.textFields["Say what you do…"]
        if !field.exists { app.swipeUp() }
        XCTAssertTrue(field.waitForExistence(timeout: 10), "the box for your own words")
        field.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5), "the keyboard comes up")
        field.typeText("I attack them before they turn")
        app.typeText("\n")  // Return sends it

        // The words were not a side roll: they are the pick, and the page says which.
        let counted = app.staticTexts["words-counted"]
        XCTAssertTrue(counted.waitForExistence(timeout: 15), "the line under the box")
        XCTAssertTrue(counted.label.hasPrefix("Your words count as picking:"), counted.label)
        save("attack-counted")
        XCTAssertTrue(fight.label.contains("your pick"), "the fight's card is the pick: \(fight.label)")
        XCTAssertTrue(fight.label.contains("from your words: I attack them before they turn"), fight.label)
        XCTAssertFalse(app.buttons["Throw your d20"].exists, "no die to throw for a pick")
        // Back up to the card, for the picture.
        app.swipeDown()
        let middle = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.65))
        middle.press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3)))
        save("attack-card")
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
