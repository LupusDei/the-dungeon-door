import SwiftUI

/// The fight at a glance, pinned under the act bar on every tab while a fight is on: one row of
/// rings in turn order, heroes and foes together, starting from whoever acts now; those before them
/// follow a round marker, dimmed, since they come up again next round. A hero's ring fills with their
/// hit points, with the numbers under it; a foe's ring is four segments for its tier, with the tier's
/// word under it (the server never sends a foe's hit points). The one acting now is larger, ringed
/// in gold and tagged Now; whoever is up after them has a dashed outline and a Next tag. Under the
/// row, what holds each of them, in words.
///
/// Colour is never the only signal: tiers, turns and conditions are all words as well. The words grow
/// with the reader's text size up to the first accessibility size: past that the row would take the
/// screen from the story.
struct CombatHUD: View {
    let hud: CombatHud
    /// The caller's player id: their own hero's name is in gold.
    let me: String
    /// The round being fought, for the marker before those who act again next round.
    var round: Int? = nil
    /// Heroes' portraits by player id; a ring without one shows initials.
    var portraits: [String: URL] = [:]

    var body: some View {
        let row = TurnRow(hud: hud, me: me)
        return VStack(alignment: .leading, spacing: 5) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 2) {
                    ForEach(row.upcoming) { ring in
                        TurnRingCell(ring: ring, portrait: portraits[ring.id])
                    }
                    if !row.later.isEmpty {
                        RoundMarker(round: round.map { $0 + 1 })
                        ForEach(row.later) { ring in
                            TurnRingCell(ring: ring, portrait: portraits[ring.id]).opacity(0.65)
                        }
                    }
                }
                .padding(.horizontal, 12)
                .padding(.top, 9)
            }
            conditionLine(row.all.filter { !$0.conditions.isEmpty })
        }
        .padding(.vertical, 4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.ink)
        .dynamicTypeSize(...DynamicTypeSize.accessibility1)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Turn order")
    }

    /// Each held combatant's name and its conditions as badges. VoiceOver hears them on the rings.
    @ViewBuilder private func conditionLine(_ held: [TurnRing]) -> some View {
        if !held.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(held) { ring in
                        HStack(spacing: 3) {
                            Text(ring.shortName)
                                .font(.system(.caption2, design: .serif, weight: .semibold))
                                .foregroundStyle(Palette.muted)
                                .lineLimit(1)
                                .fixedSize()
                            ForEach(ring.conditions) { condition in ConditionBadge(condition: condition) }
                        }
                    }
                }
                .padding(.horizontal, 12)
            }
            .accessibilityHidden(true)
        }
    }
}

/// One combatant: the ring and the face inside it, the name and the caption under it.
private struct TurnRingCell: View {
    let ring: TurnRing
    let portrait: URL?
    @ScaledMetric(relativeTo: .caption2) private var base: CGFloat = 40

    var body: some View {
        let size = ring.isNow ? base * 1.25 : base
        return VStack(spacing: 2) {
            ZStack {
                RingGauge(gauge: ring.gauge, tint: ring.tone.color, size: size)
                face(size * 0.76)
            }
            .frame(width: size, height: size)
            .overlay { turnOutline }
            .overlay(alignment: .topTrailing) { conditionDots }
            .overlay(alignment: .top) { turnTag.offset(y: -10) }
            Text(ring.shortName)
                .font(.system(ring.isNow ? .caption : .caption2, design: .serif, weight: .bold))
                .foregroundStyle(ring.isNow || ring.isMe ? Palette.gold : Palette.parchment)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Text(ring.caption)
                .font(.system(.caption2, design: .serif, weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(ring.isOut ? Palette.muted : ring.tone.color)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .frame(width: size + 16)
        .opacity(ring.isOut ? 0.5 : 1)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(ring.spoken)
    }

    @ViewBuilder private func face(_ side: CGFloat) -> some View {
        if ring.isHero, let portrait {
            PortraitView(url: portrait, size: side, circular: true, opensViewer: false)
                .saturation(ring.isOut ? 0 : 1)
        } else {
            ZStack {
                Circle().fill(ring.isHero ? Palette.raised : Color(hex: "#3A1E14"))
                Text(ring.initials)
                    .font(.system(size: side * 0.38, weight: .bold, design: .serif))
                    .foregroundStyle(ring.isHero ? Palette.gold : Color(hex: "#E79A7C"))
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
            }
            .frame(width: side, height: side)
        }
    }

    @ViewBuilder private var turnOutline: some View {
        if ring.isNow {
            Circle()
                .strokeBorder(Palette.gold, lineWidth: 1.5)
                .padding(-3)
                .shadow(color: Palette.gold.opacity(0.8), radius: 6)
        } else if ring.isNext {
            Circle()
                .strokeBorder(Palette.gold.opacity(0.55), style: StrokeStyle(lineWidth: 1.2, dash: [3, 3]))
                .padding(-3)
        }
    }

    @ViewBuilder private var turnTag: some View {
        if ring.isNow {
            TurnTag(text: "Now", prominent: true)
        } else if ring.isNext {
            TurnTag(text: "Next", prominent: false)
        }
    }

    /// Up to two condition icons on the ring's shoulder; the words are in the line under the row.
    @ViewBuilder private var conditionDots: some View {
        if !ring.conditions.isEmpty {
            VStack(spacing: 1) {
                ForEach(ring.conditions.prefix(2)) { condition in
                    Image(systemName: condition.symbol)
                        .font(.system(size: 7, weight: .bold))
                        .foregroundStyle(condition.tint)
                        .frame(width: 14, height: 14)
                        .background(Palette.ink, in: Circle())
                        .overlay { Circle().strokeBorder(condition.tint, lineWidth: 0.75) }
                }
            }
            .offset(x: 5, y: -2)
        }
    }
}

/// The ring itself: an arc filled with a hero's hit points, or four segments lit by a foe's tier.
private struct RingGauge: View {
    let gauge: TurnRing.Gauge
    let tint: Color
    let size: CGFloat

    var body: some View {
        let line = max(2.5, size * 0.08)
        let track = Color.white.opacity(0.14)
        return ZStack {
            switch gauge {
            case .health(let fraction):
                Circle().stroke(track, lineWidth: line)
                Circle()
                    .trim(from: 0, to: CGFloat(fraction))
                    .stroke(tint, style: StrokeStyle(lineWidth: line, lineCap: .round))
                    .rotationEffect(.degrees(-90))
            case .tier(let lit):
                ForEach(0..<TurnRing.segments, id: \.self) { index in
                    Circle()
                        .trim(from: CGFloat(index) / CGFloat(TurnRing.segments) + 0.02,
                              to: CGFloat(index + 1) / CGFloat(TurnRing.segments) - 0.02)
                        .stroke(index < lit ? tint : track, style: StrokeStyle(lineWidth: line, lineCap: .butt))
                        .rotationEffect(.degrees(-90))
                }
            }
        }
        .padding(line / 2)
        .frame(width: size, height: size)
        .animation(.easeOut(duration: 0.5), value: gauge)
        .accessibilityHidden(true)
    }
}

/// "NOW" in gold, or "NEXT" quietly, over the top of a ring.
private struct TurnTag: View {
    let text: String
    let prominent: Bool

    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 8, weight: .heavy))
            .tracking(0.6)
            .foregroundStyle(prominent ? Palette.ink : Palette.muted)
            .padding(.horizontal, 4)
            .padding(.vertical, 1)
            .background(prominent ? Palette.gold : Palette.surface, in: Capsule())
            .overlay { Capsule().strokeBorder(prominent ? Color.clear : Palette.muted.opacity(0.5), lineWidth: 0.75) }
            .fixedSize()
            .accessibilityHidden(true)
    }
}

/// Between this round's turns and the next round's: those after it act again once the round turns.
private struct RoundMarker: View {
    let round: Int?

    var body: some View {
        VStack(spacing: 3) {
            Rectangle().fill(Palette.gold.opacity(0.35)).frame(width: 1, height: 14)
            Text(round.map { "R\($0)" } ?? "Then")
                .font(.system(size: 8, weight: .heavy))
                .foregroundStyle(Palette.gold.opacity(0.8))
                .fixedSize()
            Rectangle().fill(Palette.gold.opacity(0.35)).frame(width: 1, height: 14)
        }
        .padding(.horizontal, 3)
        .padding(.top, 4)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(round.map { "Round \($0)" } ?? "Next round")
    }
}

private extension TurnRing.Tone {
    var color: Color {
        switch self {
        case .healthy: Palette.verdigris
        case .hurt: Palette.gold
        case .wounded: Palette.ember
        case .fallen: Health.fallen
        }
    }
}

/// One condition: its icon and its word.
struct ConditionBadge: View {
    let condition: HudCondition

    var body: some View {
        HStack(spacing: 2) {
            Image(systemName: condition.symbol)
                .font(.system(.caption2, weight: .semibold))
                .imageScale(.small)
            Text(condition.label)
                .font(.system(.caption2, design: .serif, weight: .semibold))
                .lineLimit(1)
                .fixedSize()
        }
        .foregroundStyle(condition.tint)
        .padding(.horizontal, 4)
        .padding(.vertical, 1.5)
        .background(condition.tint.opacity(0.14), in: Capsule(style: .circular))
        .overlay { Capsule(style: .circular).strokeBorder(condition.tint.opacity(0.45), lineWidth: 0.5) }
        .accessibilityHidden(true)
    }
}

extension HudCondition {
    /// An SF Symbol for the condition; one the app doesn't know is a dot.
    var symbol: String {
        switch id {
        case "asleep": "zzz"
        case "unconscious": "moon.fill"
        case "incapacitated": "pause.circle.fill"
        case "paralyzed": "lock.fill"
        case "stunned": "sparkles"
        case "petrified": "mountain.2.fill"
        case "prone": "arrow.down.to.line"
        case "restrained", "grappled": "link"
        case "blinded": "eye.slash.fill"
        case "deafened": "speaker.slash.fill"
        case "charmed": "heart.fill"
        case "frightened": "exclamationmark.triangle.fill"
        case "poisoned": "drop.fill"
        case "invisible": "circle.dashed"
        case "exhaustion": "battery.25"
        case "concentrating": "brain.head.profile"
        case "dodging": "shield.lefthalf.filled"
        default: "circle.fill"
        }
    }

    /// Calm for what the hero does (concentrating, dodging); gold for what holds them.
    var tint: Color {
        switch id {
        case "concentrating", "dodging": Palette.verdigris
        default: Palette.gold
        }
    }
}
