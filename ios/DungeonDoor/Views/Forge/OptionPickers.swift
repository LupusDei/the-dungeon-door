import SwiftUI

/// Cards for races, classes and backgrounds: a name, a symbol, a line of lore.
///
/// Every card shows its whole description: nothing is cut to a line count. Cards in a row are as tall
/// as the tallest of them, and at the larger text sizes the grid goes to one card across, so a
/// description keeps a readable measure.
struct OptionGrid: View {
    let options: [CatalogOption]
    @Binding var selection: String
    var columns = 2
    @Environment(\.dynamicTypeSize) private var typeSize

    /// Cards across: the asked-for count, or one once the text is large.
    private var across: Int { typeSize >= .xxLarge ? 1 : max(columns, 1) }

    private var rows: [[CatalogOption]] {
        stride(from: 0, to: options.count, by: across).map { Array(options[$0..<min($0 + across, options.count)]) }
    }

    var body: some View {
        Grid(horizontalSpacing: 10, verticalSpacing: 10) {
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                GridRow {
                    ForEach(row) { card($0) }
                    // A last row with fewer cards keeps the columns' width.
                    ForEach(row.count..<across, id: \.self) { _ in
                        Color.clear.frame(maxWidth: .infinity).frame(height: 0)
                    }
                }
            }
        }
    }

    private func card(_ option: CatalogOption) -> some View {
        let selected = option.id == selection
        return Button {
            withAnimation(.snappy) { selection = option.id }
        } label: {
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    if let symbol = option.symbol {
                        Image(systemName: symbol).foregroundStyle(Palette.gold)
                    }
                    Text(option.name)
                        .font(.serif(.headline, weight: .semibold))
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                    if selected {
                        Image(systemName: "checkmark.seal.fill").foregroundStyle(Palette.gold)
                    }
                }
                if let blurb = option.blurb, !blurb.isEmpty {
                    Text(blurb)
                        .font(across == 1 ? .footnote : .caption)
                        .foregroundStyle(Palette.muted)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let abilities = option.abilities, !abilities.isEmpty {
                    // A background's abilities: the three scores it can raise.
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: 5) {
                            Text("Can raise").font(.caption2).foregroundStyle(Palette.muted)
                            ForEach(abilities, id: \.self) { TagLabel(SRD.ability($0)) }
                        }
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Can raise").font(.caption2).foregroundStyle(Palette.muted)
                            HStack(spacing: 5) { ForEach(abilities, id: \.self) { TagLabel(SRD.ability($0)) } }
                        }
                    }
                    .padding(.top, 2)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("Can raise " + abilities.map(SRD.abilityName).joined(separator: ", "))
                }
            }
            .frame(maxWidth: .infinity, minHeight: 64, maxHeight: .infinity, alignment: .topLeading)
            .padding(12)
            .card(highlighted: selected)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// Compact pills for short lists (gender, temperament, alignment).
///
/// The narrowest a chip may be grows with the text size, so larger text gets fewer, wider chips
/// instead of names cut short. At the accessibility sizes a name may also run to a second line.
struct ChipPicker: View {
    let options: [CatalogOption]
    @Binding var selection: String
    var minWidth: CGFloat = 96
    @Environment(\.dynamicTypeSize) private var typeSize
    /// 100 at the default text size, more as the chips' text style grows.
    @ScaledMetric(relativeTo: .subheadline) private var percent: CGFloat = 100

    var body: some View {
        ChipGrid(minWidth: minWidth * percent / 100) {
            ForEach(options) { option in
                let selected = option.id == selection
                Button {
                    withAnimation(.snappy) { selection = option.id }
                } label: {
                    Text(option.name)
                        .font(.system(.subheadline, design: .serif, weight: selected ? .semibold : .regular))
                        .lineLimit(typeSize.isAccessibilitySize ? nil : 1)
                        .minimumScaleFactor(0.8)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .frame(maxWidth: .infinity, minHeight: 40, maxHeight: .infinity)
                        .foregroundStyle(selected ? Palette.ink : Palette.parchment)
                        .background(selected ? Palette.gold : Palette.surface, in: .rect(cornerRadius: 24))
                        .overlay { RoundedRectangle(cornerRadius: 24).strokeBorder(Palette.gold.opacity(selected ? 0 : 0.3)) }
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selected ? .isSelected : [])
            }
        }
    }
}

/// Equal columns, as many as fit at `minWidth`, with every chip in a row as tall as the tallest
/// (a lazy grid leaves a one-line chip short beside a two-line one).
struct ChipGrid: Layout {
    var minWidth: CGFloat
    var spacing: CGFloat = 8

    private struct Plan {
        var cell: CGFloat
        var rows: [(range: Range<Int>, height: CGFloat)]
        var height: CGFloat
    }

    private func plan(width: CGFloat, subviews: Subviews) -> Plan {
        let across = max(1, Int((width + spacing) / (max(minWidth, 1) + spacing)))
        let cell = max(0, (width - spacing * CGFloat(across - 1)) / CGFloat(across))
        var rows: [(range: Range<Int>, height: CGFloat)] = []
        var start = 0
        while start < subviews.count {
            let end = min(start + across, subviews.count)
            let tallest = subviews[start..<end].map { $0.sizeThatFits(ProposedViewSize(width: cell, height: nil)).height }.max() ?? 0
            rows.append((start..<end, tallest))
            start = end
        }
        let height = rows.reduce(0) { $0 + $1.height } + spacing * CGFloat(max(rows.count - 1, 0))
        return Plan(cell: cell, rows: rows, height: height)
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width.flatMap { $0.isFinite ? $0 : nil } ?? 320
        return CGSize(width: width, height: plan(width: width, subviews: subviews).height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let plan = plan(width: bounds.width, subviews: subviews)
        var y = bounds.minY
        for row in plan.rows {
            for (column, index) in row.range.enumerated() {
                let x = bounds.minX + CGFloat(column) * (plan.cell + spacing)
                subviews[index].place(at: CGPoint(x: x, y: y), anchor: .topLeading,
                                      proposal: ProposedViewSize(width: plan.cell, height: row.height))
            }
            y += row.height + spacing
        }
    }
}

/// The blurb under a chip picker, so temperament choices still carry their flavour.
struct SelectedBlurb: View {
    let options: [CatalogOption]
    let selection: String
    var body: some View {
        if let blurb = options.first(where: { $0.id == selection })?.blurb {
            Text(blurb)
                .font(.footnote.italic())
                .foregroundStyle(Palette.muted)
                .fixedSize(horizontal: false, vertical: true)
                .transition(.opacity)
        }
    }
}

/// A multi-line field styled like the rest of the forge.
struct ParchmentEditor: View {
    let prompt: String
    @Binding var text: String
    var limit = 600

    var body: some View {
        VStack(alignment: .trailing, spacing: 4) {
            ZStack(alignment: .topLeading) {
                if text.isEmpty {
                    Text(prompt)
                        .font(.prose.italic())
                        .foregroundStyle(Palette.muted.opacity(0.7))
                        .padding(.horizontal, 5)
                        .padding(.vertical, 8)
                        .allowsHitTesting(false)
                }
                TextEditor(text: $text)
                    .font(.prose)
                    .scrollContentBackground(.hidden)
                    .frame(minHeight: 120)
                    .returnIsDone($text)
                    .onChange(of: text) { _, new in
                        if new.count > limit { text = String(new.prefix(limit)) }
                    }
            }
            .padding(8)
            .card()
            Text("\(text.count)/\(limit)")
                .font(.caption2.monospacedDigit())
                .foregroundStyle(Palette.muted)
        }
    }
}
