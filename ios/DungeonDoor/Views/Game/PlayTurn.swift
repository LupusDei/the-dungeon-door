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

    static func list(in scene: GameScene) -> [TableOffer] {
        let choices = scene.offers.isEmpty ? scene.choices : scene.offers
        return choices.map { choice in
            TableOffer(id: "choice:\(choice.id)", label: choice.label, detail: choice.detail,
                       note: choice.rules, available: true, reason: nil, kind: "choice",
                       action: nil, choice: choice)
        }
    }

    func isChosen(in scene: GameScene, playerId: String) -> Bool {
        if let mine = scene.myAction?.id, mine == id { return true }
        if let vote = scene.votes.first(where: { $0.playerId == playerId }) {
            if let actionId = vote.actionId, actionId == id { return true }
            if choice?.id == vote.choiceId { return true }
            if id == "choice:\(vote.choiceId)" { return true }
        }
        if let letter = scene.myVote {
            if choice?.id == letter || id == "choice:\(letter)" { return true }
        }
        return false
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

    /// The line under Act once this hero has chosen: the action, the letter, or the words they wrote.
    static func chosenLine(scene: GameScene, playerId: String) -> String? {
        if let mine = scene.myAction, let action = scene.actions.first(where: { $0.id == mine.id }) {
            let extra = mine.intent ?? (action.kind == "skill" ? scene.myFreeform?.text : nil)
            if let extra, !extra.isEmpty, extra.compare(action.label, options: .caseInsensitive) != .orderedSame {
                return "\(action.label) — \(extra)"
            }
            return action.label
        }
        if let vote = scene.votes.first(where: { $0.playerId == playerId }) {
            if let label = vote.label, !label.isEmpty { return label }
            if let actionId = vote.actionId, let action = scene.actions.first(where: { $0.id == actionId }) {
                return action.label
            }
            if let choice = scene.choices.first(where: { $0.id == vote.choiceId }), !choice.label.isEmpty {
                return choice.label
            }
            return "Chosen"
        }
        if let written = scene.myFreeform, !written.text.isEmpty { return written.text }
        return nil
    }

    static func roll(scene: GameScene, playerId: String) -> Int? {
        if let vote = scene.votes.first(where: { $0.playerId == playerId }) { return vote.roll }
        return scene.myFreeform?.roll
    }

    /// What a hero has put into this turn: the words for it, and its d20 once the face shows. Nil
    /// until they choose. Votes and written actions name every player; the caller's own may only be
    /// on `myFreeform`, `myAction` or `myVote`.
    static func entry(of playerId: String, in scene: GameScene, me: String) -> (detail: String, roll: Int?)? {
        if let vote = scene.votes.first(where: { $0.playerId == playerId }) {
            let waiting = vote.pending ? (vote.formula.map { " · \($0)" } ?? " · d20") : ""
            return (words(vote, in: scene) + waiting, vote.roll)
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
