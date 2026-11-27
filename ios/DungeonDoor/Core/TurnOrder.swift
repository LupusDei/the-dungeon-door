import Foundation

/// One ring in the combat HUD's row (rules.combat.hud, docs/api.md): a hero ringed by their hit
/// points, or a foe by its tier, and where they stand in the turn. No SwiftUI here, so the unit
/// tests can build it alone.
struct TurnRing: Identifiable, Equatable {
    /// The ring's colour, named for what it means: the view picks the paint.
    enum Tone: Equatable {
        case healthy, hurt, wounded, fallen
    }

    enum Gauge: Equatable {
        /// A hero: how full the ring is, 0 to 1.
        case health(Double)
        /// A foe: how many of the four segments are lit, four unhurt to none down. Never a hit point.
        case tier(lit: Int)
    }

    /// A hero's exact hit points. A foe has none: the server never sends them.
    struct Points: Equatable {
        let hp: Int
        let maxHp: Int
    }

    let id: String
    let name: String
    let points: Points?
    let isHero: Bool
    let isMe: Bool
    let gauge: Gauge
    let tone: Tone
    /// Under the ring: "9/16" for a standing hero, else "Dying", "Down" or "Dead"; a foe's tier word.
    let caption: String
    let isNow: Bool
    let isNext: Bool
    /// Out of the fight for now (a hero down, a foe dead): drawn dimmed.
    let isOut: Bool
    let conditions: [HudCondition]

    static let segments = HudFoe.pips

    /// "Mira" from "Mira Thal": the ring is narrow. A foe keeps its whole name ("Goblin Archer 2").
    var shortName: String {
        guard isHero else { return name }
        return name.split(separator: " ").first.map(String.init) ?? name
    }

    var initials: String {
        let letters = name.split(separator: " ").compactMap(\.first)
        let text = String(letters.prefix(2)).uppercased()
        return text.isEmpty ? "?" : text
    }

    /// "Mira Thal, you, acting now, 9 of 16 hit points, Concentrating on Sleep".
    var spoken: String {
        var parts = [name, isMe ? "you" : (isHero ? "hero" : "foe")]
        if isNow { parts.append("acting now") }
        if isNext { parts.append("next") }
        if let points, !isOut {
            parts.append("\(points.hp) of \(points.maxHp) hit points")
        } else {
            parts.append(caption)
        }
        return (parts + conditions.map(\.spoken)).joined(separator: ", ")
    }
}

extension TurnRing {
    init(hero: HudHero, hud: CombatHud, me: String) {
        let maxHp = max(hero.maxHp, 1)
        id = hero.id
        name = hero.name
        points = Points(hp: hero.hp, maxHp: hero.maxHp)
        isHero = true
        isMe = hero.id == me
        gauge = .health(hero.isUp ? min(1, max(0, Double(hero.hp) / Double(maxHp))) : 0)
        tone = !hero.isUp ? .fallen : (hero.hp * 2 <= maxHp ? .wounded : .healthy)
        caption = hero.isUp ? "\(hero.hp)/\(hero.maxHp)" : Self.statusWord(hero.status)
        isNow = hud.now == hero.id
        isNext = hud.next == hero.id && hud.now != hero.id
        isOut = !hero.isUp
        conditions = hero.conditions
    }

    init(foe: HudFoe, hud: CombatHud) {
        id = foe.id
        name = foe.name
        points = nil
        isHero = false
        isMe = false
        gauge = .tier(lit: foe.isDead ? 0 : foe.pipsLit)
        switch foe.isDead ? "down" : foe.tier {
        case "unhurt": tone = .healthy
        case "hurt": tone = .hurt
        case "down": tone = .fallen
        default: tone = .wounded
        }
        caption = foe.label
        isNow = hud.now == foe.id
        isNext = hud.next == foe.id && hud.now != foe.id
        isOut = foe.isDead
        conditions = foe.conditions
    }

    private static func statusWord(_ status: String) -> String {
        switch status {
        case "dead": "Dead"
        case "dying": "Dying"
        case "stable": "Down"
        default: SRD.name(status)
        }
    }
}

/// The HUD's row: everyone in initiative order, starting from whoever acts now and running to the
/// end of the order, then those before them, who come up again in the next round.
struct TurnRow: Equatable {
    let upcoming: [TurnRing]
    let later: [TurnRing]

    var all: [TurnRing] { upcoming + later }

    init(hud: CombatHud, me: String) {
        var heroes: [String: HudHero] = [:]
        for hero in hud.party { heroes[hero.id] = hero }
        var foes: [String: HudFoe] = [:]
        for foe in hud.foes { foes[foe.id] = foe }
        // A server before the turn order sent each side in initiative order but not the two together.
        let ids = hud.order.isEmpty ? hud.party.map(\.id) + hud.foes.map(\.id) : hud.order
        let rings: [TurnRing] = ids.compactMap { id in
            if let hero = heroes[id] { return TurnRing(hero: hero, hud: hud, me: me) }
            if let foe = foes[id] { return TurnRing(foe: foe, hud: hud) }
            return nil
        }
        if let now = hud.now, let at = rings.firstIndex(where: { $0.id == now }) {
            upcoming = Array(rings[at...])
            later = Array(rings[..<at])
        } else {
            upcoming = rings
            later = []
        }
    }
}

extension TurnRow {
    /// Everyone in initiative order from the top, wherever the turn has got to: a place in this
    /// list does not move as the turn does. The heads-up display's card seats its chips by it.
    var inOrder: [TurnRing] { later + upcoming }
}

extension HudCondition {
    /// "Asleep, from Sleep", "Concentrating on Sleep", "Poisoned, 10 minutes".
    var spoken: String {
        var text = label
        if let source {
            text += id == "concentrating" ? " on \(source)" : ", from \(source)"
        }
        if let ends { text += ", \(ends)" }
        return text
    }
}
