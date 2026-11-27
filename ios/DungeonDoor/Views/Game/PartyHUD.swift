import SwiftUI

/// One hero as the heads-up display shows them: the rules engine's numbers when the game has
/// them, the sheet's otherwise, and where they are in the turn being chosen.
struct PartyMember: Identifiable, Equatable {
    /// The player's id.
    let id: String
    let name: String
    let portrait: URL?
    let isMe: Bool
    let level: Int?
    let hp: Int
    let maxHp: Int
    let armorClass: Int
    /// Condition names: the fight's first, then those carried from scene to scene.
    let conditions: [String]
    let turn: Turn

    enum Turn: Equatable {
        case chosen, waiting, down, fallen
        /// The table is not choosing, and the hero stands: nothing to say.
        case idle

        var word: String? {
            switch self {
            case .chosen: "Chosen"
            case .waiting: "Waiting"
            case .down: "Down"
            case .fallen: "Fallen"
            case .idle: nil
            }
        }

        /// The mark for it. Down and fallen differ in shape as well as colour.
        var symbol: String? {
            switch self {
            case .chosen: "checkmark.circle.fill"
            case .waiting: "hourglass"
            case .down: "arrow.down.circle.fill"
            case .fallen: "xmark.circle.fill"
            case .idle: nil
            }
        }

        var tint: Color {
            switch self {
            case .chosen: Palette.verdigris
            case .down: Palette.ember
            case .waiting, .fallen, .idle: Palette.muted
            }
        }
    }

    var standing: Bool { turn != .down && turn != .fallen }
    /// How full the ring is, 0 to 1. Empty once the hero is down.
    var fraction: CGFloat {
        guard standing, maxHp > 0 else { return 0 }
        return CGFloat(min(1, max(0, Double(hp) / Double(maxHp))))
    }
    var tint: Color { Health.tint(hp: hp, maxHp: maxHp, standing: standing) }

    /// The first letters of the first two words of the name, for a hero with no portrait.
    var initials: String {
        let letters = name.split(separator: " ").compactMap(\.first)
        let text = String(letters.prefix(2)).uppercased()
        return text.isEmpty ? "?" : text
    }

    /// "Maud Ashdown 12 of 12 hit points", "Corin Vale down".
    var spoken: String {
        switch turn {
        case .fallen: "\(name) fallen"
        case .down: "\(name) down"
        default: "\(name) \(hp) of \(maxHp) hit points"
        }
    }
}

extension PartyMember {
    /// Everyone at the table, in joining order.
    static func party(of state: GameState, me: String) -> [PartyMember] {
        state.players.map { PartyMember(player: $0, state: state, me: me) }
    }

    init(player: GamePlayer, state: GameState, me: String) {
        let live = state.live(of: player.playerId)
        let sheet = player.character.sheet
        // In a fight the server's own glance at it (rules.combat.hud) has the last word: the hit
        // points as the round left them, and what holds each hero, named as the table says it.
        let fight = state.scene?.combat == true ? state.rules?.combat?.hud?.party.first { $0.id == player.playerId } : nil
        let points = fight?.hp ?? live?.standing.hp ?? sheet?.hp ?? 0
        let dead = fight.map { $0.status == "dead" } ?? live?.standing.dead ?? sheet?.dead ?? false
        let known = fight != nil || live != nil || sheet != nil
        let down = !dead && (fight.map { !$0.isUp } ?? (live?.standing.down == true) || (known && points <= 0))
        let named = live?.standing.name.isEmpty == false ? live?.standing.name : nil

        id = player.playerId
        name = named ?? (player.character.name.isEmpty ? "A hero" : player.character.name)
        portrait = player.character.portraitURL
        isMe = player.playerId == me
        level = live?.standing.level ?? sheet?.level
        hp = points
        maxHp = max(fight?.maxHp ?? live?.standing.maxHp ?? sheet?.maxHp ?? 1, 1)
        armorClass = live?.standing.armorClass ?? sheet?.armorClass ?? 10

        if let fight {
            conditions = fight.conditions.map(\.label)
        } else {
            var seen = Set<String>()
            var names: [String] = []
            for condition in (live?.conditions ?? []) + (live?.standing.conditions.map(\.condition) ?? []) {
                let key = condition.lowercased()
                if !key.isEmpty, seen.insert(key).inserted { names.append(SRD.name(condition)) }
            }
            conditions = names
        }

        if dead {
            turn = .fallen
        } else if down {
            turn = .down
        } else if state.status == .voting, let scene = state.scene, !scene.isFinale {
            // The same rule as the wait panel under the story, so the two cannot disagree.
            switch PlayTurn.seat(of: player.playerId, in: scene, combat: state.rules?.combat, me: me) {
            case .chosen: turn = .chosen
            case .waiting: turn = .waiting
            case .down: turn = .down
            }
        } else {
            turn = .idle
        }
    }

    /// The caller before the game knows them: what the strip showed in that moment.
    static func stranger(_ playerId: String) -> PartyMember {
        PartyMember(id: playerId, name: "Hero", portrait: nil, isMe: true, level: nil,
                    hp: 0, maxHp: 1, armorClass: 10, conditions: [], turn: .idle)
    }
}

// MARK: - The heads-up display

/// The party, pinned over the game: the player's own hero in one slim row, everyone else as
/// health rings beside them, and a panel that pulls down from the row to list the whole party.
///
/// The panel hangs below the row and lies over what follows it (the Act bar, the tab). It takes no
/// room of its own, so nothing under it moves. `zIndex` keeps it above the views that come after.
struct PartyHUD: View {
    @Bindable var session: GameSession
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// Pulled down. `-hudOpen YES` starts it so (screenshot checks).
    @State private var open = AppConfig.hudOpenArgument
    /// The row's own height: the panel has that much less of the screen.
    @State private var barHeight: CGFloat = 44

    private var state: GameState { session.state }

    var body: some View {
        let party = PartyMember.party(of: state, me: session.playerId)
        let mine = party.first(where: \.isMe) ?? .stranger(session.playerId)
        let others = party.filter { !$0.isMe }
        let line = turnLine
        Button {
            set(!open)
        } label: {
            PartyBar(me: mine, others: others, round: round, turnLine: line, open: open)
                // A glance, not a page: the row's words stop growing at the first accessibility size.
                .dynamicTypeSize(...DynamicTypeSize.accessibility1)
        }
        .buttonStyle(.plain)
        .highPriorityGesture(HUDPull.gesture(set))
        .accessibilityLabel("Party: " + ([mine] + others).map(\.spoken).joined(separator: ", "))
        .accessibilityValue(status(of: mine, line: line))
        .accessibilityHint(open ? "Hides everyone" : "Shows everyone")
        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { barHeight = $0 }
        .overlay(alignment: .bottom) {
            // Its top edge on the row's bottom edge.
            drawer([mine] + others).alignmentGuide(.bottom) { $0[.top] }
        }
        .zIndex(1)
    }

    /// The dimmed game and the panel over it. The dimming is as tall as the whole game, which is
    /// more than is left under the row, so it reaches the foot of the screen (the tab bar too: a tap
    /// anywhere outside closes the panel). The panel itself keeps clear of the tab bar, and scrolls
    /// inside when the party does not fit.
    private func drawer(_ party: [PartyMember]) -> some View {
        ZStack(alignment: .top) {
            if open {
                Color.black.opacity(0.55)
                    .contentShape(.rect)
                    .onTapGesture { set(false) }
                    .gesture(HUDPull.gesture(set))
                    .accessibilityHidden(true)
                    .transition(.opacity)
            }
            VStack(spacing: 0) {
                if open {
                    PartyPanel(party: party, set: set)
                        .transition(reduceMotion ? .opacity : .move(edge: .top).combined(with: .opacity))
                }
            }
            .frame(maxHeight: .infinity, alignment: .top)
            .containerRelativeFrame(.vertical, alignment: .top) { length, _ in
                max(200, length - barHeight - HUDMetrics.clearance)
            }
        }
        .containerRelativeFrame(.vertical, alignment: .top)
        .clipped()
        .allowsHitTesting(open)
    }

    private func set(_ wanted: Bool) {
        guard wanted != open else { return }
        withAnimation(reduceMotion ? .easeOut(duration: 0.15) : .spring(duration: 0.42, bounce: 0.2)) {
            open = wanted
        }
    }

    private var round: Int? {
        state.scene?.combat == true ? state.rules?.combat?.round : nil
    }

    /// What VoiceOver adds after the party: the player's own armour and conditions, the round, the turn.
    private func status(of mine: PartyMember, line: String) -> String {
        var parts = ["Armour class \(mine.armorClass)"]
        parts += mine.conditions
        if let round { parts.append("Round \(round)") }
        parts.append(line)
        return parts.joined(separator: ", ")
    }

    private var turnLine: String {
        if session.state.status == .resolving { return "Resolving…" }
        guard let scene = session.state.scene else { return "Holding" }
        if !scene.canAct { return "You are down" }
        if PlayTurn.chosenLine(scene: scene, playerId: session.playerId) != nil {
            // Declared, with the d20 still in hand: the table is waiting on this player, not the others.
            if scene.myDie != nil, session.state.status == .voting { return "Throw your die" }
            var acted = Set(scene.votes.map(\.playerId))
            for turn in scene.freeforms {
                if let playerId = turn.playerId { acted.insert(playerId) }
            }
            acted.insert(session.playerId)
            let waiting: Bool
            if scene.combat, let combat = session.state.rules?.combat {
                waiting = combat.combatants.contains { !$0.isFoe && $0.isUp && !acted.contains($0.id) }
            } else {
                waiting = session.state.players.contains { !acted.contains($0.playerId) }
            }
            return waiting ? "Waiting on others" : "Ready"
        }
        if session.state.status == .voting { return "Your turn" }
        return "Holding"
    }
}

private enum HUDMetrics {
    /// What the panel leaves free at the foot of the screen: the tab bar, and a strip of the game to tap.
    static let clearance: CGFloat = 84
    /// The widest the panel's list gets, as the story under it does.
    static let column: CGFloat = 720
}

/// A pull on the row or the panel: down opens, up closes. It acts as soon as the finger has gone
/// far enough, without waiting for it to lift.
private enum HUDPull {
    static func gesture(_ set: @escaping (Bool) -> Void) -> some Gesture {
        DragGesture(minimumDistance: 12)
            .onChanged { value in
                if value.translation.height > 24 {
                    set(true)
                } else if value.translation.height < -24 {
                    set(false)
                }
            }
    }
}

private struct HUDGrabber: View {
    var body: some View {
        Capsule(style: .circular)
            .fill(Palette.muted.opacity(0.6))
            .frame(width: 34, height: 3.5)
            .accessibilityHidden(true)
    }
}

// MARK: - The row

/// The slim row. One line while everything fits in it: the rings shrink first, then the name is
/// drawn a little smaller. When it does not (larger text, a long name, conditions), two lines:
/// the hero's name and the party, then their numbers and the turn. There the name and the numbers
/// wrap, so nothing is ever cut short.
private struct PartyBar: View {
    let me: PartyMember
    let others: [PartyMember]
    let round: Int?
    let turnLine: String
    let open: Bool
    /// The caption style's size, for the name when it is drawn smaller.
    @ScaledMetric(relativeTo: .caption) private var nameSize: CGFloat = 12
    /// A ring on two lines sits beside one line of words, and grows with them: 24 to 30 points.
    @ScaledMetric(relativeTo: .caption) private var lineRing: CGFloat = 24
    private var ownRing: CGFloat { min(max(lineRing, 24), 30) }

    var body: some View {
        ViewThatFits(in: .horizontal) {
            oneLine(ring: 28)
            oneLine(ring: 24)
            oneLine(ring: 22)
            oneLine(ring: 20)
            oneLine(ring: 20, nameShare: 0.86)
            twoLines
        }
        .padding(.horizontal, 12)
        .padding(.top, 3)
        .padding(.bottom, 8)
        .frame(maxWidth: .infinity)
        .background(Palette.ink)
        .overlay(alignment: .bottom) {
            HUDGrabber().padding(.bottom, 2).opacity(open ? 0 : 1)
        }
        .contentShape(.rect)
    }

    /// Everything at its own width, so `ViewThatFits` can tell whether it fits.
    private func oneLine(ring: CGFloat, nameShare: CGFloat = 1) -> some View {
        HStack(spacing: 0) {
            RingAvatar(member: me, size: 30)
            VStack(alignment: .leading, spacing: 0) {
                name(nameShare)
                vitals
            }
            .lineLimit(1)
            .fixedSize()
            .padding(.leading, 6)
            rings(ring).padding(.leading, 8)
            Spacer(minLength: 0)
            turnColumn.padding(.leading, 8)
        }
    }

    private var twoLines: some View {
        VStack(alignment: .leading, spacing: 1) {
            ViewThatFits(in: .horizontal) {
                top(ring: ownRing, wraps: false)
                top(ring: max(ownRing - 4, 20), wraps: false)
                top(ring: 20, wraps: true)
            }
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    vitals.fixedSize()
                    Spacer(minLength: 0)
                    HStack(alignment: .firstTextBaseline, spacing: 5) {
                        if round != nil {
                            roundText
                            Text("·").font(HUDFont.small).foregroundStyle(Palette.muted)
                        }
                        lineText
                    }
                    .fixedSize()
                }
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    vitals
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    VStack(alignment: .trailing, spacing: 0) {
                        if round != nil { roundText }
                        lineText
                    }
                    .fixedSize()
                }
            }
        }
    }

    private func top(ring: CGFloat, wraps: Bool) -> some View {
        HStack(spacing: 0) {
            RingAvatar(member: me, size: ownRing)
            name()
                .fixedSize(horizontal: !wraps, vertical: true)
                .frame(maxWidth: wraps ? .infinity : nil, alignment: .leading)
                .padding(.leading, 6)
            if !wraps { Spacer(minLength: 0) }
            rings(ring).padding(.leading, 8)
        }
    }

    /// The hero's name, or the same at a share of its size. The size follows the caption style
    /// either way, so it grows with the system text size.
    private func name(_ share: CGFloat = 1) -> some View {
        Text(me.name)
            .font(share == 1 ? .serif(.caption, weight: .bold) : .system(size: nameSize * share, weight: .bold, design: .serif))
            .foregroundStyle(me.standing ? Palette.parchment : Palette.muted)
            .multilineTextAlignment(.leading)
    }

    /// Hit points, armour class and conditions as one run of words. It breaks between them only
    /// ("AC 16" stays whole), and wraps instead of being cut.
    private var vitals: some View {
        let gap = "\u{00A0}"
        let heart = Text(Image(systemName: me.standing ? "heart.fill" : "heart.slash.fill")).foregroundStyle(me.tint)
        let points = Text("\(me.hp)/\(me.maxHp)").foregroundStyle(me.standing ? Palette.parchment : Palette.ember)
        let armour = Text("AC\(gap)\(me.armorClass)").foregroundStyle(Palette.muted)
        let names = me.conditions.map { $0.replacingOccurrences(of: " ", with: gap) }.joined(separator: ", ")
        let carried = Text(names.isEmpty ? "" : "  \(names)").foregroundStyle(Palette.ember)
        return Text("\(heart)\(gap)\(points)  \(armour)\(carried)")
            .font(HUDFont.small)
            .monospacedDigit()
            .multilineTextAlignment(.leading)
    }

    @ViewBuilder private func rings(_ size: CGFloat) -> some View {
        if !others.isEmpty {
            HStack(spacing: size >= 26 ? 4 : 3) {
                ForEach(others) { RingAvatar(member: $0, size: size) }
            }
            .fixedSize()
        }
    }

    /// The round over the turn line, as wide as the longest line there is, so the row does not
    /// change when the turn does.
    private var turnColumn: some View {
        ZStack(alignment: .trailing) {
            Text("Waiting on others").font(HUDFont.small).hidden()
            VStack(alignment: .trailing, spacing: 0) {
                if round != nil { roundText }
                lineText
            }
        }
        .fixedSize()
    }

    private var roundText: some View {
        Text("Round \(round ?? 1)")
            .font(HUDFont.small)
            .foregroundStyle(Palette.gold)
    }

    private var lineText: some View {
        Text(turnLine)
            .font(HUDFont.small)
            .foregroundStyle(turnLine == "Your turn" || turnLine == "Throw your die" ? Palette.gold : Palette.muted)
    }
}

private enum HUDFont {
    /// The row's small words: 11 points at the default text size, and growing with it.
    static let small = Font.serif(.caption2, weight: .semibold)
}

// MARK: - A hero in a ring

/// A hero's portrait, or their initials, inside a ring as full as their hit points. A hero who is
/// down is dimmed and marked with an arrow, a fallen one with a cross; one who has chosen this
/// turn, with a check.
struct RingAvatar: View {
    let member: PartyMember
    var size: CGFloat = 26

    var body: some View {
        let line = max(2, size * 0.085)
        let face = size - 2 * line - 2
        ZStack {
            Circle()
                .stroke(member.standing ? Color.white.opacity(0.14) : member.tint.opacity(0.7), lineWidth: line)
                .padding(line / 2)
            Circle()
                .trim(from: 0, to: member.fraction)
                .stroke(member.tint, style: StrokeStyle(lineWidth: line, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .padding(line / 2)
            portrait(face)
                .saturation(member.standing ? 1 : 0)
                .opacity(member.standing ? 1 : 0.5)
        }
        .frame(width: size, height: size)
        .overlay(alignment: .bottomTrailing) { mark }
        .animation(.easeOut(duration: 0.5), value: member.fraction)
        .accessibilityHidden(true)
    }

    @ViewBuilder private func portrait(_ side: CGFloat) -> some View {
        if member.portrait != nil {
            PortraitView(url: member.portrait, size: side, circular: true, opensViewer: false)
        } else {
            ZStack {
                Circle().fill(Palette.raised)
                Text(member.initials)
                    .font(.system(size: side * 0.46, weight: .bold, design: .serif))
                    .foregroundStyle(Palette.parchment)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
            }
            .frame(width: side, height: side)
            .overlay { Circle().stroke(Palette.gold.opacity(0.55), lineWidth: 1) }
        }
    }

    /// Nothing for a hero still to choose: in the row a mark means done, or out of the fight.
    @ViewBuilder private var mark: some View {
        if member.turn != .waiting, let symbol = member.turn.symbol {
            let side = max(9, size * 0.42)
            Image(systemName: symbol)
                .font(.system(size: side, weight: .bold))
                .foregroundStyle(member.turn == .fallen ? Palette.parchment : member.turn.tint)
                .background { Circle().fill(Palette.ink).padding(-1) }
                .offset(x: side * 0.3, y: side * 0.12)
        }
    }
}

// MARK: - The panel

/// Everyone, the player first. It fits its heroes when it can and scrolls inside itself when it
/// cannot. Its text grows with the system text size, without a ceiling.
private struct PartyPanel: View {
    let party: [PartyMember]
    var set: (Bool) -> Void

    var body: some View {
        VStack(spacing: 0) {
            ViewThatFits(in: .vertical) {
                list.gesture(HUDPull.gesture(set))
                ScrollView { list }
            }
            Button {
                set(false)
            } label: {
                HUDGrabber()
                    .padding(.top, 6)
                    .padding(.bottom, 8)
                    .frame(maxWidth: .infinity)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .highPriorityGesture(HUDPull.gesture(set))
            .accessibilityLabel("Close the party")
        }
        .background(Palette.ink)
        .overlay(alignment: .bottom) { Rectangle().fill(Palette.gold.opacity(0.3)).frame(height: 1) }
        .shadow(color: .black.opacity(0.6), radius: 14, y: 8)
        .accessibilityAddTraits(.isModal)
        .accessibilityAction(.escape) { set(false) }
    }

    private var list: some View {
        VStack(spacing: 0) {
            ForEach(party) { member in
                if member.id != party.first?.id {
                    Rectangle().fill(Palette.gold.opacity(0.14)).frame(height: 1)
                }
                PartyRow(member: member)
            }
        }
        .padding(.horizontal, 14)
        .frame(maxWidth: HUDMetrics.column)
        .frame(maxWidth: .infinity)
        .contentShape(.rect)
    }
}

private struct PartyRow: View {
    let member: PartyMember
    @ScaledMetric(relativeTo: .subheadline) private var avatar: CGFloat = 44

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            RingAvatar(member: member, size: min(avatar, 60))
            VStack(alignment: .leading, spacing: 5) {
                heading
                health
                if !member.conditions.isEmpty {
                    FlowLayout(spacing: 5, lineSpacing: 5) {
                        ForEach(member.conditions, id: \.self) { TagLabel($0, tint: Palette.ember) }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, 10)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spoken)
    }

    /// Name, level and the turn on one line; as the text grows, the name over the other two; then
    /// each on its own line.
    private var heading: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                name.fixedSize()
                level.fixedSize()
                Spacer(minLength: 4)
                turn.fixedSize()
            }
            VStack(alignment: .leading, spacing: 2) {
                name.fixedSize(horizontal: false, vertical: true)
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        level.fixedSize()
                        Spacer(minLength: 4)
                        turn.fixedSize()
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        level.fixedSize(horizontal: false, vertical: true)
                        turn.fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
    }

    private var name: some View {
        Text(member.name)
            .font(.serif(.subheadline, weight: .bold))
            .foregroundStyle(member.isMe ? Palette.gold : member.standing ? Palette.parchment : Palette.muted)
            .multilineTextAlignment(.leading)
    }

    @ViewBuilder private var level: some View {
        if let level = member.level {
            Text("Level \(level)")
                .font(.serif(.caption))
                .foregroundStyle(Palette.muted)
        }
    }

    @ViewBuilder private var turn: some View {
        if let word = member.turn.word, let symbol = member.turn.symbol {
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Image(systemName: symbol)
                Text(word)
            }
            .font(.serif(.caption, weight: .semibold))
            .foregroundStyle(member.turn.tint)
        }
    }

    /// The bar with the numbers beside it; with larger text, under it.
    private var health: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 10) {
                bar.frame(minWidth: 56)
                numbers.fixedSize()
                armour.fixedSize()
            }
            VStack(alignment: .leading, spacing: 4) {
                bar
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    numbers
                    Spacer(minLength: 4)
                    armour
                }
            }
        }
    }

    private var bar: some View {
        HPBar(hp: member.standing ? member.hp : 0, maxHp: member.maxHp, tint: member.tint, height: 6)
    }

    private var numbers: some View {
        Text("\(member.hp)/\(member.maxHp)")
            .font(.serif(.caption, weight: .semibold))
            .monospacedDigit()
            .foregroundStyle(member.standing ? Palette.parchment : Palette.ember)
    }

    private var armour: some View {
        Text("AC \(member.armorClass)")
            .font(.serif(.caption))
            .monospacedDigit()
            .foregroundStyle(Palette.muted)
    }

    private var spoken: String {
        var parts = [member.isMe ? "\(member.name), you" : member.name]
        if let level = member.level { parts.append("level \(level)") }
        parts.append("\(member.hp) of \(member.maxHp) hit points")
        parts.append("armour class \(member.armorClass)")
        parts += member.conditions
        if let word = member.turn.word { parts.append(word.lowercased()) }
        return parts.joined(separator: ", ")
    }
}
