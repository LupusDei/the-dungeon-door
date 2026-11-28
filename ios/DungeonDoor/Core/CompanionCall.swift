import Foundation

/// What the lobby says of a companion (docs/api.md, Companion). Words only, so the tests can read them.
enum CompanionCall {
    /// The companions who can be called: everyone not in the party already, the first six.
    static func absent(_ companions: [Companion], here: Set<String>) -> [Companion] {
        Array(companions.filter { !here.contains($0.playerId) }.prefix(6))
    }

    /// The small line under a person's name. A name they gave themselves may not be one the player
    /// knows them by, so it says who they played. With nobody to bring, it says so: the person can
    /// still be invited. Nil when the name and the heroes say enough.
    static func caption(for companion: Companion) -> String? {
        var parts: [String] = []
        if companion.namedBy == "them", !companion.playedAs.isEmpty { parts.append("Played \(companion.playedAs) beside you") }
        if companion.listsHeroes, companion.heroes.isEmpty { parts.append("No hero ready to go: they can forge one to join") }
        return parts.isEmpty ? nil : parts.joined(separator: ". ") + "."
    }

    /// "Fighter 3": a hero's class and level, as a chip has room for.
    static func heroLine(_ hero: Companion.Hero, className: String) -> String {
        "\(className) \(hero.level)"
    }

    /// What VoiceOver says of a hero's chip.
    static func heroLabel(_ hero: Companion.Hero, className: String, asked: Bool) -> String {
        "\(asked ? "Asked for" : "Ask for") \(hero.name), \(className), level \(hero.level)"
    }

    /// What giving a nickname explains: who they are, that it is the player's alone, and that it
    /// does not replace a name they gave themselves.
    static func namingMessage(for companion: Companion) -> String {
        let who = companion.playedAs.isEmpty ? "" : "They played \(companion.playedAs) beside you. "
        let theirs = companion.namedBy == "them" ? " Their own name, \(companion.name), stays their name." : ""
        return "\(who)Only you see a nickname.\(theirs) Leave it empty to take it back."
    }
}
