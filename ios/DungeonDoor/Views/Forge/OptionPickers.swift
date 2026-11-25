import SwiftUI

/// Cards for races and classes: a name, a symbol, a line of lore.
struct OptionGrid: View {
    let options: [CatalogOption]
    @Binding var selection: String
    var columns = 2

    var body: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: columns), spacing: 10) {
            ForEach(options) { option in
                let selected = option.id == selection
                Button {
                    withAnimation(.snappy) { selection = option.id }
                } label: {
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(spacing: 8) {
                            if let symbol = option.symbol {
                                Image(systemName: symbol).foregroundStyle(Palette.gold)
                            }
                            Text(option.name).font(.display(16))
                            Spacer(minLength: 0)
                            if selected {
                                Image(systemName: "checkmark.seal.fill").foregroundStyle(Palette.gold)
                            }
                        }
                        if let blurb = option.blurb {
                            Text(blurb)
                                .font(.caption)
                                .foregroundStyle(Palette.muted)
                                .lineLimit(3)
                                .multilineTextAlignment(.leading)
                        }
                    }
                    .frame(maxWidth: .infinity, minHeight: 64, alignment: .topLeading)
                    .padding(12)
                    .card(highlighted: selected)
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selected ? .isSelected : [])
            }
        }
    }
}

/// Compact pills for short lists (gender, temperament, alignment).
struct ChipPicker: View {
    let options: [CatalogOption]
    @Binding var selection: String
    var minWidth: CGFloat = 96

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: minWidth), spacing: 8)], spacing: 8) {
            ForEach(options) { option in
                let selected = option.id == selection
                Button {
                    withAnimation(.snappy) { selection = option.id }
                } label: {
                    Text(option.name)
                        .font(.system(.subheadline, design: .serif, weight: selected ? .semibold : .regular))
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                        .frame(maxWidth: .infinity, minHeight: 40)
                        .padding(.horizontal, 8)
                        .foregroundStyle(selected ? Palette.ink : Palette.parchment)
                        .background(selected ? Palette.gold : Palette.surface, in: .capsule)
                        .overlay { Capsule().strokeBorder(Palette.gold.opacity(selected ? 0 : 0.3)) }
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selected ? .isSelected : [])
            }
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
