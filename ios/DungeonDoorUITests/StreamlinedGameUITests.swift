import XCTest

/// A streamlined game from the door to its first turn, with real taps: the host picks "Streamlined"
/// in the lobby, opens the door, and plays a turn on the shorter Story page (Views/Game/LobbyView.swift,
/// PlayStoryPage.swift, TurnBrief.swift; docs/app-tabs.md, "A streamlined game").
///
/// Needs a local game still in its lobby, with ONE player who is its host, so a single pick resolves
/// the turn: DD_PLAYER, DD_LOBBY and DD_API_BASE. The test opens that door: give it a fresh lobby.
final class StreamlinedGameUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        let env = ProcessInfo.processInfo.environment
        guard let player = env["DD_PLAYER"], let game = env["DD_LOBBY"] else {
            throw XCTSkip("needs a local one-player lobby: DD_PLAYER and DD_LOBBY")
        }
        app = XCUIApplication()
        app.launchArguments = ["-apiBase", env["DD_API_BASE"] ?? "http://localhost:3000", "-playerId", player,
                               "-openGame", game, "-dd.soundOn", "NO", "-hudOpen", "NO"]
        app.launch()
    }

    private func text(containing words: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS[c] %@", words)).firstMatch
    }

    /// Scrolls the page up until the element can be tapped.
    private func bring(_ element: XCUIElement, tries: Int = 8) {
        var left = tries
        while !(element.exists && element.isHittable) && left > 0 {
            app.swipeUp()
            left -= 1
        }
    }

    func testTheHostPicksAStreamlinedGameAndPlaysATurnOfIt() throws {
        // The lobby offers how the game is told, the full story picked until the host says otherwise.
        let streamlined = app.buttons["telling-streamlined"]
        let full = app.buttons["telling-full"]
        XCTAssertTrue(app.buttons["Open the door"].waitForExistence(timeout: 20) || streamlined.waitForExistence(timeout: 5), "the lobby, as its host")
        bring(streamlined)
        XCTAssertTrue(streamlined.isHittable, "the streamlined game, among the ways to tell it")
        XCTAssertTrue(full.isSelected, "the full story is the default")
        XCTAssertFalse(streamlined.isSelected)
        streamlined.tap()
        XCTAssertTrue(streamlined.isSelected, "picked")
        XCTAssertFalse(full.isSelected)
        save("streamlined-lobby")

        let open = app.buttons["Open the door"]
        bring(open)
        open.tap()

        // The Story page of a streamlined game: the scene in a line, the choices, and no paragraphs of help.
        let line = app.staticTexts["scene-line"]
        XCTAssertTrue(line.waitForExistence(timeout: 40), "the scene's line")
        XCTAssertFalse(line.label.contains("\n"), "one paragraph: \(line.label)")
        XCTAssertFalse(text(containing: "The party goes with the choice most heroes pick").exists, "no help under the heading")
        XCTAssertFalse(text(containing: "the dungeon master judges it").exists, "nor under the box")
        XCTAssertFalse(app.otherElements["what-happened"].exists, "nothing has happened yet")
        save("streamlined-first-scene")

        // A pick resolves the turn (a party of one). The result card is as in any game.
        let choose = app.buttons["Choose an action"]
        XCTAssertTrue(choose.waitForExistence(timeout: 10), "the Act bar")
        choose.tap()
        let first = app.buttons["choice-a"]
        XCTAssertTrue(first.waitForExistence(timeout: 10), "the scene's first choice")
        first.tap()
        let onward = app.buttons["On with the story"]
        let dice = app.buttons["Show the dice"]
        XCTAssertTrue(onward.waitForExistence(timeout: 60) || dice.exists, "the result card, and a way on")
        if dice.exists { dice.tap() }
        XCTAssertTrue(onward.waitForExistence(timeout: 30))
        onward.tap()

        // The next scene leads with what happened.
        let happened = app.otherElements["what-happened"]
        XCTAssertTrue(happened.waitForExistence(timeout: 15), "what happened, at the head of the page")
        XCTAssertTrue(app.buttons["Show every roll of the last turn"].exists, "and the way back to every roll")
        XCTAssertTrue(app.staticTexts["scene-line"].exists)
        XCTAssertFalse(app.buttons["How the last turn went"].exists, "the full page's button is not repeated")
        save("streamlined-next-scene")
        app.buttons["Show every roll of the last turn"].tap()
        XCTAssertTrue(onward.waitForExistence(timeout: 10), "the whole result again")
        onward.tap()

        // Lower down: the choices with nothing explained under them, and speaking in character folded away.
        let speak = app.buttons["In character"].exists ? app.buttons["In character"] : text(containing: "In character")
        bring(speak)
        XCTAssertTrue(speak.exists, "in character, folded")
        XCTAssertFalse(app.buttons["Speak in character"].exists, "its field is not on the page until asked for")
        XCTAssertFalse(text(containing: "The party goes with the choice most heroes pick").exists)
        save("streamlined-foot")
        speak.tap()
        XCTAssertTrue(app.buttons["Speak in character"].waitForExistence(timeout: 5), "unfolded on a tap")
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
