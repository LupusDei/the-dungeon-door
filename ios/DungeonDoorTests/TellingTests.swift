import XCTest

/// How a game is told (docs/api.md, `telling`): what the catalog offers a host, what a game says of
/// itself, and that a server from before tellings reads as the full story.
final class TellingTests: XCTestCase {
    private func state(_ extra: String = "") throws -> GameState {
        let json = """
        { "code": "ABCDEF", "hostId": "p1", "status": "voting", "dungeonMaster": "chronicler", "title": null,
          "sceneCount": 6, "players": [], "scene": null, "messages": [], "rules": null, "updatedAt": ""\(extra) }
        """
        return try JSONDecoder().decode(GameState.self, from: Data(json.utf8))
    }

    private func catalog(_ extra: String = "") throws -> Catalog {
        let json = """
        { "races": [], "classes": [], "temperaments": [], "genders": [], "alignments": [], "dungeonMasters": []\(extra) }
        """
        return try JSONDecoder().decode(Catalog.self, from: Data(json.utf8))
    }

    func testAStreamlinedGameSaysSo() throws {
        let game = try state(#", "telling": "streamlined""#)
        XCTAssertEqual(game.telling, "streamlined")
        XCTAssertTrue(game.isStreamlined)
    }

    func testAGameIsToldInFullUnlessItSaysOtherwise() throws {
        XCTAssertFalse(try state(#", "telling": "full""#).isStreamlined)
        let old = try state()
        XCTAssertEqual(old.telling, "full", "a server from before tellings sends none")
        XCTAssertFalse(old.isStreamlined)
        XCTAssertFalse(try state(#", "telling": "a telling from a later server""#).isStreamlined, "one the app does not know is drawn in full")
    }

    func testTheCatalogListsTheTellingsInTheOrderToShowThem() throws {
        let listed = try catalog(#"""
        , "tellings": [{ "id": "full", "name": "Full story", "blurb": "In full.", "symbol": "text.book.closed.fill" },
                       { "id": "streamlined", "name": "Streamlined", "blurb": "Much less to read.", "symbol": "bolt.fill" }]
        """#)
        XCTAssertEqual(listed.tellings.map(\.id), ["full", "streamlined"])
        XCTAssertEqual(listed.tellings[1].name, "Streamlined")
        XCTAssertEqual(listed.tellings[1].symbol, "bolt.fill")
    }

    func testAServerFromBeforeTellingsOffersNone() throws {
        XCTAssertEqual(try catalog().tellings, [], "so the lobby shows no picker and the start names no telling")
    }
}
