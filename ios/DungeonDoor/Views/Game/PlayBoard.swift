import SwiftUI

/// One control on the play dashboard.
///
/// `choice` is the scene choice a tap votes for, when this control stands for one. `enabled` is
/// whether a tap sends it now: the table is taking votes, the hero can act, and a choice is bound.
/// A control that is not enabled stays where it is and greys out. It is never removed between turns.
///
/// The views draw `PlayControl` and nothing else about votes. Today `PlayBoard` fills them from
/// `scene.choices`. A later legal-actions list can fill the same values and the screens stay put.
struct PlayControl: Identifiable, Equatable {
    let id: String
    let title: String
    let detail: String
    let symbol: String
    /// The vote a tap sends. Nil when nothing the table is offering sits on this control.
    let choice: Choice?
    /// False greys the control out. The choice can still be the one on show (the hero is down, the
    /// round is resolving, the vote is in flight) so the highlight does not flicker off.
    let enabled: Bool
    /// Why a tap does nothing. Empty when `enabled` is true.
    let unavailableReason: String
    /// What VoiceOver adds when a tap will vote.
    let hint: String
    /// False when this control sends a vote but should not be the one drawn as chosen. Every weapon
    /// sends the fight's one Attack vote; only the weapon the choice names lights up as that vote.
    var affirmsVote: Bool = true
}

/// A condition (or a condition-shaped note) on the caller's hero, for the vitals row.
struct PlayCondition: Equatable {
    var id: String
    var name: String
    var detail: String
    /// The hero spends an action to end it. The Break Free choice binds to that condition.
    var needsEscape: Bool = false
}

/// A spell the sheet lists, in the order the dashboard shows them.
struct PlaySpellRef: Equatable {
    var id: String
    var name: String
    /// The quiet line under the name when this spell is not the one the table is offering.
    var line: String
}

/// The controls of one screen of play: the common-actions bar, the sheet, and the scene's offers.
/// Built anew from the game on each refresh. Nothing here is stored.
struct PlayBoard: Equatable {
    var common: [PlayControl]
    var weapons: [PlayControl]
    var spells: [PlayControl]
    var items: [PlayControl]
    var features: [PlayControl]
    var conditions: [PlayControl]
    /// The scene's own choices, in order, padded to three so the panel does not shrink.
    var sceneOffers: [PlayControl]
    /// Why no tap can vote right now. Nil while the table is taking this hero's vote.
    var hold: String?

    /// The bar, in the order it is always drawn. The blurb is the action in one line.
    static let commonActions: [(id: String, title: String, symbol: String, blurb: String)] = [
        ("attack", "Attack", "burst.fill", "Strike with a weapon."),
        ("dash", "Dash", "figure.run", "Double your speed this turn."),
        ("disengage", "Disengage", "arrow.uturn.backward", "Move without provoking opportunity attacks."),
        ("dodge", "Dodge", "shield.lefthalf.filled", "Attacks against you have disadvantage."),
        ("help", "Help", "person.2.fill", "Aid an ally, or stabilize the dying."),
        ("hide", "Hide", "eye.slash", "Make a Stealth check to hide."),
        ("ready", "Ready", "clock.fill", "Prepare an action for a trigger."),
        ("use-object", "Use an Object", "hand.raised.fill", "Use an item that takes an action."),
    ]

    init(status: GameStatus, scene: GameScene?, busy: Bool, attacks: [Attack], spellList: [PlaySpellRef],
         itemList: [EquipmentItem], featureNames: [String], resources: [ResourceUse],
         conditionList: [PlayCondition], dungeon: DungeonMap?) {
        let blocked = Self.blockReason(status: status, scene: scene, busy: busy)
        let choices = scene?.choices ?? []

        func make(id: String, title: String, detail: String, symbol: String, choice: Choice?,
                  unmapped: String, affirms: Bool = true) -> PlayControl {
            let enabled = blocked == nil && choice != nil
            let reason: String
            if choice == nil {
                reason = unmapped
            } else if let blocked = blocked {
                reason = blocked
            } else {
                reason = ""
            }
            let hint = choice.map { $0.label.isEmpty ? "Votes this choice." : "Votes \($0.label)." } ?? ""
            return PlayControl(id: id, title: title, detail: detail, symbol: symbol, choice: choice,
                               enabled: enabled, unavailableReason: reason, hint: hint, affirmsVote: affirms)
        }

        common = Self.commonActions.map { action in
            let bound = scene.flatMap { Self.commonChoice(action.id, in: $0) }
            let detail = bound.map { Self.offerDetail($0, dungeon: dungeon) } ?? action.blurb
            return make(id: "common/\(action.id)", title: action.title, detail: detail, symbol: action.symbol,
                        choice: bound, unmapped: "Not offered this turn.")
        }

        let attackChoice: Choice? = scene?.combat == true ? choices.first { $0.id == "a" } : nil
        let weaponAttacks = attacks.enumerated().filter { !$0.element.isSpell }
        let attackNamesOne = attackChoice.map { choice in
            weaponAttacks.contains { Self.containsPhrase($0.element.name, in: choice.label) }
        } ?? false
        weapons = weaponAttacks.map { index, attack in
            var detail = Self.weaponDetail(attack)
            if let attackChoice, attackNamesOne, !Self.containsPhrase(attack.name, in: attackChoice.label) {
                detail += " Sends “\(attackChoice.label)”."
            }
            let unmapped = scene?.combat == true ? "No attack is offered." : "Not in a fight."
            let named = attackChoice.map { Self.containsPhrase(attack.name, in: $0.label) } ?? false
            return make(id: "weapon/\(index)", title: attack.name, detail: detail,
                        symbol: attack.ranged ? "arrow.right" : "burst.fill",
                        choice: attackChoice, unmapped: unmapped, affirms: named)
        }

        let cast = scene.flatMap(Self.castChoice)
        spells = spellList.map { spell in
            let matched = cast.flatMap { Self.spellMatches(spell.name, $0) ? $0 : nil }
            let detail = matched.map { Self.offerDetail($0, dungeon: dungeon) } ?? spell.line
            let unmapped = cast.map { "The table offers \($0.label)." }
                ?? (scene?.combat == true ? "No spell is offered this round." : "Not offered this turn.")
            return make(id: "spell/\(spell.id)", title: spell.name, detail: detail, symbol: "wand.and.stars",
                        choice: matched, unmapped: unmapped)
        }

        items = itemList.enumerated().map { index, item in
            let name = item.name.isEmpty ? SRD.name(item.id) : item.name
            // A weapon's attack is the Attacks row. The pack lights up for a choice that names the
            // item in its label ("Drink a Potion of Healing"), not for a blow that happens to.
            var bound = choices.first { Self.containsPhrase(name, in: $0.label) }
            if scene?.combat == true, bound?.id == "a" { bound = nil }
            var detail = item.count > 1 ? "×\(item.count)" : ""
            if let bound {
                let offer = Self.offerDetail(bound, dungeon: dungeon)
                detail = detail.isEmpty ? offer : "\(detail) · \(offer)"
            }
            return make(id: "item/\(index)", title: name, detail: detail, symbol: "bag.fill",
                        choice: bound, unmapped: "Nothing to use it for this turn.")
        }

        var featureControls: [PlayControl] = resources.map { resource in
            let bound = Self.choice(named: resource.name, in: choices)
            let detail = resource.left == 0 ? "Spent until a rest." : "\(resource.left) of \(resource.max) left"
            return make(id: "resource/\(resource.id)", title: resource.name, detail: detail, symbol: "star.fill",
                        choice: bound, unmapped: "Not offered this turn.")
        }
        featureControls += featureNames.enumerated().map { index, name in
            make(id: "feature/\(index)", title: name, detail: "", symbol: "star.fill",
                 choice: Self.choice(named: name, in: choices), unmapped: "Not offered this turn.")
        }
        features = featureControls

        let escape = choices.first { Self.exactOrPrefix($0, "break free") }
        conditions = conditionList.map { condition in
            let bound = escape.flatMap { Self.escapeChoice($0, for: condition, among: conditionList) }
            return make(id: "condition/\(condition.id)", title: condition.name, detail: condition.detail,
                        symbol: bound == nil ? "exclamationmark.triangle.fill" : "lock.open.fill",
                        choice: bound, unmapped: "")
        }

        hold = blocked

        let slots = max(3, choices.count)
        sceneOffers = (0..<slots).map { index in
            if index < choices.count {
                let choice = choices[index]
                return make(id: "scene/\(index)", title: choice.label.isEmpty ? "—" : choice.label,
                            detail: Self.offerDetail(choice, dungeon: dungeon), symbol: "dice.fill",
                            choice: choice, unmapped: "")
            }
            return make(id: "scene/\(index)", title: "—", detail: "No offer this scene.", symbol: "dice.fill",
                        choice: nil, unmapped: "No offer this scene.")
        }
    }

    /// Why no tap can vote, or nil when the table is taking this hero's vote.
    private static func blockReason(status: GameStatus, scene: GameScene?, busy: Bool) -> String? {
        if busy { return "Sending your vote." }
        guard let scene else { return "There is no scene yet." }
        if scene.isFinale { return "The tale is told." }
        if !scene.canAct { return "Your hero can't act this round." }
        switch status {
        case .voting: return nil
        case .resolving: return "The table is resolving the votes."
        case .preparing: return "The dungeon master is still writing."
        case .lobby: return "The adventure hasn't started."
        case .ended: return "The adventure is over."
        }
    }

    /// The common-action choice, if the scene is offering that action by name.
    ///
    /// In a fight, Attack is always choice `a` (its label is "Attack with Greatsword", not "Attack").
    /// The other seven match a label that is the action or starts with it ("Help Bryn", "Dodge").
    /// Dash, Disengage, Hide, Ready and Use an Object have no choice today, so they stay grey
    /// until a legal-actions list names them.
    private static func commonChoice(_ id: String, in scene: GameScene) -> Choice? {
        switch id {
        case "attack":
            if scene.combat { return scene.choices.first { $0.id == "a" } }
            return scene.choices.first { exactOrPrefix($0, "attack") }
        case "dash": return scene.choices.first { exactOrPrefix($0, "dash") }
        case "disengage": return scene.choices.first { exactOrPrefix($0, "disengage") }
        case "dodge": return scene.choices.first { exactOrPrefix($0, "dodge") }
        case "help": return scene.choices.first { exactOrPrefix($0, "help") }
        case "hide": return scene.choices.first { exactOrPrefix($0, "hide") }
        case "ready": return scene.choices.first { exactOrPrefix($0, "ready") }
        case "use-object":
            return scene.choices.first {
                exactOrPrefix($0, "use an object") || normalized($0.label).hasPrefix("drink")
            }
        default: return nil
        }
    }

    /// Choice `b` when it is a spell, not a copy of Attack for a hero with nothing to cast.
    /// Outside a fight, a choice labelled "Cast …".
    private static func castChoice(in scene: GameScene) -> Choice? {
        if scene.combat {
            guard let cast = scene.choices.first(where: { $0.id == "b" }) else { return nil }
            if let attack = scene.choices.first(where: { $0.id == "a" }),
               cast.label == attack.label, cast.detail == attack.detail {
                return nil
            }
            return cast
        }
        return scene.choices.first { normalized($0.label).hasPrefix("cast ") }
    }

    private static func spellMatches(_ name: String, _ choice: Choice) -> Bool {
        let label = normalized(choice.label)
        let called = name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !called.isEmpty else { return false }
        if label == "cast \(called)" { return true }
        return label.hasPrefix("cast ") && containsPhrase(name, in: choice.label)
    }

    /// A choice whose label names this feature or resource, as a whole phrase.
    private static func choice(named name: String, in choices: [Choice]) -> Choice? {
        choices.first { containsPhrase(name, in: $0.label) }
    }

    /// Break Free binds to the condition it names, or to the one escape condition when it names none.
    private static func escapeChoice(_ choice: Choice, for condition: PlayCondition, among all: [PlayCondition]) -> Choice? {
        let named = all.filter { containsPhrase($0.name, in: choice.label) || containsPhrase($0.name, in: choice.detail) }
        if named.contains(where: { $0.id == condition.id }) { return choice }
        if named.isEmpty {
            let escaping = all.filter(\.needsEscape)
            if escaping.count == 1, escaping[0].id == condition.id { return choice }
        }
        return nil
    }

    private static func offerDetail(_ choice: Choice, dungeon: DungeonMap?) -> String {
        let rule = RuleTag(label: choice.rules, dungeon: dungeon)?.text
        return [choice.detail, rule].filter { !$0.isEmpty }.joined(separator: " · ")
    }

    private static func weaponDetail(_ attack: Attack) -> String {
        if let save = attack.save, !save.isEmpty {
            return "\(attack.damage) · \(SRD.abilityName(save)) save"
        }
        if attack.neverMisses { return "\(attack.damage) · always hits" }
        let reach = attack.ranged ? "Ranged" : "Melee"
        return "\(SRD.signed(attack.bonus)) to hit · \(attack.damage) · \(reach)"
    }

    /// The label, trimmed and lowercased, for "Dodge" and "dodge the trap" alike.
    private static func normalized(_ label: String) -> String {
        label.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    /// The label is the word, or the word and more ("Help Bryn"). "Helpful" does not count.
    private static func exactOrPrefix(_ choice: Choice, _ word: String) -> Bool {
        let label = normalized(choice.label)
        return label == word || label.hasPrefix(word + " ")
    }

    /// `phrase` as a whole phrase in `text`, so "Bow" does not match "Longbow".
    private static func containsPhrase(_ phrase: String, in text: String) -> Bool {
        let phrase = phrase.trimmingCharacters(in: .whitespacesAndNewlines)
        guard phrase.count >= 3, !text.isEmpty else { return false }
        let pattern = "\\b\(NSRegularExpression.escapedPattern(for: phrase))\\b"
        return text.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil
    }
}
