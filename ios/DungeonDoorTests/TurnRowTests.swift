import XCTest

final class TurnRowTests: XCTestCase {
    private func hero(_ id: String, _ name: String, hp: Int, maxHp: Int, status: String = "up",
                      conditions: [HudCondition] = []) -> HudHero {
        HudHero(id: id, name: name, hp: hp, maxHp: maxHp, status: status, conditions: conditions)
    }

    private func foe(_ id: String, _ name: String, tier: String, label: String, status: String = "up",
                     conditions: [HudCondition] = []) -> HudFoe {
        HudFoe(id: id, name: name, tier: tier, label: label, status: status, conditions: conditions)
    }

    private let asleep = HudCondition(id: "asleep", label: "Asleep", source: "Sleep", ends: "Ends with any damage")

    private var hud: CombatHud {
        CombatHud(
            party: [hero("p2", "Mira Thal", hp: 9, maxHp: 16), hero("p1", "Bryn Stonehand", hp: 0, maxHp: 20, status: "dying")],
            foes: [foe("foe-1", "Goblin Boss", tier: "hurt", label: "Hurt"),
                   foe("foe-2", "Goblin Archer", tier: "unhurt", label: "Unhurt", conditions: [asleep]),
                   foe("foe-3", "Goblin", tier: "down", label: "Dead", status: "dead")],
            order: ["foe-1", "p2", "foe-2", "p1", "foe-3"],
            now: "p2",
            next: "foe-1")
    }

    func testTheRowStartsAtWhoeverActsNowAndRunsOnInInitiativeOrder() {
        let row = TurnRow(hud: hud, me: "p2")
        XCTAssertEqual(row.upcoming.map(\.id), ["p2", "foe-2", "p1", "foe-3"])
        XCTAssertEqual(row.later.map(\.id), ["foe-1"])
    }

    func testInOrderIsInitiativeOrderFromTheTopWhereverTheTurnIs() {
        XCTAssertEqual(TurnRow(hud: hud, me: "p2").inOrder.map(\.id), ["foe-1", "p2", "foe-2", "p1", "foe-3"])
        var later = hud
        later.now = "p1"
        later.next = "foe-1"
        XCTAssertEqual(TurnRow(hud: later, me: "p2").inOrder.map(\.id), ["foe-1", "p2", "foe-2", "p1", "foe-3"])
        var over = hud
        over.now = nil
        over.next = nil
        XCTAssertEqual(TurnRow(hud: over, me: "p2").inOrder.map(\.id), ["foe-1", "p2", "foe-2", "p1", "foe-3"])
    }

    func testTheCurrentActorIsNowAndWhoeverIsUpAfterThemIsNext() {
        let rings = TurnRow(hud: hud, me: "p2").all
        XCTAssertEqual(rings.filter(\.isNow).map(\.id), ["p2"])
        XCTAssertEqual(rings.filter(\.isNext).map(\.id), ["foe-1"])
    }

    func testAHeroRingFillsWithHitPointsAndSaysThem() {
        let mira = TurnRow(hud: hud, me: "p2").all.first { $0.id == "p2" }!
        XCTAssertEqual(mira.gauge, .health(9.0 / 16.0))
        XCTAssertEqual(mira.caption, "9/16")
        XCTAssertEqual(mira.tone, .healthy)
        XCTAssertTrue(mira.isMe)
        XCTAssertTrue(mira.isHero)
    }

    func testAHeroAtHalfOrLessIsWoundedAndADownHeroIsEmptyAndOut() {
        let low = TurnRing(hero: hero("p3", "Pip", hp: 8, maxHp: 16), hud: hud, me: "p2")
        XCTAssertEqual(low.tone, .wounded)
        let bryn = TurnRow(hud: hud, me: "p2").all.first { $0.id == "p1" }!
        XCTAssertEqual(bryn.gauge, .health(0))
        XCTAssertEqual(bryn.caption, "Dying")
        XCTAssertEqual(bryn.tone, .fallen)
        XCTAssertTrue(bryn.isOut)
    }

    func testAFoeRingShowsItsTierAsSegmentsAndAWordNeverItsHitPoints() {
        let rings = TurnRow(hud: hud, me: "p2").all
        let boss = rings.first { $0.id == "foe-1" }!
        XCTAssertEqual(boss.gauge, .tier(lit: 3))
        XCTAssertEqual(boss.caption, "Hurt")
        XCTAssertEqual(boss.tone, .hurt)
        XCTAssertFalse(boss.isHero)
        XCTAssertNil(boss.points, "a foe never carries hit points")
        let archer = rings.first { $0.id == "foe-2" }!
        XCTAssertEqual(archer.gauge, .tier(lit: 4))
        XCTAssertEqual(archer.tone, .healthy)
        XCTAssertEqual(archer.conditions.map(\.label), ["Asleep"])
        let dead = rings.first { $0.id == "foe-3" }!
        XCTAssertEqual(dead.gauge, .tier(lit: 0))
        XCTAssertEqual(dead.caption, "Dead")
        XCTAssertEqual(dead.tone, .fallen)
        XCTAssertTrue(dead.isOut)
        let bloodied = TurnRing(foe: foe("foe-9", "Worg", tier: "near-death", label: "Near death"), hud: hud)
        XCTAssertEqual(bloodied.tone, .wounded)
    }

    func testVoiceOverReadsWhoTheyAreWhereTheyStandInTheTurnAndWhatHoldsThem() {
        let rings = TurnRow(hud: hud, me: "p2").all
        XCTAssertEqual(rings.first { $0.id == "p2" }!.spoken, "Mira Thal, you, acting now, 9 of 16 hit points")
        XCTAssertEqual(rings.first { $0.id == "foe-1" }!.spoken, "Goblin Boss, foe, next, Hurt")
        XCTAssertEqual(rings.first { $0.id == "foe-2" }!.spoken, "Goblin Archer, foe, Unhurt, Asleep, from Sleep, Ends with any damage")
    }

    func testAnOlderServerWithNoOrderGivesThePartyThenTheFoesWithNoOneMarked() {
        let older = CombatHud(party: hud.party, foes: hud.foes)
        let row = TurnRow(hud: older, me: "p2")
        XCTAssertEqual(row.upcoming.map(\.id), ["p2", "p1", "foe-1", "foe-2", "foe-3"])
        XCTAssertEqual(row.later, [])
        XCTAssertFalse(row.all.contains { $0.isNow || $0.isNext })
    }

    func testNextIsNotMarkedWhenItIsTheOneActingNow() {
        var alone = hud
        alone.next = "p2"
        XCTAssertFalse(TurnRow(hud: alone, me: "p2").all.contains(where: \.isNext))
    }

    func testTheRowDecodesTheServersTurnOrder() throws {
        let json = #"{"party":[],"foes":[],"order":["a","b"],"now":"b","next":"a"}"#
        let decoded = try JSONDecoder().decode(CombatHud.self, from: Data(json.utf8))
        XCTAssertEqual([decoded.order, [decoded.now, decoded.next].compactMap { $0 }], [["a", "b"], ["b", "a"]])
        let older = try JSONDecoder().decode(CombatHud.self, from: Data(#"{"party":[],"foes":[]}"#.utf8))
        XCTAssertEqual(older.order, [])
        XCTAssertNil(older.now)
    }
}
