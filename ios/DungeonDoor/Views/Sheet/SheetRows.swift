import SwiftUI

/// One line of a hero sheet. Every tab is made of these, so they all read the same way: a title on
/// the left (with small tags and an optional muted second line), the number that matters on the
/// right, and a chevron when a tap explains the rule.
struct SheetRow: Identifiable {
    /// The proficiency dot in front of a title.
    enum Marker { case none, off, on }

    struct Tag: Hashable {
        var text: String
        var tint: Color = Palette.muted
    }

    let id: String
    var marker: Marker = .none
    var title: String
    /// Semibold: something the hero is trained in.
    var strong = false
    var tags: [Tag] = []
    var subtitle: String?
    /// The number people act on: a bonus, a DC, a count.
    var value: String?
    /// Small words under the value ("to hit").
    var valueNote: String?
    /// Draws the value as a gilt pill.
    var pill = false
    /// Uses of something that runs out (spell slots, Second Wind): what is left, of how many.
    var pips: Pips?
    /// What VoiceOver says, as a sentence. Nil reads the parts in order.
    var spoken: String?
    /// The rule a tap opens, if any.
    var detail: RuleDetail?
}

/// What is left of something that is spent and comes back: a filled pip for each use left, a dim
/// one for each spent.
struct Pips: Hashable {
    var left: Int
    var max: Int
}

struct PipsView: View {
    let pips: Pips
    var tint: Color = Palette.gold
    var size: CGFloat = 11

    var body: some View {
        if (1...8).contains(pips.max) {
            HStack(spacing: 4) {
                ForEach(0..<pips.max, id: \.self) { index in
                    let spent = index >= pips.left
                    Circle()
                        .fill(spent ? Color.clear : tint)
                        .overlay { Circle().strokeBorder(tint.opacity(spent ? 0.35 : 1), lineWidth: 1) }
                        .frame(width: size, height: size)
                }
            }
            .accessibilityHidden(true)
        } else {
            // A pool too deep for pips (Lay On Hands, Sorcery Points): numbers.
            HStack(alignment: .firstTextBaseline, spacing: 1) {
                Text("\(pips.left)").font(.serif(.title3, weight: .bold)).foregroundStyle(pips.left > 0 ? tint : Palette.muted)
                Text("/\(pips.max)").font(.serif(.footnote, weight: .semibold)).foregroundStyle(Palette.muted)
            }
            .monospacedDigit()
            .accessibilityHidden(true)
        }
    }
}

/// A card of rows with hairlines between them.
struct SheetRowGroup: View {
    let rows: [SheetRow]
    var open: (RuleDetail) -> Void = { _ in }

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                if index > 0 {
                    Rectangle()
                        .fill(Palette.gold.opacity(0.14))
                        .frame(height: 1)
                        .padding(.leading, 14)
                }
                SheetRowView(row: row, open: open)
            }
        }
        .card()
    }
}

struct SheetRowView: View {
    let row: SheetRow
    var open: (RuleDetail) -> Void = { _ in }

    var body: some View {
        if let detail = row.detail {
            Button {
                open(detail)
            } label: {
                content(tappable: true)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(spoken)
            .accessibilityHint("Explains the rule")
        } else {
            content(tappable: false)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(spoken)
        }
    }

    private var spoken: String {
        if let spoken = row.spoken { return spoken }
        var parts = [row.title]
        parts += row.tags.map(\.text)
        if let subtitle = row.subtitle { parts.append(subtitle) }
        if let value = row.value { parts.append([value, row.valueNote].compactMap { $0 }.joined(separator: " ")) }
        if let pips = row.pips { parts.append("\(pips.left) of \(pips.max) left") }
        return parts.joined(separator: ", ")
    }

    private func content(tappable: Bool) -> some View {
        HStack(alignment: .center, spacing: 10) {
            if row.marker != .none {
                Image(systemName: row.marker == .on ? "circle.fill" : "circle")
                    .font(.system(size: 7))
                    .foregroundStyle(row.marker == .on ? Palette.gold : Palette.muted.opacity(0.7))
                    .frame(width: 10)
            }
            VStack(alignment: .leading, spacing: 3) {
                // Tags sit beside the title while there is room, and drop beneath it when there isn't.
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        title
                        tags
                    }
                    VStack(alignment: .leading, spacing: 4) {
                        title
                        tags
                    }
                }
                if let subtitle = row.subtitle, !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.serif(.footnote))
                        .foregroundStyle(Palette.muted)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 8)
            if let pips = row.pips {
                VStack(alignment: .trailing, spacing: 3) {
                    PipsView(pips: pips)
                    if let note = row.valueNote {
                        Text(note).font(.serif(.caption2)).foregroundStyle(Palette.muted)
                    }
                }
            }
            if let value = row.value { valueView(value) }
            if tappable {
                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Palette.muted.opacity(0.7))
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 9)
        .frame(maxWidth: .infinity, minHeight: 46, alignment: .leading)
        .contentShape(.rect)
    }

    private var title: some View {
        Text(row.title)
            .font(.serif(.body, weight: row.strong ? .semibold : .regular))
            .foregroundStyle(row.strong ? Palette.parchment : Palette.parchment.opacity(0.9))
            .multilineTextAlignment(.leading)
            .fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder private var tags: some View {
        if !row.tags.isEmpty {
            HStack(spacing: 4) {
                ForEach(row.tags, id: \.self) { TagLabel($0.text, tint: $0.tint) }
            }
        }
    }

    @ViewBuilder private func valueView(_ value: String) -> some View {
        if row.pill {
            VStack(spacing: 0) {
                Text(value)
                    .font(.serif(.title3, weight: .bold))
                    .monospacedDigit()
                    .foregroundStyle(Palette.gold)
                if let note = row.valueNote {
                    Text(note.uppercased())
                        .font(.serif(.caption2, weight: .semibold))
                        .tracking(0.8)
                        .foregroundStyle(Palette.muted)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 4)
            .background(Palette.raised, in: .rect(cornerRadius: 10))
            .overlay { RoundedRectangle(cornerRadius: 10).strokeBorder(Palette.gold.opacity(0.5), lineWidth: 1) }
        } else {
            VStack(alignment: .trailing, spacing: 0) {
                Text(value)
                    .font(.serif(.title3, weight: row.strong ? .bold : .semibold))
                    .monospacedDigit()
                    .foregroundStyle(row.strong ? Palette.gold : Palette.parchment)
                if let note = row.valueNote {
                    Text(note)
                        .font(.serif(.caption2))
                        .foregroundStyle(Palette.muted)
                }
            }
        }
    }
}

/// A block of the player's or the dungeon master's own words, under a section label.
struct SheetProse: View {
    let text: String
    var italic = false

    var body: some View {
        Text(text)
            .font(italic ? .serif(.body).italic() : .serif(.body))
            .lineSpacing(3)
            .frame(maxWidth: .infinity, alignment: .leading)
            .fixedSize(horizontal: false, vertical: true)
            .padding(14)
            .card()
    }
}
