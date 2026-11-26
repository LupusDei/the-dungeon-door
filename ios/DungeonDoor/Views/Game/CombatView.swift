import SwiftUI

/// The three things a hero can do in a round. The server always sends them as choices a, b and c,
/// with the label and detail written for the caller's own hero.
enum CombatAction: String {
    case attack = "a", cast = "b", dodge = "c"

    init(choiceId: String) { self = CombatAction(rawValue: choiceId) ?? .attack }

    var symbol: String {
        switch self {
        case .attack: "burst.fill"
        case .cast: "wand.and.stars"
        case .dodge: "shield.lefthalf.filled"
        }
    }

    /// What a hero who chose it is doing, for the list of who has acted.
    var verb: String {
        switch self {
        case .attack: "Attacks"
        case .cast: "Casts"
        case .dodge: "Dodges"
        }
    }
}

/// A fight, one round at a time: everyone in initiative order with their hit points, the caller's
/// action for the round, who the table is still waiting on, and the dice of the round before.
///
/// An action is the hero's vote for the round, and like any vote it can be changed until the round
/// resolves: tapping another action swaps it.
struct CombatView: View {
    @Bindable var session: GameSession
    let scene: GameScene
    let combat: Combat
    /// Opens the sheet of the hero with this player id.
    var openHero: (String) -> Void = { _ in }

    private var state: GameState { session.state }
    private var open: Bool { state.status == .voting }
    private var heroNames: [String] { combat.combatants.filter { !$0.isFoe }.map(\.name) }
    private var voted: Set<String> { Set(scene.votes.map(\.playerId)) }

    /// The choices worth showing. A hero with no spell to cast is sent Attack twice (b is a's
    /// twin): one card is enough.
    private var actions: [Choice] {
        guard let attack = scene.choices.first(where: { $0.id == CombatAction.attack.rawValue }) else { return scene.choices }
        return scene.choices.filter { choice in
            choice.id != CombatAction.cast.rawValue || choice.label != attack.label || choice.detail != attack.detail
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            order
            action
            if open { table }
            DiceLog(lines: state.rules?.results ?? [], heroes: heroNames,
                    title: combat.round > 1 ? "Round \(combat.round - 1)" : "How it began")
        }
        .animation(.snappy, value: scene.votes)
    }

    // MARK: Initiative order

    private var order: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                SectionLabel("Initiative order")
                Spacer()
                HStack(spacing: 10) {
                    legend("Party", Palette.verdigris)
                    legend("Foes", Palette.ember)
                }
            }
            if combat.combatants.count <= Self.roomyLimit {
                VStack(spacing: 0) {
                    ForEach(Array(combat.combatants.enumerated()), id: \.element.id) { index, combatant in
                        if index > 0 {
                            Rectangle().fill(Palette.gold.opacity(0.14)).frame(height: 1).padding(.leading, 14)
                        }
                        row(combatant, place: index + 1)
                    }
                }
                .card()
            } else {
                // A crowded fight: two columns of smaller cells, read across then down, so the
                // actions below stay within reach.
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 6, alignment: .top), GridItem(.flexible(), spacing: 6, alignment: .top)],
                          spacing: 6) {
                    ForEach(Array(combat.combatants.enumerated()), id: \.element.id) { index, combatant in
                        cell(combatant, place: index + 1)
                    }
                }
            }
        }
    }

    /// More combatants than this and the order is drawn as a compact grid.
    private static let roomyLimit = 6

    @ViewBuilder private func cell(_ combatant: Combatant, place: Int) -> some View {
        if combatant.isFoe {
            cellBody(combatant, place: place)
        } else {
            Button { openHero(combatant.id) } label: { cellBody(combatant, place: place) }
                .buttonStyle(.plain)
                .accessibilityHint("Opens their character sheet")
        }
    }

    private func cellBody(_ combatant: Combatant, place: Int) -> some View {
        let foe = combatant.isFoe
        let side = foe ? Palette.ember : Palette.verdigris
        let mine = combatant.id == session.playerId
        let out = !combatant.isUp
        let acted = !foe && voted.contains(combatant.id)
        return HStack(alignment: .top, spacing: 7) {
            RoundedRectangle(cornerRadius: 1.5).fill(side.opacity(out ? 0.35 : 1)).frame(width: 3)
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: 5) {
                    Text("\(place)")
                        .font(.system(size: 10.5, weight: .bold, design: .serif))
                        .monospacedDigit()
                        .foregroundStyle(Palette.muted)
                    Text(combatant.name)
                        .font(.system(size: 13, weight: .semibold, design: .serif))
                        .strikethrough(combatant.isDead, color: Palette.muted)
                        .foregroundStyle(out ? Palette.muted : mine ? Palette.gold : Palette.parchment)
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                    Spacer(minLength: 2)
                    if acted && !out {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 11))
                            .foregroundStyle(Palette.verdigris)
                    }
                    Text(out ? statusWord(combatant) : "\(combatant.hp)/\(combatant.maxHp)")
                        .font(.system(size: 11, weight: out ? .semibold : .regular, design: .serif))
                        .monospacedDigit()
                        .foregroundStyle(out ? Palette.ember : Palette.muted)
                        .lineLimit(1)
                        .fixedSize()
                }
                HPBar(hp: out ? 0 : combatant.hp, maxHp: combatant.maxHp,
                      tint: foe ? Palette.ember : Health.tint(hp: combatant.hp, maxHp: combatant.maxHp, standing: !out),
                      height: 4)
                if !combatant.conditions.isEmpty {
                    Text(combatant.conditions.map(SRD.name).joined(separator: ", "))
                        .font(.system(size: 10, weight: .medium, design: .serif))
                        .foregroundStyle(Palette.gold)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                }
            }
        }
        .padding(.leading, 6)
        .padding(.trailing, 8)
        .padding(.vertical, 7)
        .frame(maxWidth: .infinity, minHeight: 44, alignment: .topLeading)
        .background(Palette.surface, in: .rect(cornerRadius: 10))
        .overlay {
            RoundedRectangle(cornerRadius: 10)
                .strokeBorder(mine ? Palette.gold.opacity(0.6) : Palette.gold.opacity(0.18), lineWidth: 1)
        }
        .opacity(combatant.isDead ? 0.5 : 1)
        .contentShape(.rect)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(summary(combatant, place: place, acted: acted))
    }

    private func legend(_ text: String, _ tint: Color) -> some View {
        HStack(spacing: 4) {
            RoundedRectangle(cornerRadius: 1.5).fill(tint).frame(width: 3, height: 11)
            Text(text).font(.caption2).foregroundStyle(Palette.muted)
        }
        .accessibilityHidden(true)
    }

    @ViewBuilder private func row(_ combatant: Combatant, place: Int) -> some View {
        if combatant.isFoe {
            rowBody(combatant, place: place)
        } else {
            Button { openHero(combatant.id) } label: { rowBody(combatant, place: place) }
                .buttonStyle(.plain)
                .accessibilityHint("Opens their character sheet")
        }
    }

    private func rowBody(_ combatant: Combatant, place: Int) -> some View {
        let foe = combatant.isFoe
        let side = foe ? Palette.ember : Palette.verdigris
        let mine = combatant.id == session.playerId
        let out = !combatant.isUp
        let acted = !foe && voted.contains(combatant.id)
        return HStack(alignment: .center, spacing: 10) {
            RoundedRectangle(cornerRadius: 2).fill(side.opacity(out ? 0.35 : 1)).frame(width: 4)
                .padding(.vertical, 8)
            Text("\(place)")
                .font(.system(size: 12, weight: .bold, design: .serif))
                .monospacedDigit()
                .foregroundStyle(Palette.muted)
                .frame(width: 16)
            if foe {
                Image(systemName: "pawprint.fill")
                    .font(.system(size: 12))
                    .foregroundStyle(Palette.ember.opacity(out ? 0.4 : 0.9))
                    .frame(width: 28, height: 28)
                    .background(Palette.ember.opacity(0.12), in: .circle)
            } else {
                PortraitView(url: state.player(combatant.id)?.character.portraitURL, size: 28, circular: true)
                    .saturation(out ? 0 : 1)
                    .opacity(out ? 0.6 : 1)
            }
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(combatant.name)
                        .font(.system(size: 15, weight: .semibold, design: .serif))
                        .strikethrough(combatant.isDead, color: Palette.muted)
                        .foregroundStyle(out ? Palette.muted : mine ? Palette.gold : Palette.parchment)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                    if mine { Text("you").font(.caption2).foregroundStyle(Palette.muted) }
                    Spacer(minLength: 4)
                    Text(combatant.isDead ? "\u{2014}" : "\(combatant.hp)/\(combatant.maxHp)")
                        .font(.system(size: 12.5, design: .serif))
                        .monospacedDigit()
                        .foregroundStyle(Palette.muted)
                }
                HPBar(hp: combatant.isDead ? 0 : combatant.hp, maxHp: combatant.maxHp,
                      tint: foe ? Palette.ember : Health.tint(hp: combatant.hp, maxHp: combatant.maxHp, standing: !out),
                      height: 5)
                if out || !combatant.conditions.isEmpty || acted {
                    FlowLayout(spacing: 4, lineSpacing: 4) {
                        if out { TagLabel(statusWord(combatant), tint: Palette.ember) }
                        ForEach(combatant.conditions, id: \.self) { TagLabel(SRD.name($0), tint: Palette.gold) }
                        if acted && !out { TagLabel("Action in", tint: Palette.verdigris) }
                    }
                }
            }
        }
        .padding(.leading, 6)
        .padding(.trailing, 12)
        .padding(.vertical, 7)
        .frame(maxWidth: .infinity, minHeight: 50, alignment: .leading)
        .opacity(combatant.isDead ? 0.5 : 1)
        .contentShape(.rect)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(summary(combatant, place: place, acted: acted))
    }

    /// "Down" for a hero at 0 hit points, "Slain" for a foe, "Dead" for a hero who is gone.
    private func statusWord(_ combatant: Combatant) -> String {
        switch combatant.status {
        case "dead": combatant.isFoe ? "Slain" : "Dead"
        case "dying": "Dying"
        case "stable": "Down, stable"
        default: SRD.name(combatant.status)
        }
    }

    private func summary(_ combatant: Combatant, place: Int, acted: Bool) -> String {
        var parts = ["\(place): \(combatant.name), \(combatant.isFoe ? "foe" : "hero")"]
        parts.append(combatant.isUp ? "\(combatant.hp) of \(combatant.maxHp) hit points" : statusWord(combatant))
        parts += combatant.conditions.map(SRD.name)
        if acted { parts.append("has chosen an action") }
        return parts.joined(separator: ", ")
    }

    // MARK: Your action

    @ViewBuilder private var action: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel("Your action")
            if !scene.canAct {
                cannotAct
            } else {
                ForEach(actions) { choice in actionCard(choice) }
                if let vote = session.myVote {
                    roll(vote)
                } else if open {
                    Text("Tap an action. You can change your mind until the round resolves.")
                        .font(.caption.italic())
                        .foregroundStyle(Palette.muted)
                }
            }
        }
    }

    /// The caller's hero is down or dead: nothing to choose, and the round doesn't wait for them.
    private var cannotAct: some View {
        let dead = session.myStanding?.dead ?? (combat.combatant(session.playerId)?.isDead ?? false)
        let name = session.me?.character.name ?? "Your hero"
        return HStack(alignment: .top, spacing: 12) {
            Image(systemName: dead ? "xmark.circle.fill" : "arrow.down.circle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Palette.ember)
            VStack(alignment: .leading, spacing: 4) {
                Text(dead ? "\(name) has fallen" : "\(name) is down")
                    .font(.display(18))
                    .fixedSize(horizontal: false, vertical: true)
                Text(dead
                     ? "The dead take no action. The round goes on without you."
                     : "At 0 hit points there is no action to take. The round goes on without you; the others can still win it.")
                    .font(.proseSmall)
                    .foregroundStyle(Palette.parchment.opacity(0.85))
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.ember.opacity(0.12), in: .rect(cornerRadius: 14))
        .overlay { RoundedRectangle(cornerRadius: 14).strokeBorder(Palette.ember.opacity(0.55), lineWidth: 1) }
        .accessibilityElement(children: .combine)
    }

    private func actionCard(_ choice: Choice) -> some View {
        let kind = CombatAction(choiceId: choice.id)
        let mine = scene.myVote == choice.id
        return Button {
            Task { await session.vote(choice) }
        } label: {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: kind.symbol)
                    .font(.system(size: 16))
                    .foregroundStyle(mine ? Palette.ink : Palette.gold)
                    .frame(width: 36, height: 36)
                    .background(mine ? Palette.gold : Palette.raised, in: .circle)
                VStack(alignment: .leading, spacing: 3) {
                    Text(choice.label).font(.display(17)).multilineTextAlignment(.leading)
                    if !choice.detail.isEmpty {
                        Text(choice.detail)
                            .font(.footnote)
                            .foregroundStyle(Palette.muted)
                            .multilineTextAlignment(.leading)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 0)
                if mine { Image(systemName: "checkmark.seal.fill").foregroundStyle(Palette.gold) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .card(highlighted: mine)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .disabled(!open || session.busy)
        .accessibilityAddTraits(mine ? .isSelected : [])
    }

    /// The d20 that came with the vote. In a fight it is the hero's roll to hit.
    private func roll(_ vote: Vote) -> some View {
        let kind = CombatAction(choiceId: vote.choiceId)
        // A spell the target saves against says so in its detail ("Dexterity save DC 12 for half").
        let saved = scene.choices.first { $0.id == vote.choiceId }?.detail.contains(" save DC") ?? false
        let note = kind == .dodge ? "Rolled with your vote. Dodging needs no roll."
            : saved ? "Rolled with your vote. The target saves against this spell, so there is no roll to hit."
            : "Your roll to hit this round, before your bonus."
        return HStack(spacing: 12) {
            D20Badge(roll: vote.roll, size: 44)
            VStack(alignment: .leading, spacing: 2) {
                Text("Your d20").font(.display(15))
                Text(note)
                    .font(.footnote.italic())
                    .foregroundStyle(Palette.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .card()
        .transition(.scale(scale: 0.9).combined(with: .opacity))
        .accessibilityElement(children: .combine)
    }

    // MARK: The table

    /// Heroes who can act this round and haven't chosen yet.
    private var waitingOn: [String] {
        combat.combatants.filter { !$0.isFoe && $0.isUp && !voted.contains($0.id) }
            .map { $0.id == session.playerId ? "you" : $0.name }
    }

    private var table: some View {
        let waiting = waitingOn
        let acted = scene.votes.filter { $0.playerId != session.playerId }
        return VStack(spacing: 12) {
            if !acted.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(acted, id: \.playerId) { vote in
                        let hero = state.player(vote.playerId)?.character
                        HStack(spacing: 10) {
                            PortraitView(url: hero?.portraitURL, size: 26, circular: true)
                            Text(hero?.name ?? "A hero").font(.caption.weight(.semibold))
                            Text(CombatAction(choiceId: vote.choiceId).verb).font(.caption).foregroundStyle(Palette.muted)
                            Spacer(minLength: 0)
                            D20Badge(roll: vote.roll, size: 28)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            if waiting.isEmpty {
                Text("Every action is in.").font(.proseSmall.italic()).foregroundStyle(Palette.muted)
            } else {
                HStack(spacing: 8) {
                    ProgressView().tint(Palette.gold)
                    Text("Waiting on \(ListFormatter.localizedString(byJoining: waiting))…")
                        .font(.proseSmall.italic()).foregroundStyle(Palette.muted)
                }
                if session.isHost {
                    // A round can be resolved with no votes at all: a hero without one dodges.
                    Button("Resolve the round now") { Task { await session.advance() } }
                        .buttonStyle(.gildedOutline)
                        .disabled(session.busy)
                }
            }
        }
        .frame(maxWidth: .infinity)
    }
}
