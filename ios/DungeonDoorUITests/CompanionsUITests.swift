import XCTest

/// Calling companions to a door, with real taps (Views/Game/Companions.swift; docs/api.md, Companion).
/// A companion is a person: a hero of theirs who has died is not offered, the person can still be
/// invited and named, and one of their living heroes can be asked for.
///
/// Needs a local lobby whose one player has adventured with two others: DD_PLAYER, DD_LOBBY and
/// DD_API_BASE. One played Slagette, who has fallen, and has Brannoch Vale and Ilse Thornwood alive,
/// Brannoch the newer (DD_COMPANION is that player, for the second half: the invitation as they see
/// it). The other played Fardock, who has fallen, and has no other hero. The test invites and
/// names: give it a fresh server.
final class CompanionsUITests: XCTestCase {
    private var app: XCUIApplication!
    private var env: [String: String] { ProcessInfo.processInfo.environment }

    override func setUpWithError() throws {
        continueAfterFailure = false
        guard env["DD_PLAYER"] != nil, env["DD_LOBBY"] != nil else {
            throw XCTSkip("needs a local lobby and companions: DD_PLAYER and DD_LOBBY")
        }
    }

    private func launch(as player: String, _ arguments: [String]) {
        app = XCUIApplication()
        app.launchArguments = ["-apiBase", env["DD_API_BASE"] ?? "http://localhost:3000", "-playerId", player, "-dd.soundOn", "NO"] + arguments
        app.launch()
    }

    private func button(_ format: String, _ words: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: format, words)).firstMatch
    }

    private func text(containing words: String) -> XCUIElement {
        app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", words)).firstMatch
    }

    /// Scrolls the page up until the element can be tapped.
    private func bring(_ element: XCUIElement, tries: Int = 8) {
        var left = tries
        while !(element.exists && element.isHittable) && left > 0 {
            app.swipeUp()
            left -= 1
        }
    }

    /// Types into the alert on screen and saves it.
    private func answer(_ title: String, with words: String) {
        let alert = app.alerts[title]
        XCTAssertTrue(alert.waitForExistence(timeout: 5), "the alert \(title)")
        let field = alert.textFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.typeText(words)
        alert.buttons["Save"].tap()
    }

    func testAFallenHeroIsNotOfferedAndThePersonIsCalledByNameWithAHeroOfTheirs() throws {
        launch(as: env["DD_PLAYER"]!, ["-openGame", env["DD_LOBBY"]!])

        // The people, not the heroes they last played: Slagette and Fardock fell, and are not offered.
        let unnamed = app.staticTexts["Slagette's player"]
        XCTAssertTrue(unnamed.waitForExistence(timeout: 20), "the person who played Slagette")
        XCTAssertTrue(app.staticTexts["Fardock's player"].exists)
        let brannoch = button("label BEGINSWITH %@", "Ask for Brannoch Vale")
        XCTAssertTrue(brannoch.exists, "a living hero of theirs")
        XCTAssertFalse(button("label CONTAINS %@", "for Slagette").exists, "the fallen Slagette is not offered")
        XCTAssertFalse(button("label CONTAINS %@", "for Fardock").exists, "nor the fallen Fardock")
        XCTAssertFalse(button("label CONTAINS %@", "for Old Garrick").exists, "nor a retired hero")
        XCTAssertTrue(text(containing: "No hero ready to go").exists, "Fardock's player has nobody to bring, and is listed")
        bring(brannoch)
        save("companions-people")

        // Naming the person: mine alone, and at once.
        let pencil = button("label == %@", "Name Slagette's player")
        bring(pencil)
        pencil.tap()
        answer("What do you call them?", with: "Micah")
        XCTAssertTrue(app.staticTexts["Micah"].waitForExistence(timeout: 10), "named")
        XCTAssertFalse(unnamed.exists)

        // Asking for one of their heroes invites the person, and marks the hero. Ilse is not the
        // hero their join screen would pick by itself, so the ask shows there.
        let ilse = button("label BEGINSWITH %@", "Ask for Ilse Thornwood")
        bring(ilse)
        ilse.tap()
        let asked = button("label BEGINSWITH %@", "Asked for Ilse Thornwood")
        XCTAssertTrue(asked.waitForExistence(timeout: 10), "Ilse is asked for")
        XCTAssertTrue(asked.isSelected)
        XCTAssertTrue(brannoch.exists, "Brannoch is still there to ask for instead")
        XCTAssertFalse(button("label == %@", "Invite Micah").exists, "the person is invited: no second button")

        // A person with no hero ready is invited all the same.
        let fardock = button("label == %@", "Invite Fardock's player")
        bring(fardock)
        fardock.tap()
        XCTAssertFalse(fardock.waitForExistence(timeout: 3) && fardock.isHittable, "invited")
        save("companions-invited")

        // The player's own name, for the people they call.
        let mine = app.buttons["your-name"]
        var left = 6
        while !(mine.exists && mine.isHittable) && left > 0 { app.swipeDown(); left -= 1 }
        XCTAssertTrue(mine.isHittable, "the row for your name")
        mine.tap()
        answer("Your name", with: "Justin")
        XCTAssertTrue(text(containing: "Your companions know you as Justin").waitForExistence(timeout: 10))
        save("companions-named")

        // The other side: the person invited sees who asks, and for which hero, and the way in opens on it.
        guard let companion = env["DD_COMPANION"] else { return }
        app.terminate()
        launch(as: companion, [])
        XCTAssertTrue(text(containing: "Justin invites you").waitForExistence(timeout: 20), "the invitation, from the person")
        XCTAssertTrue(text(containing: "Asks for Ilse Thornwood").exists)
        save("invitation-card")
        app.buttons["Join"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["asked-for"].waitForExistence(timeout: 10), "the join sheet says who was asked for")
        XCTAssertEqual(app.staticTexts["asked-for"].label, "Justin asked for Ilse Thornwood. You can bring another.")
        // The home screen's tiles sit behind the sheet under the same names: the picker's card is the selected one.
        func picked(_ name: String) -> Bool {
            app.buttons.matching(NSPredicate(format: "label CONTAINS %@", name)).allElementsBoundByIndex.contains { $0.isSelected }
        }
        XCTAssertTrue(picked("Ilse Thornwood"), "Ilse is the hero picked")
        XCTAssertFalse(picked("Brannoch Vale"), "not the first of their heroes")
        save("invitation-join")
    }

    private func save(_ name: String) {
        let png = XCUIScreen.main.screenshot().pngRepresentation
        let shot = XCTAttachment(data: png, uniformTypeIdentifier: "public.png")
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
        if let dir = env["DD_SHOTS"] {
            try? png.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(name).png"))
        }
    }
}
