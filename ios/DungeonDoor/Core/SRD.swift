import Foundation

/// Turns the rules engine's SRD ids into words, and does the one sum every sheet needs.
enum SRD {
    /// The six abilities, in sheet order.
    static let abilities = ["str", "dex", "con", "int", "wis", "cha"]

    private static let abilityNames = [
        "str": "Strength", "dex": "Dexterity", "con": "Constitution",
        "int": "Intelligence", "wis": "Wisdom", "cha": "Charisma",
    ]

    /// Which ability each skill leans on, for the full skill list.
    private static let skillAbilities = [
        "acrobatics": "dex", "animal-handling": "wis", "arcana": "int", "athletics": "str",
        "deception": "cha", "history": "int", "insight": "wis", "intimidation": "cha",
        "investigation": "int", "medicine": "wis", "nature": "int", "perception": "wis",
        "performance": "cha", "persuasion": "cha", "religion": "int", "sleight-of-hand": "dex",
        "stealth": "dex", "survival": "wis",
    ]

    private static let smallWords: Set<String> = ["of", "the", "and"]

    /// "sleight-of-hand" → "Sleight of Hand", "fire-bolt" → "Fire Bolt", "chain-mail" → "Chain Mail".
    static func name(_ id: String) -> String {
        let words = id.split { $0 == "-" || $0 == "_" || $0 == " " }
        return words.enumerated().map { index, word in
            let lower = word.lowercased()
            if index > 0 && smallWords.contains(lower) { return lower }
            return lower.prefix(1).uppercased() + lower.dropFirst()
        }
        .joined(separator: " ")
    }

    /// "locked-door" → "Locked door": an id as the start of a sentence.
    static func phrase(_ id: String) -> String {
        let words = id.split { $0 == "-" || $0 == "_" || $0 == " " }.map { $0.lowercased() }.joined(separator: " ")
        return words.prefix(1).uppercased() + words.dropFirst()
    }

    /// "str" → "STR".
    static func ability(_ id: String) -> String { id.uppercased() }

    /// "str" → "Strength".
    static func abilityName(_ id: String) -> String { abilityNames[id.lowercased()] ?? name(id) }

    /// The ability a skill uses ("athletics" → "str"), when it's one of the standard eighteen.
    static func ability(forSkill id: String) -> String? { skillAbilities[id] }

    /// The modifier a score gives: floor((score − 10) / 2).
    static func modifier(_ score: Int) -> Int {
        Int((Double(score - 10) / 2).rounded(.down))
    }

    /// A bonus the way a sheet writes it: "+3", "+0", "−1".
    static func signed(_ value: Int) -> String {
        value < 0 ? "\u{2212}\(-value)" : "+\(value)"
    }

    /// A bonus the way it is said aloud: "plus 3", "minus 1".
    static func spoken(_ value: Int) -> String {
        value < 0 ? "minus \(-value)" : "plus \(value)"
    }

    /// The die a class rolls for hit points: d12 for a barbarian, d6 for a wizard, d8 for most.
    static func hitDie(forClass id: String) -> Int {
        switch id {
        case "barbarian": 12
        case "fighter", "paladin", "ranger": 10
        case "sorcerer", "wizard": 6
        default: 8
        }
    }

    private static let armorWords = ["armor", "mail", "shirt", "plate", "leather", "hide", "shield", "breastplate"]

    /// Whether an equipment id is something worn for protection ("chain-mail", "shield").
    static func isArmor(_ id: String) -> Bool {
        let lower = id.lowercased()
        return armorWords.contains { lower.contains($0) }
    }

    /// The XP a hero needs to be each level (SRD 5.2): `xpThresholds[1]` is what level 2 takes.
    static let xpThresholds = [0, 300, 900, 2_700, 6_500, 14_000, 23_000, 34_000, 48_000, 64_000, 85_000,
                               100_000, 120_000, 140_000, 165_000, 195_000, 225_000, 265_000, 305_000, 355_000]

    static var maxLevel: Int { xpThresholds.count }

    /// The XP at which a hero of `level` reaches the next one; nil at the top.
    static func xpForNextLevel(after level: Int) -> Int? {
        xpThresholds.indices.contains(level) && level >= 1 ? xpThresholds[level] : nil
    }

    /// The XP a hero of `level` started that level with.
    static func xpFloor(of level: Int) -> Int {
        xpThresholds.indices.contains(level - 1) ? xpThresholds[level - 1] : 0
    }

    /// "1st", "2nd", "3rd", "4th"… for spell levels.
    static func ordinal(_ number: Int) -> String {
        let suffix: String
        switch (number % 100, number % 10) {
        case (11...13, _): suffix = "th"
        case (_, 1): suffix = "st"
        case (_, 2): suffix = "nd"
        case (_, 3): suffix = "rd"
        default: suffix = "th"
        }
        return "\(number)\(suffix)"
    }

    /// Pounds without a pointless ".0": 166, 47.5.
    static func pounds(_ amount: Double) -> String {
        let rounded = (amount * 10).rounded() / 10
        return rounded == rounded.rounded() && abs(rounded) < 1e15 ? String(Int(rounded)) : String(format: "%.1f", rounded)
    }

    /// Coins to at most two decimals, without pointless zeros: 4, 12.5, 3.77. A share of treasure
    /// can come out as a long fraction of a gold piece.
    static func coins(_ amount: Double) -> String {
        guard amount.isFinite, abs(amount) < 1e15 else { return "0" }
        let hundredths = (amount * 100).rounded() / 100
        if hundredths == hundredths.rounded() { return String(Int(hundredths)) }
        let text = String(format: "%.2f", hundredths)
        return text.hasSuffix("0") ? String(text.dropLast()) : text
    }
}
