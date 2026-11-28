import XCTest

/// Experience from actions on the result card, with real taps: a pick whose check was a long shot
/// lands, and the card says what each hero earned and why, with the chance of what happened
/// (Views/Game/TurnOutcome.swift, Core/TurnResult.swift `TurnXp`; docs/rules-design.md,
/// "Experience from actions").
///
/// Needs a local game of TWO players at a scene whose first choice is an Athletics check against
/// DC 20: DD_PLAYER, DD_XP and DD_API_BASE. The caller's hero has Athletics +1 (it needs a 19: 1
/// chance in 10) and the server's next d20 is a natural 20; the other hero's pick is already in,
/// with a 5 against a bonus of +9 (it needed an 11). The test spends the turn: give it a fresh game.
final class ActionXpUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        let env = ProcessInfo.processInfo.environment
        guard let player = env["DD_PLAYER"], let game = env["DD_XP"] else {
            throw XCTSkip("needs a local two-player game at a long-shot check: DD_PLAYER and DD_XP")
        }
        app = XCUIApplication()
        app.launchArguments = ["-apiBase", env["DD_API_BASE"] ?? "http://localhost:3000", "-playerId", player,
                               "-openGame", game, "-dd.soundOn", "NO", "-hudOpen", "NO"]
        app.launch()
    }

    private func element(containing words: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", words)).firstMatch
    }

    func testALongShotThatLandsIsOnTheResultCardWithItsReasonsAndItsChance() throws {
        let choose = app.buttons["Choose an action"]
        XCTAssertTrue(choose.waitForExistence(timeout: 20), "the Act bar")
        choose.tap()
        let leap = app.buttons["choice-a"]
        XCTAssertTrue(leap.waitForExistence(timeout: 10), "the scene's first choice")
        XCTAssertTrue(leap.label.contains("Athletics check, DC 20"), leap.label)
        leap.tap()

        // Both heroes have picked: the turn resolves and the result comes up.
        let onward = app.buttons["On with the story"]
        let dice = app.buttons["Show the dice"]
        XCTAssertTrue(onward.waitForExistence(timeout: 60) || dice.exists, "the result, and a way on once the next scene is written")
        if dice.exists { dice.tap() }
        XCTAssertTrue(onward.waitForExistence(timeout: 30))

        // Under each hero, once their dice have landed: the amount, every reason, and the chance of what happened.
        let mine = element(containing: "45 XP: a long shot that landed, 40, a 10% chance; taking part, 5")
        XCTAssertTrue(mine.waitForExistence(timeout: 15), "the caller's long shot, in full")
        XCTAssertTrue(mine.label.contains("(you)"), "it is under the caller's own hero: \(mine.label)")
        let theirs = element(containing: "10 XP: a brave failure, 5, a 50% chance; taking part, 5")
        XCTAssertTrue(theirs.exists, "the other hero's failure was the expected one")
        XCTAssertFalse(theirs.label.contains("(you)"))
        save("xp-result-card-after-a-tap")
        onward.tap()
        XCTAssertFalse(onward.waitForExistence(timeout: 2), "sent away")

        // The card can be brought back, and still says it.
        let again = app.buttons["How the last turn went"]
        var left = 6
        while !(again.exists && again.isHittable) && left > 0 { app.swipeUp(); left -= 1 }
        XCTAssertTrue(again.waitForExistence(timeout: 10), "the way back to the last turn's result")
        again.tap()
        XCTAssertTrue(mine.waitForExistence(timeout: 15), "the long shot is on the card when it is opened again")
        save("xp-result-card-again")
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
