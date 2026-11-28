import XCTest

/// Remaking a hero's portrait, with real taps (Views/Forge/PortraitRepaintSheet.swift,
/// PortraitStudio.swift, Core/PortraitRemake.swift; docs/api.md, POST /api/portrait). A new painting
/// waits beside the old one until the player keeps it or goes back, and nothing is saved until
/// "Keep & save".
///
/// Needs a local server and a player with an active hero: DD_PLAYER, DD_HERO (the hero's name) and
/// DD_API_BASE. The first test saves a new portrait for that hero.
final class PortraitRepaintUITests: XCTestCase {
    private var app: XCUIApplication!
    private var env: [String: String] { ProcessInfo.processInfo.environment }

    override func setUpWithError() throws {
        continueAfterFailure = false
        guard env["DD_PLAYER"] != nil, env["DD_HERO"] != nil else {
            throw XCTSkip("needs a local player with a hero: DD_PLAYER and DD_HERO")
        }
    }

    private func launch(_ arguments: [String]) {
        app = XCUIApplication()
        app.launchArguments = ["-apiBase", env["DD_API_BASE"] ?? "http://localhost:3000", "-playerId", env["DD_PLAYER"]!, "-dd.soundOn", "NO"] + arguments
        app.launch()
    }

    func testARepaintFromTheHerosPageWaitsToBeKeptAndOnlyKeepAndSaveSavesIt() throws {
        launch(["-openHeroNamed", env["DD_HERO"]!])
        let repaint = app.buttons["Repaint portrait"]
        XCTAssertTrue(repaint.waitForExistence(timeout: 30), "Repaint, under the portrait on the hero's page")
        save("portrait-hero-page")
        repaint.tap()

        // The sheet: the picture, a note for the painter, Repaint. Nothing to save yet.
        let keepAndSave = app.buttons["Keep & save"]
        XCTAssertTrue(keepAndSave.waitForExistence(timeout: 10), "the sheet")
        XCTAssertFalse(keepAndSave.isEnabled, "nothing has changed")
        let paint = app.buttons["Repaint"]
        XCTAssertTrue(paint.exists)
        save("portrait-sheet")

        // A new painting waits: keep it or go back. No save while the choice stands.
        paint.tap()
        let keepNew = app.buttons["Keep the new one"]
        let back = app.buttons["Back to the last one"]
        XCTAssertTrue(keepNew.waitForExistence(timeout: 60), "the new painting, and the choice")
        XCTAssertTrue(back.exists)
        XCTAssertFalse(keepAndSave.exists, "no save while the choice stands")
        save("portrait-choice")
        back.tap()
        XCTAssertTrue(keepAndSave.waitForExistence(timeout: 5))
        XCTAssertFalse(keepAndSave.isEnabled, "back to the last one: nothing to save")

        // Again, kept this time, and saved.
        paint.tap()
        XCTAssertTrue(keepNew.waitForExistence(timeout: 60))
        keepNew.tap()
        XCTAssertTrue(keepAndSave.waitForExistence(timeout: 5))
        XCTAssertTrue(keepAndSave.isEnabled, "a kept painting is there to save")
        keepAndSave.tap()
        XCTAssertTrue(repaint.waitForExistence(timeout: 20), "saved, and back on the hero's page")
        XCTAssertFalse(keepAndSave.exists)
        save("portrait-saved")
    }

    func testTheForgesPortraitStepPinsKeepAndSaveWithRepaintInSight() throws {
        launch(["-forgeStep", "portrait", "-forgeHeroNamed", env["DD_HERO"]!])
        XCTAssertTrue(app.buttons["Keep & save"].waitForExistence(timeout: 30), "the pinned save says what it does")
        let paint = app.buttons["Repaint"]
        XCTAssertTrue(paint.exists && paint.isHittable, "Repaint is on screen without scrolling")
        XCTAssertFalse(app.buttons["Seal hero"].exists, "the old label that was mistaken for it")
        save("portrait-forge")
    }

    func testANewHeroWithNoPaintingIsOfferedOneAndSealingWithoutSaysSo() throws {
        launch(["-forgeStep", "portrait"])
        XCTAssertTrue(app.buttons["Paint portrait"].waitForExistence(timeout: 30), "the first painting")
        XCTAssertTrue(app.buttons["Seal without portrait"].exists, "sealing now says what it leaves out")
        XCTAssertFalse(app.buttons["Keep & save"].exists)
        save("portrait-forge-new")
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
