import SwiftUI

/// Every hero, the moment the table is choosing. A player who has not answered is already here,
/// with a bar that drains across the server's choice window. Choosing fills the bar.
struct ChoiceWaitPanel: View {
    @Bindable var session: GameSession
    let scene: GameScene
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var state: GameState { session.state }

    private struct Seat: Identifiable {
        let id: String
        let name: String
        let you: Bool
        let portrait: URL?
        let kind: Kind
        let detail: String
        let roll: Int?
        enum Kind { case chosen, waiting, down }
    }

    var body: some View {
        let party = seats
        VStack(alignment: .leading, spacing: 10) {
            header
            ForEach(party) { seat in
                row(seat)
            }
            if party.allSatisfy({ $0.kind != .waiting }) {
                Text(scene.combat ? "Every action is in." : "All votes are in.")
                    .font(.proseSmall.italic())
                    .foregroundStyle(Palette.muted)
            }
            if session.isHost, party.contains(where: { $0.kind == .waiting }),
               scene.combat || !scene.votes.isEmpty || !scene.freeforms.isEmpty {
                Button(scene.combat ? "Resolve the round now" : "Proceed without them") {
                    Task { await session.advance() }
                }
                .buttonStyle(.gildedOutline)
                .disabled(session.busy)
            }
        }
    }

    /// The shared clock. Only this text follows the timeline, so the rows stay put.
    private var header: some View {
        TimelineView(.animation(minimumInterval: reduceMotion ? 1.0 : 1.0 / 30.0)) { context in
            let left = remaining(at: context.date)
            HStack(alignment: .firstTextBaseline) {
                SectionLabel("The table")
                Spacer(minLength: 8)
                if let left {
                    Text(clock(left))
                        .font(.system(.subheadline, design: .serif))
                        .monospacedDigit()
                        .foregroundStyle(left <= 10 ? Palette.ember : Palette.gold)
                        .accessibilityLabel("\(whole(left)) seconds left to choose")
                }
            }
        }
    }

    /// Portrait and name stay outside the ticking view, so they are not rebuilt every frame.
    private func row(_ seat: Seat) -> some View {
        HStack(alignment: .top, spacing: 10) {
            PortraitView(url: seat.portrait, size: 36, circular: true)
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(seat.you ? "\(seat.name) (you)" : seat.name)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(seat.you ? Palette.gold : Palette.parchment)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 8)
                    TimelineView(.animation(minimumInterval: reduceMotion ? 1.0 : 1.0 / 30.0)) { context in
                        mark(seat, left: remaining(at: context.date))
                    }
                }
                if seat.kind == .chosen, !seat.detail.isEmpty {
                    HStack(spacing: 8) {
                        Text(seat.detail)
                            .font(.caption)
                            .foregroundStyle(Palette.muted)
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 0)
                        if let roll = seat.roll {
                            D20Badge(roll: roll, size: 28)
                        }
                    }
                }
                if seat.kind != .down {
                    TimelineView(.animation(minimumInterval: reduceMotion ? 1.0 : 1.0 / 30.0)) { context in
                        let left = remaining(at: context.date)
                        let fill = seat.kind == .chosen ? 1.0 : fraction(left)
                        let tint = seat.kind == .chosen ? Palette.verdigris : ((left ?? 11) <= 10 ? Palette.ember : Palette.gold)
                        GeometryReader { geo in
                            ZStack(alignment: .leading) {
                                Capsule().fill(Palette.raised)
                                Capsule()
                                    .fill(tint)
                                    .frame(width: max(0, geo.size.width * fill))
                            }
                        }
                        .frame(height: 6)
                        .animation(seat.kind == .chosen ? .easeOut(duration: 0.35) : nil, value: seat.kind)
                    }
                    .accessibilityHidden(true)
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spoken(seat, left: remaining(at: Date())))
    }

    @ViewBuilder private func mark(_ seat: Seat, left: TimeInterval?) -> some View {
        switch seat.kind {
        case .chosen:
            Label("Chosen", systemImage: "checkmark.circle.fill")
                .font(.caption.weight(.semibold))
                .foregroundStyle(Palette.verdigris)
        case .waiting:
            Text(left.map { "Waiting · \(clock($0))" } ?? "Waiting")
                .font(.caption.italic())
                .monospacedDigit()
                .foregroundStyle(Palette.muted)
        case .down:
            Text("Down")
                .font(.caption.weight(.semibold))
                .foregroundStyle(Palette.ember)
        }
    }

    private var seats: [Seat] {
        state.players.map { player in
            let act = acted(player.playerId)
            return Seat(
                id: player.playerId,
                name: player.character.name.isEmpty ? "A hero" : player.character.name,
                you: player.playerId == session.playerId,
                portrait: player.character.portraitURL,
                kind: kind(of: player, chosen: act != nil),
                detail: act?.detail ?? "",
                roll: act?.roll
            )
        }
    }

    private func kind(of player: GamePlayer, chosen: Bool) -> Seat.Kind {
        if chosen { return .chosen }
        guard scene.combat, let combat = state.rules?.combat else { return .waiting }
        if let hero = combat.combatants.first(where: { $0.id == player.playerId && !$0.isFoe }) {
            return hero.isUp ? .waiting : .down
        }
        if player.playerId == session.playerId, !scene.canAct { return .down }
        return .waiting
    }

    private func acted(_ playerId: String) -> (detail: String, roll: Int?)? {
        if let vote = scene.votes.first(where: { $0.playerId == playerId }) {
            let waiting = vote.pending ? (vote.formula.map { " · \($0)" } ?? " · d20") : ""
            return (words(vote) + waiting, vote.roll)
        }
        if let written = scene.freeforms.first(where: { $0.playerId == playerId }) {
            let waiting = written.pending ? " · d20" : ""
            return (written.text + waiting, written.roll)
        }
        guard playerId == session.playerId else { return nil }
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

    private func words(_ vote: Vote) -> String {
        if let label = vote.label, !label.isEmpty { return label }
        if let actionId = vote.actionId, let action = scene.actions.first(where: { $0.id == actionId }) { return action.label }
        if let choice = scene.choices.first(where: { $0.id == vote.choiceId }), !choice.label.isEmpty { return choice.label }
        return "Chosen"
    }

    /// Seconds left on the server's clock. Nil when this server sent no window.
    private func remaining(at date: Date) -> TimeInterval? {
        guard let turn = state.turn, let deadline = ServerTime.date(turn.deadline) else { return nil }
        let now = session.serverClock?.date(at: date) ?? date
        return deadline.timeIntervalSince(now)
    }

    private func fraction(_ left: TimeInterval?) -> Double {
        guard let turn = state.turn, turn.seconds > 0, let left else { return 1 }
        return min(1, max(0, left / Double(turn.seconds)))
    }

    private func whole(_ seconds: TimeInterval) -> Int { max(0, Int(seconds.rounded(.down))) }

    private func clock(_ seconds: TimeInterval) -> String {
        let left = whole(seconds)
        return String(format: "%d:%02d", left / 60, left % 60)
    }

    private func spoken(_ seat: Seat, left: TimeInterval?) -> String {
        let who = seat.you ? "\(seat.name), you" : seat.name
        switch seat.kind {
        case .chosen:
            return seat.detail.isEmpty ? "\(who), chosen" : "\(who), chosen, \(seat.detail)"
        case .down:
            return "\(who), down"
        case .waiting:
            guard let left else { return "\(who), waiting" }
            return "\(who), waiting, \(whole(left)) seconds left"
        }
    }
}
