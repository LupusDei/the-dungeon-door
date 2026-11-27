import XCTest

/// Return on the play screen's fields: the keyboard goes away (Core/ReturnKey.swift, UI/ReturnIsDone.swift).
final class ReturnKeyUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        let env = ProcessInfo.processInfo.environment
        guard let player = env["DD_PLAYER"], let game = env["DD_GAME"] else {
            throw XCTSkip("needs a local game: DD_PLAYER and DD_GAME")
        }
        app = XCUIApplication()
        app.launchArguments = ["-apiBase", env["DD_API_BASE"] ?? "http://localhost:3000", "-playerId", player, "-openGame", game]
        app.launch()
    }

    func testReturnInTheFreeTextActionSendsItAndHidesTheKeyboard() throws {
        app.buttons["Choose an action"].tap()
        let field = app.textViews["Say what you do…"].exists ? app.textViews["Say what you do…"] : app.textFields["Say what you do…"]
        try returnHidesTheKeyboard(field, typing: "I climb the wall", shot: "keyboard-freeform")
    }

    func testReturnInTheSpeakBoxHidesTheKeyboard() throws {
        let field = app.textViews["Say or do…"].exists ? app.textViews["Say or do…"] : app.textFields["Say or do…"]
        try returnHidesTheKeyboard(field, typing: "Stand fast!", shot: "keyboard-speak")
    }

    func testReturnInTheChatSendsItAndHidesTheKeyboard() throws {
        app.buttons["Chat"].firstMatch.tap()
        let field = app.textViews.firstMatch.waitForExistence(timeout: 5) ? app.textViews.firstMatch : app.textFields.firstMatch
        try returnHidesTheKeyboard(field, typing: "Who goes first?", shot: "keyboard-chat")
        XCTAssertTrue(app.staticTexts["Who goes first?"].waitForExistence(timeout: 10), "the line went to the table")
    }

    private func returnHidesTheKeyboard(_ field: XCUIElement, typing text: String, shot: String) throws {
        XCTAssertTrue(field.waitForExistence(timeout: 15))
        field.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5), "the keyboard comes up")
        field.typeText(text)
        save("\(shot)-before")
        app.typeText("\n")  // Return on the keyboard, into whichever field has it
        let gone = NSPredicate(format: "exists == false")
        expectation(for: gone, evaluatedWith: app.keyboards.firstMatch)
        waitForExpectations(timeout: 5)
        save("\(shot)-after")
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
