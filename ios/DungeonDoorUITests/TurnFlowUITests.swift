import XCTest

/// One whole turn with real taps: pick one of the scene's choices, watch the result come up with
/// every hero on it, and go on to the next scene (Views/Game/PlayStoryPage.swift, TurnOutcome.swift).
///
/// Needs a local game with ONE player at a scene that offers choices, so a single pick resolves the
/// turn: DD_PLAYER, DD_SOLO and DD_API_BASE. The test spends that game's turn: give it a fresh one.
final class TurnFlowUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        let env = ProcessInfo.processInfo.environment
        guard let player = env["DD_PLAYER"], let game = env["DD_SOLO"] else {
            throw XCTSkip("needs a local one-player game: DD_PLAYER and DD_SOLO")
        }
        app = XCUIApplication()
        app.launchArguments = ["-apiBase", env["DD_API_BASE"] ?? "http://localhost:3000", "-playerId", player,
                               "-openGame", game, "-dd.soundOn", "NO", "-hudOpen", "NO"]
        app.launch()
    }

    private func text(containing words: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS[c] %@", words)).firstMatch
    }

    func testAPickResolvesTheTurnAndTheResultStaysUntilSentAway() throws {
        // The choices are on the Story page again.
        let choose = app.buttons["Choose an action"]
        XCTAssertTrue(choose.waitForExistence(timeout: 20), "the Act bar")
        choose.tap()
        let first = app.buttons["choice-a"]
        XCTAssertTrue(first.waitForExistence(timeout: 10), "the scene's first choice")
        XCTAssertTrue(app.buttons["choice-b"].exists, "and its second")
        save("turn-choices")
        first.tap()

        // The only hero has picked, so the turn resolves: the result comes up and stays.
        let onward = app.buttons["On with the story"]
        let dice = app.buttons["Show the dice"]
        XCTAssertTrue(text(containing: "party chose").waitForExistence(timeout: 30), "the result names the party's choice")
        save("turn-result-early")
        // Dice still in the air can be landed at once; with none to roll the way on is already there.
        XCTAssertTrue(onward.waitForExistence(timeout: 40) || dice.exists, "a way on once the next scene is written")
        if dice.exists { dice.tap() }
        XCTAssertTrue(onward.waitForExistence(timeout: 20))
        XCTAssertTrue(text(containing: "(you)").exists, "the caller's own hero is on the result")
        save("turn-result")
        sleep(3)
        XCTAssertTrue(onward.exists, "the result does not leave by itself")
        onward.tap()
        XCTAssertFalse(onward.waitForExistence(timeout: 2), "sent away")

        // The next scene is under it; the result can be brought back.
        let again = app.buttons["How the last turn went"]
        if !again.exists { app.swipeUp() }
        if !again.exists { app.swipeUp() }
        XCTAssertTrue(again.waitForExistence(timeout: 10), "the way back to the last turn's result")
        again.tap()
        XCTAssertTrue(onward.waitForExistence(timeout: 10), "the result again")
        save("turn-result-again")
        onward.tap()
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
