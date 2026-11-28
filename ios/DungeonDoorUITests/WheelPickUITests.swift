import XCTest

/// A spell picked from the Spells wheel in a fight, with real taps. The pick is the hero's own
/// action: the spell card shows that spell as the pick, never the spell a plain tap would cast, and
/// the Chosen bar says the action with who it is aimed at and what it rolls
/// (Views/Game/PlayTurn.swift, `Declared`; docs/app-tabs.md, "A fight's cards are kinds of action").
///
/// Needs a local fight of TWO players, so one hero's action does not resolve the round, with the
/// round open and nobody's action in: DD_PLAYER, DD_FIGHT and DD_API_BASE. The caller is a caster
/// whose plain Cast is Magic Missile and who has Ray of Frost with one foe in range (whoever the
/// foe is). The test spends
/// that hero's action: give it a fresh fight.
final class WheelPickUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        let env = ProcessInfo.processInfo.environment
        guard let player = env["DD_PLAYER"], let game = env["DD_FIGHT"] else {
            throw XCTSkip("needs a local two-player fight with a caster: DD_PLAYER and DD_FIGHT")
        }
        app = XCUIApplication()
        app.launchArguments = ["-apiBase", env["DD_API_BASE"] ?? "http://localhost:3000", "-playerId", player,
                               "-openGame", game, "-dd.soundOn", "NO", "-hudOpen", "NO", "-turnResult", "NO"]
        app.launch()
    }

    /// Scrolls the page until the element can be tapped.
    private func bring(_ element: XCUIElement, tries: Int = 8) {
        var left = tries
        while !(element.exists && element.isHittable) && left > 0 {
            app.swipeUp()
            left -= 1
        }
    }

    func testASpellFromTheWheelIsThePickOnTheSpellCardAndInTheChosenBar() throws {
        // The spell card, before any pick: the kind of action, and what a plain tap of it casts.
        let card = app.buttons["choice-b"]
        XCTAssertTrue(card.waitForExistence(timeout: 30), "the spell card")
        bring(card)
        XCTAssertTrue(card.label.hasPrefix("Cast a spell. Magic Missile."), card.label)
        XCTAssertFalse(card.label.contains("your pick"), "nothing picked yet")
        XCTAssertTrue(app.buttons["choice-a"].label.hasPrefix("Attack."), app.buttons["choice-a"].label)
        save("wheel-before")

        // Ray of Frost, from the Spells wheel. It has one foe in range, so the tap declares it.
        let spells = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Spells")).firstMatch
        bring(spells)
        spells.tap()
        let frost = app.buttons["wheel-spell:ray-of-frost"]
        XCTAssertTrue(frost.waitForExistence(timeout: 10), "Ray of Frost on the wheel")
        XCTAssertEqual(frost.label, "Cast Ray of Frost")
        save("wheel-open")
        frost.tap()

        // The Chosen bar: the action, who it is aimed at, and what it rolls.
        let chosen = app.descendants(matching: .any)["chosen-action"]
        let throwIt = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Throw your d20")).firstMatch
        XCTAssertTrue(chosen.waitForExistence(timeout: 15) || throwIt.waitForExistence(timeout: 5), "the pick is in")
        // An attack spell has a d20 to throw first: throw it, and the bar says what was chosen.
        if throwIt.exists { throwIt.tap() }
        XCTAssertTrue(chosen.waitForExistence(timeout: 15), "the Chosen bar")
        XCTAssertTrue(chosen.label.contains("Cast Ray of Frost"), chosen.label)
        XCTAssertTrue(chosen.label.contains("Cast Ray of Frost, At "), "who it is aimed at: \(chosen.label)")
        XCTAssertTrue(chosen.label.contains("to hit"), "and what it rolls: \(chosen.label)")
        XCTAssertFalse(chosen.label.contains("Magic Missile"), chosen.label)

        // The spell card holds the pick, as Ray of Frost. It no longer speaks of Magic Missile.
        bring(card)
        XCTAssertTrue(card.label.hasPrefix("Cast a spell. Ray of Frost. At "), card.label)
        XCTAssertTrue(card.label.contains("your pick"), card.label)
        XCTAssertFalse(card.label.contains("Magic Missile"), "the plain pick is not shown as chosen: \(card.label)")
        XCTAssertFalse(app.buttons["choice-a"].label.contains("your pick"))
        XCTAssertFalse(app.buttons["choice-c"].label.contains("your pick"))
        XCTAssertFalse(app.descendants(matching: .any)["own-pick"].exists, "the card holds it: no second row")
        save("wheel-picked")

        // An action that is none of the cards gets a row of its own, and no card is marked.
        let actions = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Actions")).firstMatch
        bring(actions)
        actions.tap()
        let dash = app.buttons["wheel-common:dash"]
        XCTAssertTrue(dash.waitForExistence(timeout: 10), "Dash on the wheel")
        dash.tap()
        let own = app.descendants(matching: .any)["own-pick"]
        XCTAssertTrue(own.waitForExistence(timeout: 15), "a row for Dash")
        XCTAssertTrue(own.label.contains("Dash"), own.label)
        for letter in ["a", "b", "c"] {
            XCTAssertFalse(app.buttons["choice-\(letter)"].label.contains("your pick"), "card \(letter) does not say Dash")
        }
        XCTAssertTrue(card.label.hasPrefix("Cast a spell. Magic Missile."), "the spell card is back to what a plain tap casts: \(card.label)")
        save("wheel-dash")

        // The same spell in the player's own words is the same action: that spell, at the foe they name.
        let field = app.textViews["Say what you do…"].exists ? app.textViews["Say what you do…"] : app.textFields["Say what you do…"]
        bring(field)
        XCTAssertTrue(field.waitForExistence(timeout: 10), "the box for your own words")
        field.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5), "the keyboard comes up")
        field.typeText("I cast ray of frost at its legs")
        app.typeText("\n")  // Return sends it
        let taken = app.staticTexts["words-taken"]
        XCTAssertTrue(taken.waitForExistence(timeout: 15), "the line that says what the words were taken as")
        XCTAssertTrue(taken.label.hasPrefix("Taken as: Cast Ray of Frost. At "), taken.label)
        if throwIt.waitForExistence(timeout: 3) { throwIt.tap() }
        XCTAssertTrue(chosen.waitForExistence(timeout: 15))
        XCTAssertTrue(chosen.label.contains("Cast Ray of Frost"), chosen.label)
        XCTAssertTrue(chosen.label.contains("I cast ray of frost at its legs"), "the words stay with it: \(chosen.label)")
        XCTAssertFalse(own.exists, "the spell card holds it again")
        // Up to the card, for the picture and the last check.
        var left = 6
        while !(card.exists && card.isHittable) && left > 0 { app.swipeDown(); left -= 1 }
        XCTAssertTrue(card.label.hasPrefix("Cast a spell. Ray of Frost. At "), card.label)
        XCTAssertTrue(card.label.contains("from your words: I cast ray of frost at its legs"), card.label)
        save("wheel-words")
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
