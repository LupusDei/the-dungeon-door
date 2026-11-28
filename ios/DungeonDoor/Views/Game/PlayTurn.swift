import Foundation

/// One row of "the table offers": a plot choice. Mechanical actions stay on the sheet and the map.
struct TableOffer: Identifiable {
    let id: String
    let label: String
    let detail: String
    /// A rules line ("Athletics check, DC 12") on a letter choice. Nil on a legal action.
    let note: String?
    let available: Bool
    let reason: String?
    let kind: String
    let action: LegalAction?
    let choice: Choice?

    /// In a fight: the kind of action the card stands for ("Attack", "Cast a spell", "Dodge").
    /// Its label and detail are then only what a plain tap does. Nil for a plot choice.
    var heading: String? = nil

    static func list(in scene: GameScene) -> [TableOffer] {
        PlayTurn.cards(in: scene).map { choice in
            TableOffer(id: "choice:\(choice.id)", label: choice.label, detail: choice.detail,
                       note: choice.rules, available: true, reason: nil, kind: "choice",
                       action: nil, choice: choice, heading: choice.heading)
        }
    }

    /// The card holds the caller's pick. A weapon or spell they named for themselves is on the card
    /// of its kind; anything else of their own is on no card, and never on one that says another deed.
    func isChosen(in scene: GameScene, playerId: String) -> Bool {
        PlayTurn.declared(in: scene, playerId: playerId)?.card == id
    }

    /// What the card says under its heading: the caller's own pick when it is this kind of action,
    /// else what a plain tap of the card does. `name` is nil when the heading already says it (Dodge).
    func line(for declared: Declared?) -> (name: String?, detail: String) {
        guard let heading else { return (nil, detail) }
        let own = declared.flatMap { $0.card == id && $0.named ? $0 : nil }
        let name = PlayTurn.short(own?.title ?? label)
        let same = name.compare(heading, options: .caseInsensitive) == .orderedSame
        return (same ? nil : name, own?.context ?? detail)
    }
}

/// What a hero has declared this turn, reduced to one action and everything known about it. A tap
/// on a card, a pick from a wheel, a tap on the map and the player's own words all end up here, so
/// every part of the screen says the same thing about the turn.
struct Declared: Equatable {
    /// The action, as the hero's own list names it: "Cast Ray of Frost", "Attack with Dagger",
    /// "Dash"; a plot choice's label; or the player's words for a check of their own.
    var title: String
    /// Who it is aimed at and what it rolls: "At Goblin Minion. +5 to hit, 1d8 cold." Empty when
    /// there is nothing to add.
    var context: String = ""
    /// The player's own words that came with it. Nil when it was a tap.
    var words: String? = nil
    /// The card it belongs to (a `TableOffer` id, "choice:b"). Nil when it is none of the cards.
    var card: String? = nil
    /// An action of the hero's own (a weapon, a spell, an item, a move, a skill), named by the
    /// player, and not a plain pick of a card.
    var named = false

    /// Everything under the title, on one line: the context, then the player's words.
    var under: String {
        [context, words.map { "\u{201C}\($0)\u{201D}" } ?? ""].filter { !$0.isEmpty }.joined(separator: " ")
    }
}

/// Where a hero is in the turn the table is choosing: answered, still to answer, or unable to.
enum TurnSeat: Hashable {
    case chosen, waiting, down
}

/// What the table is asking of this hero, shared by the story, the sheet and the map.
enum PlayTurn {
    static func canSend(status: GameStatus, scene: GameScene?, busy: Bool) -> Bool {
        status == .voting && scene?.canAct == true && scene?.isFinale != true && !busy
    }

    /// The cards on the Story page: the scene's choices (`offers` on a server that sends them).
    static func cards(in scene: GameScene) -> [Choice] {
        scene.offers.isEmpty ? scene.choices : scene.offers
    }

    /// What the caller has declared this turn, as one action (see `Declared`). Nil until they choose.
    /// `playerId` is the caller: their vote in the list is read first, then what the scene says of
    /// the caller alone (`myAction`, `myVote`, `myFreeform`).
    static func declared(in scene: GameScene, playerId: String) -> Declared? {
        let vote = scene.votes.first { $0.playerId == playerId }
        let id = vote.map { $0.actionId ?? "choice:\($0.choiceId)" } ?? scene.myAction?.id ?? scene.myVote.map { "choice:\($0)" }
        guard let id else {
            // A check of the hero's own, in the player's words: there is no action to reduce it to.
            guard let written = scene.myFreeform, !written.text.isEmpty else { return nil }
            return Declared(title: written.text)
        }
        let targets = vote?.targets ?? scene.myAction?.targets ?? []
        let said = (vote?.intent ?? scene.myAction?.intent).flatMap { $0.isEmpty ? nil : $0 }
        if id.hasPrefix("choice:") {
            let letter = String(id.dropFirst("choice:".count))
            let choice = cards(in: scene).first { $0.id == letter } ?? scene.choices.first { $0.id == letter }
            // In a fight the vote carries what that hero is doing; elsewhere the choice's own label.
            let title = [vote?.label, choice?.label].compactMap { $0 }.first { !$0.isEmpty } ?? "Chosen"
            let context = [choice?.detail ?? "", choice?.rules ?? ""].filter { !$0.isEmpty }.joined(separator: " ")
            return Declared(title: title, context: context, words: said, card: id)
        }
        guard let action = scene.actions.first(where: { $0.id == id }) else {
            return Declared(title: vote?.label.flatMap { $0.isEmpty ? nil : $0 } ?? "Chosen", words: said, named: true)
        }
        // A skill's words are what the hero attempts with it; they may only be on the written check.
        let attempt = said ?? (action.kind == "skill" ? scene.myFreeform?.text : nil)
        let words = attempt.flatMap { $0.isEmpty || $0.compare(action.label, options: .caseInsensitive) == .orderedSame ? nil : $0 }
        return Declared(title: action.label, context: context(of: action, targets: targets), words: words,
                        card: card(for: action, in: scene), named: true)
    }

    /// Who an action is aimed at, then what it rolls: "At Goblin Minion. +5 to hit, 1d8 cold."
    static func context(of action: LegalAction, targets: [String]) -> String {
        var seen = Set<String>()
        let names = targets.filter { seen.insert($0).inserted }.compactMap { id in action.targets.first { $0.id == id }?.name }
        let detail = action.detail.trimmingCharacters(in: .whitespaces)
        guard !names.isEmpty else { return detail }
        // A blow or a hurled spell is at someone; a healing spell, a potion or a hand is on them.
        let at = action.kind == "attack" || (action.kind == "spell" && !detail.hasPrefix("Heals"))
        let who = "\(at ? "At" : "On") \(ListFormatter.localizedString(byJoining: names))."
        return detail.isEmpty ? who : "\(who) \(detail)"
    }

    /// The card an action of the hero's own belongs to, in a fight. The same deed under the same
    /// name is that card (Dodge from the wheel is Dodge; the very spell a plain tap casts). Else the
    /// card that stands for its kind, when the server says what the cards stand for (`heading`): an
    /// attack is the attack card and a spell the spell card, whichever weapon or spell it is. Nil
    /// for anything else, and outside a fight: a skill or an item beside the plot's choices is the
    /// hero's own, and picks none of them.
    static func card(for action: LegalAction, in scene: GameScene) -> String? {
        guard scene.combat else { return nil }
        let cards = cards(in: scene)
        if let same = cards.first(where: { $0.label.compare(action.label, options: .caseInsensitive) == .orderedSame }) {
            return "choice:\(same.id)"
        }
        let first = cards.first { $0.id == "a" }
        if action.kind == "attack" || action.id == "common:attack" { return first?.heading == nil ? nil : "choice:a" }
        // A hero with no spell to hurl is offered the same blow twice: that second card is no spell.
        if action.kind == "spell", let second = cards.first(where: { $0.id == "b" }), let heading = second.heading, heading != first?.heading {
            return "choice:b"
        }
        return nil
    }

    /// "Cast Ray of Frost" is "Ray of Frost" under a heading that already says cast.
    static func short(_ label: String) -> String {
        for lead in ["Attack with ", "Cast "] where label.hasPrefix(lead) && label.count > lead.count {
            return String(label.dropFirst(lead.count))
        }
        return label
    }

    /// The line under Act once this hero has chosen: the action, the letter, or the words they wrote.
    static func chosenLine(scene: GameScene, playerId: String) -> String? {
        declared(in: scene, playerId: playerId)?.title
    }

    /// The caller's own words, when the server counted them as a pick of one of the scene's choices:
    /// an attack written while a fight is on offer, or words that say what a choice says. The words
    /// ride with the pick as its intent. Nil after a tap on a card (no words), and for a written
    /// action that stayed the hero's own (that one is `myFreeform`).
    static func wordsCounted(in scene: GameScene, playerId: String) -> (offer: String, words: String)? {
        if let mine = scene.myAction, mine.id.hasPrefix("choice:"), let words = mine.intent, !words.isEmpty {
            return (mine.id, words)
        }
        if let vote = scene.votes.first(where: { $0.playerId == playerId }), vote.actionId == nil,
           let words = vote.intent, !words.isEmpty {
            return ("choice:\(vote.choiceId)", words)
        }
        return nil
    }

    static func roll(scene: GameScene, playerId: String) -> Int? {
        if let vote = scene.votes.first(where: { $0.playerId == playerId }) { return face(of: vote, in: scene) }
        return scene.myFreeform?.roll
    }

    /// The d20 to show beside a vote while the table is still choosing. A pick of one of the plot's
    /// choices shows none: its die only counts if that choice wins and calls for a roll, and the
    /// result screen is where it lands, with what it was for. An action of the hero's own (an
    /// attack, a spell, a skill) shows the die they threw.
    static func face(of vote: Vote, in scene: GameScene) -> Int? {
        scene.combat || vote.actionId != nil ? vote.roll : nil
    }

    /// What a hero has put into this turn: the words for it, and its d20 once the face shows. Nil
    /// until they choose. Votes and written actions name every player; the caller's own may only be
    /// on `myFreeform`, `myAction` or `myVote`.
    static func entry(of playerId: String, in scene: GameScene, me: String) -> (detail: String, roll: Int?)? {
        if let vote = scene.votes.first(where: { $0.playerId == playerId }) {
            let waiting = vote.pending ? (vote.formula.map { " · \($0)" } ?? " · d20") : ""
            return (words(vote, in: scene) + waiting, face(of: vote, in: scene))
        }
        if let written = scene.freeforms.first(where: { $0.playerId == playerId }) {
            let waiting = written.pending ? " · d20" : ""
            return (written.text + waiting, written.roll)
        }
        guard playerId == me else { return nil }
        if let written = scene.myFreeform { return (written.text, written.roll) }
        if let id = scene.myAction?.id, let action = scene.actions.first(where: { $0.id == id }) {
            return (action.label, nil)
        }
        if let id = scene.myVote, let choice = scene.choices.first(where: { $0.id == id }) {
            return (choice.label.isEmpty ? "Chosen" : choice.label, nil)
        }
        if scene.myVote != nil || scene.myAction != nil { return ("Chosen", nil) }
        return nil
    }

    /// Whether a hero has chosen this turn, has yet to, or is down. In a fight a hero who cannot
    /// take a turn is down, and the round does not wait for them. The wait panel under the story and
    /// the party's heads-up display both ask here, so they cannot disagree.
    static func seat(of playerId: String, chosen: Bool, in scene: GameScene, combat: Combat?, me: String) -> TurnSeat {
        if chosen { return .chosen }
        guard scene.combat, let combat else { return .waiting }
        if let hero = combat.combatants.first(where: { $0.id == playerId && !$0.isFoe }) {
            return hero.isUp ? .waiting : .down
        }
        if playerId == me, !scene.canAct { return .down }
        return .waiting
    }

    static func seat(of playerId: String, in scene: GameScene, combat: Combat?, me: String) -> TurnSeat {
        seat(of: playerId, chosen: entry(of: playerId, in: scene, me: me) != nil, in: scene, combat: combat, me: me)
    }

    private static func words(_ vote: Vote, in scene: GameScene) -> String {
        let base: String = {
            if let label = vote.label, !label.isEmpty { return label }
            if let actionId = vote.actionId, let action = scene.actions.first(where: { $0.id == actionId }) { return action.label }
            if let choice = scene.choices.first(where: { $0.id == vote.choiceId }), !choice.label.isEmpty { return choice.label }
            return "Chosen"
        }()
        if let intent = vote.intent, !intent.isEmpty, intent.compare(base, options: .caseInsensitive) != .orderedSame {
            return "\(base) — \(intent)"
        }
        return base
    }

    /// The move a tap on this square should send. A shorter move wins over Dash when both list the square.
    static func move(on square: GridPoint, actions: [LegalAction]) -> LegalAction? {
        let hits = actions.filter { action in
            action.kind == "move" && action.available && action.squares.contains(square)
        }
        return hits.sorted { lhs, rhs in
            if lhs.namesDash != rhs.namesDash { return !lhs.namesDash }
            return lhs.squares.count < rhs.squares.count
        }.first
    }

    /// An attack that can name this combatant. A melee blow wins while the target is inside its reach.
    static func attack(at targetId: String, feet: Int, actions: [LegalAction]) -> LegalAction? {
        let hits = actions.filter { action in
            action.kind == "attack" && action.available && action.targets.contains { $0.id == targetId }
        }
        let melee = hits.filter { $0.rangeFeet == nil }
        let reach = melee.compactMap(\.reachFeet).max() ?? (melee.isEmpty ? 0 : 5)
        if feet <= reach, let blow = melee.first { return blow }
        return hits.first { $0.rangeFeet != nil } ?? hits.first
    }

    /// A spell that can name this combatant.
    static func spell(at targetId: String, actions: [LegalAction]) -> LegalAction? {
        actions.first { action in
            action.kind == "spell" && action.available && action.targets.contains { $0.id == targetId }
        }
    }

    static func matching(_ kind: String, named name: String, id slug: String, actions: [LegalAction]) -> LegalAction? {
        let title = name.lowercased()
        let key = slug.lowercased().replacingOccurrences(of: " ", with: "-")
        return actions.first { action in
            guard action.kind == kind else { return false }
            let actionId = action.id.lowercased()
            if actionId == "\(kind):\(key)" || actionId.hasSuffix(":\(key)") || actionId.hasSuffix(key) { return true }
            return action.label.lowercased().contains(title)
        }
    }
}
