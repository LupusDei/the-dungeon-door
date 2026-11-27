import SwiftUI

/// One hero as the heads-up display shows them: the rules engine's numbers when the game has
/// them, the sheet's otherwise, and where they are in the turn being chosen.
struct PartyMember: Identifiable, Equatable {
    /// The player's id.
    let id: String
    let name: String
    let portrait: URL?
    let isMe: Bool
    let hp: Int
    let maxHp: Int
    let armorClass: Int
    /// What is on the hero: the fight's own list while there is one, else what they carry from
    /// scene to scene.
    let conditions: [HudCondition]
    let turn: Turn
    /// In a fight: the one whose turn it is, and the one who comes up after them.
    var isNow = false
    var isNext = false

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

    /// "Maud" from "Maud Ashdown": a chip is narrow.
    var shortName: String {
        name.split(separator: " ").first.map(String.init) ?? name
    }

    /// "Maud Ashdown 12 of 12 hit points", "Corin Vale down".
    var spoken: String {
        switch turn {
        case .fallen: "\(name) fallen"
        case .down: "\(name) down"
        default: "\(name) \(hp) of \(maxHp) hit points"
        }
    }

    /// Everything a chip shows, for VoiceOver: "Maud Ashdown, you, acting now, 12 of 12 hit points,
    /// armour class 16, Dodging, chosen".
    var spokenInFull: String {
        var parts = [isMe ? "\(name), you" : name]
        if isNow { parts.append("acting now") }
        if isNext { parts.append("next") }
        if standing { parts.append("\(hp) of \(maxHp) hit points") }
        parts.append("armour class \(armorClass)")
        parts += conditions.map(\.spoken)
        if let word = turn.word { parts.append(word.lowercased()) }
        return parts.joined(separator: ", ")
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
        let hud = state.scene?.combat == true ? state.rules?.combat?.hud : nil
        let fight = hud?.party.first { $0.id == player.playerId }
        let points = fight?.hp ?? live?.standing.hp ?? sheet?.hp ?? 0
        let dead = fight.map { $0.status == "dead" } ?? live?.standing.dead ?? sheet?.dead ?? false
        let known = fight != nil || live != nil || sheet != nil
        let down = !dead && (fight.map { !$0.isUp } ?? (live?.standing.down == true) || (known && points <= 0))
        let named = live?.standing.name.isEmpty == false ? live?.standing.name : nil

        id = player.playerId
        name = named ?? (player.character.name.isEmpty ? "A hero" : player.character.name)
        portrait = player.character.portraitURL
        isMe = player.playerId == me
        hp = points
        maxHp = max(fight?.maxHp ?? live?.standing.maxHp ?? sheet?.maxHp ?? 1, 1)
        armorClass = live?.standing.armorClass ?? sheet?.armorClass ?? 10

        if let fight {
            conditions = fight.conditions
        } else {
            var seen = Set<String>()
            var carried: [HudCondition] = []
            for condition in (live?.conditions ?? []) + (live?.standing.conditions.map(\.condition) ?? []) {
                let key = condition.lowercased()
                if !key.isEmpty, seen.insert(key).inserted {
                    carried.append(HudCondition(id: key, label: SRD.name(condition)))
                }
            }
            conditions = carried
        }
        isNow = fight != nil && hud?.now == player.playerId
        isNext = fight != nil && hud?.next == player.playerId && hud?.now != player.playerId

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
        PartyMember(id: playerId, name: "Hero", portrait: nil, isMe: true,
                    hp: 0, maxHp: 1, armorClass: 10, conditions: [], turn: .idle)
    }
}

// MARK: - The heads-up display

/// The party, pinned over the game, in one of two shapes.
///
/// Closed, it is a slim row: the player's own hero, and everyone else as health rings. Pulled down
/// or tapped, the row unfolds into a compact card: every hero as a chip with their ring, hit points,
/// armour class and conditions, and in a fight the foes as chips of their own, with whoever acts
/// now and whoever is next marked. A fight pulls the card down by itself, since that is where the
/// foes are, and its end puts it away; the player can push it up to give the story the room.
///
/// The card takes its own room: what follows it (the Act bar, the tab) moves down. Nobody is on the
/// screen twice: open, the card stands in the row's place.
struct PartyHUD: View {
    @Bindable var session: GameSession
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// Pulled down. `-hudOpen YES` or `NO` holds it so (screenshot checks).
    @State private var open: Bool

    init(session: GameSession) {
        self.session = session
        _open = State(initialValue: AppConfig.hudOpenArgument ?? (session.state.scene?.combat == true))
    }

    private var state: GameState { session.state }
    private var inCombat: Bool { state.scene?.combat == true }

    var body: some View {
        let party = PartyMember.party(of: state, me: session.playerId)
        let mine = party.first(where: \.isMe) ?? .stranger(session.playerId)
        let others = party.filter { !$0.isMe }
        let line = turnLine
        // One over the other while they change places, so the display is never both heights at once.
        ZStack(alignment: .top) {
            if open {
                let sides = sides([mine] + others)
                PartyCard(heroes: sides.heroes, foes: sides.foes, round: round, turnLine: line, set: set)
                    .transition(reduceMotion ? .opacity : .opacity.combined(with: .scale(scale: 0.94, anchor: .top)))
            } else {
                Button {
                    set(true)
                } label: {
                    PartyBar(me: mine, others: others)
                        // A glance, not a page: the row's words stop growing at the first accessibility size.
                        .dynamicTypeSize(...DynamicTypeSize.accessibility1)
                }
                .buttonStyle(.plain)
                .highPriorityGesture(HUDPull.gesture(set))
                .accessibilityLabel("Party: " + ([mine] + others).map(\.spoken).joined(separator: ", "))
                .accessibilityValue(status(of: mine, line: line))
                .accessibilityHint("Shows everyone")
                .transition(.opacity)
            }
        }
        .frame(maxWidth: .infinity)
        .clipped()
        // Its own room only: a colour that ran on under the navigation bar would take the row's
        // accessibility frame up there with it.
        .background(Palette.ink, ignoresSafeAreaEdges: [])
        .onChange(of: inCombat) { _, fighting in
            if AppConfig.hudOpenArgument == nil { set(fighting) }
        }
    }

    /// The card's two sides. In a fight each is in initiative order, so a chip keeps its place as
    /// the turn moves; outside one there are no foes, and the player's own hero comes first.
    private func sides(_ party: [PartyMember]) -> (heroes: [PartyMember], foes: [TurnRing]) {
        guard inCombat, let hud = state.rules?.combat?.hud else { return (party, []) }
        let order = TurnRow(hud: hud, me: session.playerId).inOrder
        var place: [String: Int] = [:]
        for (index, ring) in order.enumerated() { place[ring.id] = index }
        let heroes = party.enumerated()
            .sorted { ($0.element.id.place(in: place), $0.offset) < ($1.element.id.place(in: place), $1.offset) }
            .map(\.element)
        return (heroes, order.filter { !$0.isHero })
    }

    private func set(_ wanted: Bool) {
        guard wanted != open else { return }
        withAnimation(reduceMotion ? .easeOut(duration: 0.15) : .spring(duration: 0.3, bounce: 0.1)) {
            open = wanted
        }
    }

    private var round: Int? {
        inCombat ? state.rules?.combat?.round : nil
    }

    /// What VoiceOver adds after the party: the player's own armour and conditions, the round, the turn.
    private func status(of mine: PartyMember, line: String) -> String {
        var parts = ["Armour class \(mine.armorClass)"]
        parts += mine.conditions.map(\.spoken)
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
        if session.state.status == .voting { return Self.choose }
        return "Holding"
    }
}

extension PartyHUD {
    /// The table is taking this hero's choice. Not "your turn": in a fight everyone chooses at once,
    /// and the card marks whose turn comes first when the round is played out.
    static let choose = "Choose your action"
}

private extension String {
    /// Where this id comes in an order; anyone the order does not name goes last.
    func place(in order: [String: Int]) -> Int { order[self] ?? Int.max }
}

private enum HUDMetrics {
    /// The widest the card gets, as the story under it does.
    static let column: CGFloat = 720
}

/// A pull on the row or the card: down opens, up closes. It acts as soon as the finger has gone
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

private enum HUDFont {
    /// The small words: 11 points at the default text size, and growing with it.
    static let small = Font.serif(.caption2, weight: .semibold)
}

// MARK: - The row

/// The slim row: the player's hero in a ring, their name over their numbers, and everyone else as
/// rings on the right. Whose turn it is belongs to the Act bar under it and to the card; a tick on
/// a ring says who has chosen.
///
/// The rings are as large as the row allows: 34 points with few heroes, 30 with a full table. When
/// one row does not hold everything (larger text, a long name, conditions), the numbers go to a
/// line of their own under it, and only then do the name and the rings give way, a step at a time.
private struct PartyBar: View {
    let me: PartyMember
    let others: [PartyMember]
    /// The player's own ring grows with the words beside it: 38 to 42 points.
    @ScaledMetric(relativeTo: .caption) private var scaled: CGFloat = 38
    private var own: CGFloat { min(max(scaled, 38), 42) }
    /// The footnote style's size, for the name when it is drawn smaller.
    @ScaledMetric(relativeTo: .footnote) private var nameSize: CGFloat = 13

    var body: some View {
        ViewThatFits(in: .horizontal) {
            oneRow(ring: 34)
            oneRow(ring: 30)
            twoLines(ring: 30)
            twoLines(ring: 30, nameShare: 0.86)
            twoLines(ring: 28)
            twoLines(ring: 28, nameShare: 0.86)
            twoLines(ring: 26, nameShare: 0.86)
            twoLines(ring: 24, nameShare: 0.86)
            twoLines(ring: 22, nameShare: 0.86, wraps: true)
        }
        .padding(.horizontal, 12)
        .padding(.top, 4)
        .padding(.bottom, 10)
        .frame(maxWidth: .infinity)
        .overlay(alignment: .bottom) { HUDGrabber().padding(.bottom, 2.5) }
        .contentShape(.rect)
    }

    /// Everything at its own width, so `ViewThatFits` can tell whether it fits.
    private func oneRow(ring: CGFloat) -> some View {
        HStack(spacing: 0) {
            RingAvatar(member: me, size: own)
            VStack(alignment: .leading, spacing: 1) {
                name()
                vitals
            }
            .lineLimit(1)
            .fixedSize()
            .padding(.leading, 8)
            Spacer(minLength: 10)
            party(ring)
        }
    }

    /// The name and the rings, then the numbers under them with the whole width to wrap in. The
    /// last arrangement lets the name wrap as well, so nothing is ever cut short.
    private func twoLines(ring: CGFloat, nameShare: CGFloat = 1, wraps: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 0) {
                RingAvatar(member: me, size: own)
                name(nameShare)
                    .lineLimit(wraps ? nil : 1)
                    .fixedSize(horizontal: !wraps, vertical: true)
                    .frame(maxWidth: wraps ? .infinity : nil, alignment: .leading)
                    .padding(.leading, 8)
                if !wraps { Spacer(minLength: 10) }
                party(ring).padding(.leading, wraps ? 10 : 0)
            }
            vitals.fixedSize(horizontal: false, vertical: true)
        }
    }

    /// The hero's name, or the same at a share of its size. The size follows the footnote style
    /// either way, so it grows with the system text size.
    private func name(_ share: CGFloat = 1) -> some View {
        Text(me.name)
            .font(share == 1 ? .serif(.footnote, weight: .bold) : .system(size: nameSize * share, weight: .bold, design: .serif))
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
        let names = me.conditions.map { $0.label.replacingOccurrences(of: " ", with: gap) }.joined(separator: ", ")
        let carried = Text(names.isEmpty ? "" : "  \(names)").foregroundStyle(Palette.ember)
        return Text("\(heart)\(gap)\(points)  \(armour)\(carried)")
            .font(HUDFont.small)
            .monospacedDigit()
            .multilineTextAlignment(.leading)
    }

    @ViewBuilder private func party(_ size: CGFloat) -> some View {
        if !others.isEmpty {
            HStack(spacing: size >= 30 ? 5 : 4) {
                ForEach(others) { RingAvatar(member: $0, size: size) }
            }
            .fixedSize()
        }
    }
}

// MARK: - A hero in a ring

/// A hero's portrait, or their initials, inside a ring as full as their hit points, with a dark
/// gap between the two so the ring reads as a ring. A hero who is down is dimmed and marked with
/// an arrow, a fallen one with a cross; one who has chosen this turn, with a tick.
struct RingAvatar: View {
    let member: PartyMember
    var size: CGFloat = 30

    var body: some View {
        let face = size - 2 * RingGauge.line(size) - 3
        ZStack {
            RingGauge(gauge: .health(Double(member.fraction)), tint: member.tint, size: size,
                      track: member.standing ? RingGauge.track : member.tint.opacity(0.7))
            portrait(face)
                .saturation(member.standing ? 1 : 0)
                .opacity(member.standing ? 1 : 0.5)
        }
        .frame(width: size, height: size)
        .overlay(alignment: .bottomTrailing) { mark }
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
        }
    }

    /// Nothing for a hero still to choose: a mark means done, or out of the fight. It sits on the
    /// ring's lower corner, small, so it hides as little of the ring as it can.
    @ViewBuilder private var mark: some View {
        if member.turn != .waiting, let symbol = member.turn.symbol {
            let side = max(9, size * 0.36)
            Image(systemName: symbol)
                .font(.system(size: side, weight: .bold))
                .foregroundStyle(member.turn == .fallen ? Palette.parchment : member.turn.tint)
                .background { Circle().fill(Palette.ink).padding(-1) }
                .offset(x: side * 0.34, y: side * 0.2)
        }
    }
}

// MARK: - The card

/// Everyone at once, in little room: the heroes as chips, then the fight's foes as chips. Its words
/// grow with the system text size as far as the second large size; past that the card would take
/// the screen from the story, which is what it is here to avoid.
private struct PartyCard: View {
    let heroes: [PartyMember]
    let foes: [TurnRing]
    let round: Int?
    let turnLine: String
    /// Opens or closes the display: a push up anywhere on the card closes it.
    var set: (Bool) -> Void

    private func close() { set(false) }

    var body: some View {
        VStack(spacing: 0) {
            header
            VStack(spacing: 7) {
                HUDChipGrid {
                    ForEach(heroes) { HeroChip(member: $0) }
                }
                if !foes.isEmpty {
                    Rectangle().fill(Palette.gold.opacity(0.18)).frame(height: 1)
                    HUDChipGrid {
                        ForEach(foes) { FoeChip(ring: $0) }
                    }
                }
            }
            .padding(.horizontal, 10)
            .contentShape(.rect)
            .gesture(HUDPull.gesture(set))
            Button(action: close) {
                HUDGrabber()
                    .padding(.top, 7)
                    .padding(.bottom, 5)
                    .frame(maxWidth: .infinity)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .highPriorityGesture(HUDPull.gesture(set))
            .accessibilityHidden(true)
        }
        .dynamicTypeSize(...DynamicTypeSize.xxLarge)
        .frame(maxWidth: HUDMetrics.column)
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .contain)
        .accessibilityAction(.escape, close)
    }

    /// The round and the turn, and the way back up: the whole line closes the card.
    private var header: some View {
        Button(action: close) {
            HStack(alignment: .firstTextBaseline, spacing: 5) {
                if let round {
                    Text("Round \(round)").foregroundStyle(Palette.gold)
                    Text("·").foregroundStyle(Palette.muted)
                }
                Text(turnLine)
                    .foregroundStyle(turnLine == PartyHUD.choose || turnLine == "Throw your die" ? Palette.gold : Palette.muted)
                Spacer(minLength: 8)
                Image(systemName: "chevron.up")
                    .font(.system(.caption2, weight: .bold))
                    .foregroundStyle(Palette.muted)
            }
            .font(HUDFont.small)
            .lineLimit(1)
            .padding(.horizontal, 14)
            .padding(.top, 5)
            .padding(.bottom, 8)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .highPriorityGesture(HUDPull.gesture(set))
        .accessibilityLabel("Close the party")
        .accessibilityValue((round.map { "Round \($0), " } ?? "") + turnLine)
    }
}

/// Chips in equal columns, as many as fit, each row as tall as its tallest chip. The narrowest a
/// chip may be does not grow with the text size: three still fit across a phone, and the words in
/// them make room by stacking.
private struct HUDChipGrid: Layout {
    var narrowest: CGFloat = 104
    var widest: CGFloat = 190
    var spacing: CGFloat = 6

    private func columns(in width: CGFloat) -> (count: Int, width: CGFloat) {
        guard width.isFinite, width > narrowest else { return (1, max(width.isFinite ? width : narrowest, 1)) }
        let count = max(1, Int((width + spacing) / (narrowest + spacing)))
        return (count, min(widest, (width - CGFloat(count - 1) * spacing) / CGFloat(count)))
    }

    private func rows(_ subviews: Subviews, columns: (count: Int, width: CGFloat)) -> [CGFloat] {
        stride(from: 0, to: subviews.count, by: columns.count).map { start in
            subviews[start..<min(start + columns.count, subviews.count)]
                .map { $0.sizeThatFits(ProposedViewSize(width: columns.width, height: nil)).height }
                .max() ?? 0
        }
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? CGFloat(max(subviews.count, 1)) * (narrowest + spacing) - spacing
        let heights = rows(subviews, columns: columns(in: width))
        return CGSize(width: width, height: heights.reduce(0, +) + CGFloat(max(heights.count - 1, 0)) * spacing)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let grid = columns(in: bounds.width)
        var y = bounds.minY
        for (row, height) in rows(subviews, columns: grid).enumerated() {
            for column in 0..<grid.count {
                let index = row * grid.count + column
                guard index < subviews.count else { break }
                subviews[index].place(at: CGPoint(x: bounds.minX + CGFloat(column) * (grid.width + spacing), y: y),
                                      anchor: .topLeading,
                                      proposal: ProposedViewSize(width: grid.width, height: height))
            }
            y += height + spacing
        }
    }
}

/// A chip's frame: the ring, the words beside it, the conditions under both, and the turn's tag on
/// its corner. Whoever acts now is outlined in gold.
private struct Chip<Ring: View, Words: View>: View {
    var isNow = false
    var isNext = false
    var isOut = false
    var conditions: [HudCondition] = []
    @ViewBuilder var ring: Ring
    @ViewBuilder var words: Words

    private var shape: RoundedRectangle { RoundedRectangle(cornerRadius: 9, style: .continuous) }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                ring
                VStack(alignment: .leading, spacing: 0) { words }
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            // At its own height whatever the row is given: a word squeezed for height shrinks.
            .fixedSize(horizontal: false, vertical: true)
            if !conditions.isEmpty {
                FlowLayout(spacing: 3, lineSpacing: 3) {
                    ForEach(conditions) { ConditionBadge(condition: $0, squeezes: true) }
                }
            }
        }
        .opacity(isOut ? 0.55 : 1)
        .padding(.horizontal, 6)
        .padding(.vertical, 5)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Palette.surface, in: shape)
        .overlay {
            shape.strokeBorder(isNow ? Palette.gold : Palette.gold.opacity(0.14), lineWidth: isNow ? 1.25 : 0.75)
        }
        .shadow(color: isNow ? Palette.gold.opacity(0.35) : .clear, radius: 5)
        .overlay(alignment: .topTrailing) {
            Group {
                if isNow {
                    TurnTag(text: "Now", prominent: true)
                } else if isNext {
                    TurnTag(text: "Next", prominent: false)
                }
            }
            .offset(x: -7, y: -5)
        }
    }
}

private struct HeroChip: View {
    let member: PartyMember
    @ScaledMetric(relativeTo: .caption2) private var scaled: CGFloat = 32

    var body: some View {
        Chip(isNow: member.isNow, isNext: member.isNext, isOut: !member.standing, conditions: member.conditions) {
            RingAvatar(member: member, size: min(scaled, 34))
        } words: {
            Text(member.shortName)
                .font(.serif(.caption, weight: .bold))
                .foregroundStyle(member.isMe ? Palette.gold : member.standing ? Palette.parchment : Palette.muted)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
            numbers
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(member.spokenInFull)
    }

    /// "12/12  AC 16" on one line while it fits; with larger text, one over the other.
    private var numbers: some View {
        let points = Text(member.standing ? "\(member.hp)/\(member.maxHp)" : (member.turn.word ?? "Down"))
            .foregroundStyle(member.standing && member.hp * 2 > member.maxHp ? Palette.parchment : Palette.ember)
        let armour = Text("AC\u{00A0}\(member.armorClass)").foregroundStyle(Palette.muted)
        return ViewThatFits(in: .horizontal) {
            Text("\(points)  \(armour)")
            VStack(alignment: .leading, spacing: 0) {
                points
                armour
            }
        }
        .font(HUDFont.small)
        .monospacedDigit()
        .lineLimit(1)
    }
}

private struct FoeChip: View {
    let ring: TurnRing
    @ScaledMetric(relativeTo: .caption2) private var scaled: CGFloat = 32
    /// The caption style's size, for a name drawn a little smaller.
    @ScaledMetric(relativeTo: .caption) private var nameSize: CGFloat = 12

    var body: some View {
        Chip(isNow: ring.isNow, isNext: ring.isNext, isOut: ring.isOut, conditions: ring.conditions) {
            FoeRing(ring: ring, size: min(scaled, 34))
        } words: {
            // On one line; if not, a little smaller; a long name ("Goblin Archer 2") on two.
            ViewThatFits(in: .horizontal) {
                Text(ring.name).font(.serif(.caption, weight: .bold)).lineLimit(1)
                Text(ring.name).font(.system(size: nameSize * 0.84, weight: .bold, design: .serif)).lineLimit(1)
                Text(ring.name).font(.serif(.caption, weight: .bold)).lineLimit(2).minimumScaleFactor(0.8)
            }
            .foregroundStyle(ring.isOut ? Palette.muted : Palette.parchment)
            .multilineTextAlignment(.leading)
            Text(ring.caption)
                .font(HUDFont.small)
                .foregroundStyle(ring.isOut ? Palette.muted : ring.tone.color)
                .lineLimit(1)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(ring.spoken)
    }
}
