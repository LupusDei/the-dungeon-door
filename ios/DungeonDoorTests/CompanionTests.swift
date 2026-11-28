import XCTest

/// Companions as people (docs/api.md, Companion; Views/Game/Companions.swift): who the lobby lists,
/// which heroes it offers, and what an invitation says of who sent it and the hero it asks for.
final class CompanionTests: XCTestCase {
    private func companions(_ json: String) throws -> [Companion] {
        try JSONDecoder().decode([Companion].self, from: Data(json.utf8))
    }

    private func invitation(_ json: String) throws -> Invitation {
        try JSONDecoder().decode(Invitation.self, from: Data(json.utf8))
    }

    func testACompanionIsAPersonWithTheHeroesWhoCanGo() throws {
        let met = try companions(#"""
        [{ "playerId": "p2", "name": "Slagette's player", "namedBy": null, "playedAs": "Slagette", "lastPlayedAt": "2026-11-20T00:00:00Z",
           "heroes": [{ "id": "c1", "name": "Brannoch", "race": "human", "characterClass": "fighter", "level": 3, "portraitUrl": "https://x.test/b.jpg" },
                      { "id": "c2", "name": "Ilse", "race": "elf", "characterClass": "wizard", "level": 1, "portraitUrl": null }] }]
        """#)
        let micah = try XCTUnwrap(met.first)
        XCTAssertEqual(micah.name, "Slagette's player")
        XCTAssertNil(micah.namedBy)
        XCTAssertNil(micah.nickname)
        XCTAssertEqual(micah.playedAs, "Slagette")
        XCTAssertEqual(micah.heroes.map(\.name), ["Brannoch", "Ilse"], "the fallen Slagette is not among them")
        XCTAssertEqual(micah.heroes[0].level, 3)
        XCTAssertEqual(micah.heroes[0].portraitURL?.absoluteString, "https://x.test/b.jpg")
        XCTAssertNil(micah.heroes[1].portraitURL)
        XCTAssertNil(CompanionCall.caption(for: micah), "the name and the heroes say enough")
        XCTAssertEqual(CompanionCall.heroLine(micah.heroes[0], className: "Fighter"), "Fighter 3")
        XCTAssertEqual(CompanionCall.heroLabel(micah.heroes[0], className: "Fighter", asked: false), "Ask for Brannoch, Fighter, level 3")
        XCTAssertEqual(CompanionCall.heroLabel(micah.heroes[0], className: "Fighter", asked: true), "Asked for Brannoch, Fighter, level 3")
    }

    func testAPersonWithNoHeroWhoCanGoIsStillListedAndSaysSo() throws {
        let met = try companions(#"[{ "playerId": "p3", "name": "Fardock's player", "namedBy": null, "playedAs": "Fardock", "heroes": [] }]"#)
        XCTAssertEqual(CompanionCall.absent(met, here: []).map(\.name), ["Fardock's player"])
        XCTAssertEqual(CompanionCall.caption(for: met[0]), "No hero ready to go: they can forge one to join.")
    }

    func testTheirOwnNameIsTheirNameAndANicknameSitsBesideIt() throws {
        let met = try companions(#"""
        [{ "playerId": "p4", "name": "Robin", "namedBy": "them", "nickname": null, "playedAs": "Wren", "heroes": [{ "id": "c9", "name": "Wren", "characterClass": "ranger", "level": 2 }] },
         { "playerId": "p5", "name": "Slagyr", "namedBy": "them", "nickname": "Micah", "playedAs": "Slagette", "heroes": [] },
         { "playerId": "p6", "name": "Bob", "namedBy": "you", "nickname": "Bob", "playedAs": "Fardock", "heroes": [] }]
        """#)
        XCTAssertEqual(CompanionCall.caption(for: met[0]), "Played Wren beside you.")
        XCTAssertNil(met[0].shownNickname)
        // They named themselves: that is the name, and the player's nickname is shown beside it.
        XCTAssertEqual(met[1].name, "Slagyr")
        XCTAssertEqual(met[1].shownNickname, "Micah")
        XCTAssertEqual(CompanionCall.namingMessage(for: met[1]),
                       "They played Slagette beside you. Only you see a nickname. Their own name, Slagyr, stays their name. Leave it empty to take it back.")
        // Nobody else has named them: the nickname is what they are called, and is not said twice.
        XCTAssertEqual(met[2].name, "Bob")
        XCTAssertEqual(met[2].nickname, "Bob")
        XCTAssertNil(met[2].shownNickname)
        XCTAssertEqual(CompanionCall.caption(for: met[2]), "No hero ready to go: they can forge one to join.", "a name the player chose needs no reminder")
        XCTAssertEqual(CompanionCall.namingMessage(for: met[2]), "They played Fardock beside you. Only you see a nickname. Leave it empty to take it back.")
    }

    func testThoseAlreadyInThePartyAreNotCalledAndSixAreShown() throws {
        let many = try companions("[" + (1...9).map { #"{ "playerId": "p\#($0)", "name": "N\#($0)", "heroes": [] }"# }.joined(separator: ",") + "]")
        XCTAssertEqual(CompanionCall.absent(many, here: ["p1", "p3"]).map(\.playerId), ["p2", "p4", "p5", "p6", "p7", "p8"])
    }

    func testAServerFromBeforePeopleStillListsCompanions() throws {
        let old = try companions(#"[{ "playerId": "p2", "name": "Slagette", "lastPlayedAt": "2026-11-20T00:00:00Z" }]"#)
        XCTAssertEqual(old[0].name, "Slagette")
        XCTAssertEqual(old[0].heroes, [])
        XCTAssertFalse(old[0].listsHeroes)
        XCTAssertNil(CompanionCall.caption(for: old[0]), "nothing is known of their heroes, so nothing is said of them")
    }

    func testAnInvitationNamesThePersonAndTheHeroAskedFor() throws {
        let asked = try invitation(#"""
        { "code": "ABC123", "fromPlayerId": "p1", "fromName": "Maud", "fromPlayerName": "Justin",
          "hero": { "id": "c1", "name": "Brannoch" }, "createdAt": "", "party": ["Maud", "Ilsa"] }
        """#)
        XCTAssertEqual(asked.from, "Justin")
        XCTAssertEqual(asked.hero?.id, "c1")
        XCTAssertEqual(asked.asks, "Asks for Brannoch")
        XCTAssertEqual(asked.detail, "With Maud and Ilsa · door code ABC123")
    }

    func testAnInvitationFromAnUnnamedPersonIsFromTheirHero() throws {
        let plain = try invitation(#"{ "code": "ABC123", "fromName": "Maud", "fromPlayerName": null, "hero": null, "party": ["Maud"] }"#)
        XCTAssertEqual(plain.from, "Maud")
        XCTAssertNil(plain.hero)
        XCTAssertNil(plain.asks)
        XCTAssertEqual(plain.detail, "Door code ABC123")
        let old = try invitation(#"{ "code": "ABC123", "fromName": "Maud", "party": ["Maud", "Ilsa"] }"#)
        XCTAssertEqual(old.detail, "With Ilsa · door code ABC123", "a server from before people sends neither")
    }
}
