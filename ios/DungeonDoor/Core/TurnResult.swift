import Foundation

/// One resolved turn as the server's engine settled it (docs/api.md, `TurnResult`): the plot choice
/// the party went with, what every hero did, and every d20 that counted, under the hero it was
/// rolled for. The result screen is drawn from this and nothing else, so a die the table sees is a
/// die that decided something. No SwiftUI here: the unit tests build it alone.
struct TurnResult: Codable, Hashable {
    let sceneIndex: Int
    /// A round of a fight: each hero took their own action, and there is no `choice`.
    var combat = false
    /// Nil in a fight, and when nobody picked a choice (every hero wrote their own action).
    var choice: TurnChoice? = nil
    /// Everyone at the table, in joining order.
    var heroes: [TurnHero] = []
    /// What else the turn did, in the engine's words ("The Wolf, Giant Rat let the party be.").
    var notes: [String] = []

    enum CodingKeys: String, CodingKey { case sceneIndex, combat, choice, heroes, notes }
}

extension TurnResult {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        sceneIndex = try c.whole(.sceneIndex)
        combat = try c.value(.combat, or: false)
        choice = try? c.decode(TurnChoice.self, forKey: .choice)
        // A hero the app cannot read is dropped; the rest of the turn still shows.
        heroes = ((try? c.decode([Lossy<TurnHero>].self, forKey: .heroes)) ?? []).compactMap(\.value)
        notes = (try? c.decode([String].self, forKey: .notes)) ?? []
    }
}

/// A list member that may fail to decode without taking the list with it.
private struct Lossy<Value: Decodable>: Decodable {
    let value: Value?
    init(from decoder: Decoder) throws { value = try? Value(from: decoder) }
}

struct TurnChoice: Codable, Hashable {
    let id: String
    let label: String
    /// "Persuasion check, DC 10, one hero with help". Nil for a choice with nothing to roll.
    var rules: String? = nil
    /// The players who picked it.
    var backers: [String] = []
    /// Picks per choice. A written action is not a pick.
    var tally: [String: Int] = [:]
    var tie: Tie? = nil
    /// Its check or save. Nil when it needed no roll.
    var success: Bool? = nil

    /// The picks were level: the choice whose backer threw the highest d20 won.
    struct Tie: Codable, Hashable {
        var between: [String] = []
        let playerId: String
        let roll: Int

        enum CodingKeys: String, CodingKey { case between, playerId, roll }

        init(between: [String] = [], playerId: String, roll: Int) {
            self.between = between
            self.playerId = playerId
            self.roll = roll
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            between = (try? c.decode([String].self, forKey: .between)) ?? []
            playerId = try c.decode(String.self, forKey: .playerId)
            roll = try c.whole(.roll)
        }
    }

    enum CodingKeys: String, CodingKey { case id, label, rules, backers, tally, tie, success }
}

extension TurnChoice {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        label = try c.value(.label, or: "")
        rules = try? c.decodeIfPresent(String.self, forKey: .rules)
        backers = (try? c.decode([String].self, forKey: .backers)) ?? []
        tally = (try? c.decode([String: Int].self, forKey: .tally)) ?? [:]
        tie = try? c.decode(Tie.self, forKey: .tie)
        success = try? c.decodeIfPresent(Bool.self, forKey: .success)
    }
}

struct TurnHero: Codable, Hashable, Identifiable {
    /// What a hero did with the turn.
    enum Deed: String {
        /// Picked one of the plot choices.
        case choice
        /// Wrote their own action, or used a skill or an ability.
        case own
        /// A combat action.
        case action
        /// Did not act.
        case nothing
        /// Could not act: at 0 hit points, or dead.
        case down
    }

    let playerId: String
    let name: String
    /// A `Deed`'s raw value. One the app does not know reads as having done nothing.
    var did: String = Deed.nothing.rawValue
    var choiceId: String? = nil
    /// The choice's label, the combat action, or the check's name.
    var label: String? = nil
    /// The words they wrote, when they wrote any.
    var text: String? = nil
    /// Their d20 was left to the clock: the server threw it, and their XP for the turn is halved.
    var byClock = false
    /// The d20s rolled for this hero this turn, in the order rolled. Often empty.
    var rolls: [TurnRoll] = []
    /// The engine's own lines that begin with this hero's name.
    var lines: [String] = []
    /// What they earned this turn and why. Nil when they earned nothing, and on a server from
    /// before experience from actions.
    var xp: TurnXp? = nil

    var id: String { playerId }
    var deed: Deed { Deed(rawValue: did) ?? .nothing }

    enum CodingKeys: String, CodingKey { case playerId, name, did, choiceId, label, text, byClock, rolls, lines, xp }
}

/// What a hero earned in a turn, and why (docs/api.md, `TurnResult.heroes[].xp`): each reason in
/// the dice log's words, and for the reason their d20 earned, the chance its result had.
struct TurnXp: Codable, Hashable {
    struct Reason: Codable, Hashable {
        /// "took-part", "long-shot", "trap"… A later server may send one the app has not seen: the
        /// label is what is shown.
        var reason = ""
        /// "a long shot that landed".
        var label = ""
        var xp = 0

        init(reason: String, label: String, xp: Int) {
            self.reason = reason
            self.label = label
            self.xp = xp
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            reason = try c.value(.reason, or: "")
            label = try c.value(.label, or: "")
            xp = (try? c.whole(.xp)) ?? 0
        }
    }

    var total = 0
    /// Their die was left to the clock: every amount here is already halved.
    var idle = false
    var reasons: [Reason] = []
    /// From 0 to 1: the chance, before the roll, of the result their d20 was paid for. Nil when no
    /// d20 decided what they earned (a pick that rolled nothing, Dodge, a potion).
    var chance: Double? = nil

    init(total: Int, idle: Bool = false, reasons: [Reason], chance: Double? = nil) {
        self.total = total
        self.idle = idle
        self.reasons = reasons
        self.chance = chance
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        total = (try? c.whole(.total)) ?? 0
        idle = try c.value(.idle, or: false)
        reasons = (try? c.decode([Reason].self, forKey: .reasons)) ?? []
        chance = try? c.decodeIfPresent(Double.self, forKey: .chance)
    }

    /// The reasons a d20 earns, by the chance its result had. `chance` belongs to whichever is here.
    private static let rolled: Set<String> = ["sure-thing", "success", "against-odds", "long-shot", "brave-failure", "hard-lesson", "sure-slip"]
    /// The results that were not the likely one.
    private static let surprises: Set<String> = ["against-odds", "long-shot", "hard-lesson", "sure-slip"]

    /// The most telling first: the largest amounts, and for equal amounts what the hero did before
    /// what everyone gets for taking part.
    var told: [Reason] {
        reasons.enumerated().sorted { a, b in
            if a.element.xp != b.element.xp { return a.element.xp > b.element.xp }
            let (first, second) = (a.element.reason == "took-part", b.element.reason == "took-part")
            return first != second ? second : a.offset < b.offset
        }.map(\.element)
    }

    /// The reason that says most about the turn: "a long shot that landed".
    var headline: String { told.first?.label ?? "" }

    /// The award was for a result that was not the likely one.
    var surprising: Bool { reasons.contains { Self.surprises.contains($0.reason) } }

    /// "+45 XP".
    var amount: String { "+\(total) XP" }

    /// "a 10% chance", "it could not fail": how likely the result their d20 was paid for had been.
    var odds: String? {
        guard let chance, chance > 0 else { return nil }
        if chance >= 0.995 { return "it could not fail" }
        return "a \(max(1, Int((chance * 100).rounded())))% chance"
    }

    /// Why, in full: "a long shot that landed (+40, a 10% chance), taking part (+5)". One reason
    /// needs no amount of its own: "in the fight", "a hard lesson (a 25% chance)".
    var why: String {
        let alone = reasons.count == 1
        return told.map { reason in
            let chance = Self.rolled.contains(reason.reason) ? odds : nil
            let notes = [alone ? nil : "+\(reason.xp)", chance].compactMap { $0 }
            return notes.isEmpty ? reason.label : "\(reason.label) (\(notes.joined(separator: ", ")))"
        }.joined(separator: ", ")
    }

    /// "+45 XP · a long shot that landed (+40, a 10% chance), taking part (+5)".
    var line: String { why.isEmpty ? amount : "\(amount) · \(why)" }

    /// The same for VoiceOver: "45 XP: a long shot that landed, 40, a 10% chance; taking part, 5".
    var spoken: String {
        let alone = reasons.count == 1
        let parts = told.map { reason -> String in
            let chance = Self.rolled.contains(reason.reason) ? odds : nil
            return ([reason.label] + [alone ? nil : "\(reason.xp)", chance].compactMap { $0 }).joined(separator: ", ")
        }
        return parts.isEmpty ? "\(total) XP" : "\(total) XP: \(parts.joined(separator: "; "))"
    }
}

extension TurnHero {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        playerId = try c.decode(String.self, forKey: .playerId)
        name = try c.value(.name, or: "A hero")
        did = try c.value(.did, or: Deed.nothing.rawValue)
        choiceId = try? c.decodeIfPresent(String.self, forKey: .choiceId)
        label = try? c.decodeIfPresent(String.self, forKey: .label)
        text = try? c.decodeIfPresent(String.self, forKey: .text)
        byClock = try c.value(.byClock, or: false)
        rolls = ((try? c.decode([Lossy<TurnRoll>].self, forKey: .rolls)) ?? []).compactMap(\.value)
        lines = (try? c.decode([String].self, forKey: .lines)) ?? []
        // Null, absent or unreadable: nothing is shown, and the rest of the hero still is.
        xp = (try? c.decodeIfPresent(TurnXp.self, forKey: .xp)).flatMap { $0 }.flatMap { $0.total > 0 ? $0 : nil }
    }
}

struct TurnRoll: Codable, Hashable {
    struct Against: Codable, Hashable {
        /// "dc" or "ac".
        var kind: String = "dc"
        let value: Int

        enum CodingKeys: String, CodingKey { case kind, value }

        init(kind: String = "dc", value: Int) {
            self.kind = kind
            self.value = value
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            kind = try c.value(.kind, or: "dc")
            value = try c.whole(.value)
        }
    }

    /// "choice": the party's choice. "own": the hero's own action. "attack": an attack in a fight.
    var purpose: String = "own"
    /// "Persuasion", "Dexterity", "Shortbow".
    let name: String
    /// The face that counted.
    let natural: Int
    /// Both faces under Advantage or Disadvantage; else the one.
    var dice: [Int] = []
    /// "normal", "advantage" or "disadvantage".
    var mode: String = "normal"
    var bonus = 0
    let total: Int
    let against: Against
    let success: Bool
    /// The table rolled this die for the hero (a group check they did not pick, a save).
    var fresh = false
    /// The heroes whose Help gave Advantage.
    var helpers: [String] = []
    /// What a success did beyond passing: "Improvised damage 2 slashing", "critical hit for 19".
    var detail: String? = nil

    enum CodingKeys: String, CodingKey {
        case purpose = "for"
        case name, natural, dice, mode, bonus, total, against, success, fresh, helpers, detail
    }
}

extension TurnRoll {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        purpose = try c.value(.purpose, or: "own")
        name = try c.value(.name, or: "d20")
        natural = try c.whole(.natural)
        dice = (try? c.decode([Int].self, forKey: .dice)) ?? []
        mode = try c.value(.mode, or: "normal")
        bonus = try c.whole(.bonus, or: 0)
        total = try c.whole(.total)
        against = try c.decode(Against.self, forKey: .against)
        success = try c.decode(Bool.self, forKey: .success)
        fresh = try c.value(.fresh, or: false)
        helpers = (try? c.decode([String].self, forKey: .helpers)) ?? []
        detail = try? c.decodeIfPresent(String.self, forKey: .detail)
    }

    /// "17 + 1 = 18", "9 − 1 = 8", or just "14" with no bonus.
    var sum: String {
        if bonus == 0 { return "\(natural)" }
        return "\(natural) \(bonus < 0 ? "−" : "+") \(abs(bonus)) = \(total)"
    }

    /// "DC 15", "AC 12".
    var target: String { "\(against.kind == "ac" ? "AC" : "DC") \(against.value)" }

    /// "Advantage: 17, not 4", when two dice were thrown.
    var twoDice: String? {
        guard mode != "normal", dice.count == 2 else { return nil }
        let other = dice[0] == natural ? dice[1] : dice[0]
        return "\(mode == "advantage" ? "Advantage" : "Disadvantage"): \(natural), not \(other)"
    }

    /// "Succeeded" and "Failed" for a check; "Hit" and "Missed" for an attack.
    var verdict: String {
        if purpose == "attack" { return success ? "Hit" : "Missed" }
        return success ? "Succeeded" : "Failed"
    }

    /// "Persuasion 17 plus 1 is 18 against DC 15: succeeded", for VoiceOver.
    var spoken: String {
        var text = "\(name), rolled \(natural)"
        if bonus != 0 { text += " \(bonus < 0 ? "minus" : "plus") \(abs(bonus)), \(total)" }
        text += " against \(against.kind == "ac" ? "armour class" : "difficulty") \(against.value): \(verdict.lowercased())"
        if let detail, !detail.isEmpty { text += ", \(detail)" }
        return text
    }
}

// MARK: - What the result screen says

extension TurnResult {
    /// The words over the result: what kind of turn it was.
    var headline: String {
        if combat { return "The round" }
        return choice == nil ? "Each hero went their own way" : "The party chose"
    }

    /// How the choice was picked, in a sentence or two: "Everyone picked it.", "Picked by Fardock.
    /// Slagette and Rastigar acted on their own.", or whose d20 broke a tie.
    func pickLine() -> String? {
        guard let choice else {
            guard !combat else { return nil }
            return "Nobody picked one of the choices, so the scene did not turn on one."
        }
        if let tie = choice.tie {
            let who = heroes.first { $0.playerId == tie.playerId }?.name ?? "The highest die"
            return "The picks were level, so the highest d20 decided: \(who)'s \(tie.roll)."
        }
        let backers = heroes.filter { choice.backers.contains($0.playerId) }
        let others = heroes.filter { !choice.backers.contains($0.playerId) }
        let elsewhere = others.filter { $0.choiceId != nil && $0.deed != .own }
        let own = others.filter { $0.deed == .own }
        var parts: [String] = []
        if others.isEmpty, backers.count > 1 {
            parts.append("Everyone picked it.")
        } else if !backers.isEmpty {
            parts.append("Picked by \(Self.listed(backers.map(\.name))).")
        }
        if !elsewhere.isEmpty { parts.append("\(Self.listed(elsewhere.map(\.name))) picked another.") }
        if !own.isEmpty { parts.append("\(Self.listed(own.map(\.name))) acted on their own.") }
        return parts.isEmpty ? nil : parts.joined(separator: " ")
    }

    /// "Bryn", "Bryn and Mira", "Bryn, Mira and Dax".
    static func listed(_ names: [String]) -> String {
        guard names.count > 1 else { return names.first ?? "" }
        return names.dropLast().joined(separator: ", ") + " and " + names[names.count - 1]
    }

    /// The party's choice came good, failed, or had nothing to roll.
    var verdict: String? {
        guard let success = choice?.success else { return nil }
        return success ? "Succeeded" : "Failed"
    }
}

extension TurnResult {
    /// The heroes in the order the screen names them: whoever rolled for the party's choice first,
    /// then the others as they joined.
    var inOrder: [TurnHero] {
        let deciding = heroes.filter { hero in hero.rolls.contains { $0.purpose == "choice" } }
        return deciding + heroes.filter { hero in !deciding.contains { $0.playerId == hero.playerId } }
    }

    /// Every d20 on the screen.
    var rollCount: Int { heroes.reduce(0) { $0 + $1.rolls.count } }

    /// How many dice come before this hero's own, in screen order.
    func rollsBefore(_ hero: TurnHero) -> Int {
        var count = 0
        for other in inOrder {
            if other.playerId == hero.playerId { break }
            count += other.rolls.count
        }
        return count
    }
}

extension TurnHero {
    /// What they did, in a few words: the choice they picked, their own words in quotes, their
    /// combat action, or why there is nothing.
    var deedLine: String {
        switch deed {
        case .choice:
            // Words beside a pick: typed and counted as this choice (an attack, for the fight), or sent with it.
            let picked = "Picked: \(label ?? "a choice")"
            if let text, !text.isEmpty { return "\(picked) (“\(text)”)" }
            return picked
        case .own:
            if let text, !text.isEmpty { return "“\(text)”" }
            return label ?? "Their own action"
        case .action:
            if let text, !text.isEmpty, let label, !label.isEmpty { return "\(label): “\(text)”" }
            return label ?? "Acted"
        case .nothing:
            return "Did not act"
        case .down:
            return "Down: could not act"
        }
    }

    /// The engine's lines about this hero that no die on the screen already tells: a move, a spell,
    /// a lantern lit.
    var plainLines: [String] {
        guard !rolls.isEmpty else { return lines }
        return lines.filter { line in !line.contains(" vs AC ") && !line.contains(" vs DC ") }
    }
}

extension TurnResult {
    /// What else the turn did: the engine's lines that are not under one of the heroes.
    var otherNotes: [String] {
        let told = Set(heroes.flatMap(\.lines))
        return notes.filter { !told.contains($0) }
    }
}

// MARK: - The turn in a few lines (a streamlined game)

/// One line of a turn told briefly: a d20 that counted, or what a hero did that had no die.
struct TurnBriefLine: Hashable, Identifiable {
    let id: String
    let hero: String
    /// "Stealth 14 + 2 = 16 vs DC 10", "casts Sacred Flame: the wasp takes 5 radiant.", "“I watch the trees”".
    let text: String
    /// "Succeeded", "Failed", "Hit" or "Missed". Nil where there was no die.
    var verdict: String? = nil
    var success: Bool? = nil
    /// What a success did beyond passing ("critical hit for 19").
    var detail: String? = nil

    /// "Maud Ashdown: Stealth 14 plus 2 is 16 against DC 10, succeeded", for VoiceOver.
    var spoken: String {
        [hero.isEmpty ? text : "\(hero): \(text)", verdict?.lowercased() ?? "", detail ?? ""]
            .filter { !$0.isEmpty }.joined(separator: ", ")
    }
}

extension TurnResult {
    /// What a streamlined game's Story page puts over the turn just played: the choice the party
    /// went with, or what kind of turn it was.
    var briefTitle: String { choice.map(\.label).flatMap { $0.isEmpty ? nil : $0 } ?? headline }

    /// The turn in as few lines as say it: one for each d20 that counted, in the order the result
    /// screen lands them, and one for a hero whose deed had no die (a spell that asks a save, words
    /// of their own, being down). A hero who only picked a choice has no line: the title is the choice.
    var briefLines: [TurnBriefLine] {
        inOrder.flatMap { hero -> [TurnBriefLine] in
            if !hero.rolls.isEmpty {
                return hero.rolls.enumerated().map { index, roll in
                    TurnBriefLine(id: "\(hero.playerId)-\(index)", hero: hero.name,
                                  text: "\(roll.name) \(roll.sum) vs \(roll.target)",
                                  verdict: roll.verdict, success: roll.success, detail: roll.detail)
                }
            }
            switch hero.deed {
            case .action:
                // The engine's own lines say what the action did; each begins with the hero's name.
                let told = hero.lines.enumerated().map { index, line in
                    TurnBriefLine(id: "\(hero.playerId)-line\(index)", hero: hero.name, text: Self.without(hero.name, in: line))
                }
                return told.isEmpty ? [TurnBriefLine(id: hero.playerId, hero: hero.name, text: hero.deedLine)] : told
            case .own:
                return [TurnBriefLine(id: hero.playerId, hero: hero.name, text: hero.deedLine)]
            case .down:
                return [TurnBriefLine(id: hero.playerId, hero: hero.name, text: "Down")]
            case .choice, .nothing:
                return []
            }
        }
    }

    /// What the turn changed, beyond the dice above: the engine's other lines.
    var briefChanges: [String] { otherNotes }

    /// What the heroes earned, on one line, for a streamlined page: "Nillort +45 XP (a long shot
    /// that landed), Slagariel +5 XP". When everyone earned the same for the same reason it is said
    /// once: "+5 XP each for taking part". Nil when nobody earned, and on a server that sends none.
    var briefXp: String? {
        let earned = inOrder.compactMap { hero in hero.xp.map { (hero.name, $0) } }
        guard let first = earned.first else { return nil }
        let same = earned.allSatisfy { $0.1.total == first.1.total && $0.1.headline == first.1.headline && $0.1.reasons.count == 1 }
        if earned.count > 1, same { return "\(first.1.amount) each for \(first.1.headline)" }
        return earned.map { name, xp in
            // What everyone gets for showing up needs no telling beside a name; what the hero did does.
            let plain = xp.reasons.count == 1 && xp.reasons[0].reason == "took-part"
            return plain || xp.headline.isEmpty ? "\(name) \(xp.amount)" : "\(name) \(xp.amount) (\(xp.headline))"
        }.joined(separator: ", ")
    }

    /// "Maud moves to engage the wasp." under Maud's name reads "moves to engage the wasp."
    private static func without(_ name: String, in line: String) -> String {
        guard !name.isEmpty, line.hasPrefix(name + " ") else { return line }
        return String(line.dropFirst(name.count + 1))
    }
}
