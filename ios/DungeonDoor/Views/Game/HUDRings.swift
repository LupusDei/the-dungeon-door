import SwiftUI

/// What the heads-up display (PartyHUD.swift) is drawn with: the ring round a combatant, a foe's
/// face inside one, the Now and Next tags, and a condition as a badge.
///
/// Colour is never the only signal: tiers, turns and conditions are all words as well.

/// The ring itself: an arc filled with a hero's hit points, or four segments lit by a foe's tier.
struct RingGauge: View {
    let gauge: TurnRing.Gauge
    let tint: Color
    let size: CGFloat
    /// The band under the arc. A hero who is down has no arc, so theirs is drawn in their own grey.
    var track: Color = RingGauge.track

    /// Clear of the dark page behind it, so an emptied ring still reads as a ring.
    static let track = Color.white.opacity(0.22)

    /// How thick the band is: a tenth of the ring, and never under 3 points.
    static func line(_ size: CGFloat) -> CGFloat { max(3, size * 0.105) }

    var body: some View {
        let line = Self.line(size)
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

/// A foe: its initials inside four segments for its tier. The server never sends a foe's hit points.
struct FoeRing: View {
    let ring: TurnRing
    var size: CGFloat = 32

    var body: some View {
        let face = size - 2 * RingGauge.line(size) - 3
        ZStack {
            RingGauge(gauge: ring.gauge, tint: ring.tone.color, size: size)
            ZStack {
                Circle().fill(Color(hex: "#3A1E14"))
                Text(ring.initials)
                    .font(.system(size: face * 0.42, weight: .bold, design: .serif))
                    .foregroundStyle(Color(hex: "#E79A7C"))
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
            }
            .frame(width: face, height: face)
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// "NOW" in gold, or "NEXT" quietly, on the corner of whoever it is.
struct TurnTag: View {
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

extension TurnRing.Tone {
    var color: Color {
        switch self {
        case .healthy: Palette.verdigris
        case .hurt: Palette.gold
        case .wounded: Palette.ember
        case .fallen: Health.fallen
        }
    }
}

/// One condition: its icon and its word. In a narrow place (`squeezes`) the word shrinks, then is
/// cut short, instead of running out of its box.
struct ConditionBadge: View {
    let condition: HudCondition
    var squeezes = false

    var body: some View {
        HStack(spacing: 2) {
            Image(systemName: condition.symbol)
                .font(.system(.caption2, weight: .semibold))
                .imageScale(.small)
            Text(condition.label)
                .font(.system(.caption2, design: .serif, weight: .semibold))
                .lineLimit(1)
                .minimumScaleFactor(squeezes ? 0.7 : 1)
                .fixedSize(horizontal: !squeezes, vertical: true)
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
