import SwiftUI

/// Lays its children out left to right and wraps onto new lines, like words on a page.
struct FlowLayout: Layout {
    var spacing: CGFloat = 6
    var lineSpacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        arrange(width: proposal.width ?? .infinity, subviews: subviews).size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let arrangement = arrange(width: bounds.width, subviews: subviews)
        for (index, frame) in arrangement.frames.enumerated() {
            subviews[index].place(at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY),
                                  proposal: ProposedViewSize(frame.size))
        }
    }

    private func arrange(width: CGFloat, subviews: Subviews) -> (frames: [CGRect], size: CGSize) {
        var frames: [CGRect] = []
        var x: CGFloat = 0, y: CGFloat = 0, lineHeight: CGFloat = 0, widest: CGFloat = 0
        for subview in subviews {
            var size = subview.sizeThatFits(.unspecified)
            if size.width > width { size = subview.sizeThatFits(ProposedViewSize(width: width, height: nil)) }
            if x > 0 && x + size.width > width {
                x = 0
                y += lineHeight + lineSpacing
                lineHeight = 0
            }
            frames.append(CGRect(origin: CGPoint(x: x, y: y), size: size))
            widest = max(widest, x + size.width)
            x += size.width + spacing
            lineHeight = max(lineHeight, size.height)
        }
        return (frames, CGSize(width: widest, height: y + lineHeight))
    }
}

// Stroked capsules here are `.circular`: the default continuous corners leave small ticks at the
// ends of a thin outline.

/// A small-caps tag: a skill check on a choice, a condition on a foe, a background's abilities.
struct TagLabel: View {
    let text: String
    var tint: Color = Palette.verdigris

    init(_ text: String, tint: Color = Palette.verdigris) {
        self.text = text
        self.tint = tint
    }

    var body: some View {
        Text(text.uppercased())
            .font(.system(.caption2, design: .serif, weight: .semibold))
            .tracking(1.1)
            .lineLimit(1)
            .foregroundStyle(tint)
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(tint.opacity(0.14), in: Capsule(style: .circular))
            .overlay { Capsule(style: .circular).strokeBorder(tint.opacity(0.45), lineWidth: 0.75) }
    }
}

/// A hit-point bar. The caller picks the tint; `Health.tint` has the party's colours.
struct HPBar: View {
    let hp: Int
    let maxHp: Int
    var tint: Color = Palette.verdigris
    var height: CGFloat = 6

    private var fraction: CGFloat {
        guard maxHp > 0 else { return 0 }
        return min(1, max(0, CGFloat(hp) / CGFloat(maxHp)))
    }

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule(style: .circular).fill(Color.black.opacity(0.45))
                Capsule(style: .circular).fill(tint).frame(width: geo.size.width * fraction)
            }
        }
        .frame(height: height)
        .overlay { Capsule(style: .circular).strokeBorder(Palette.gold.opacity(0.18), lineWidth: 0.5) }
        .animation(.easeOut(duration: 0.5), value: hp)
        .accessibilityHidden(true)
    }
}

/// The colours of a hero's health: verdigris when hale, ember at half or below, grey once down.
enum Health {
    static let fallen = Color(hex: "#6E655A")

    static func tint(hp: Int, maxHp: Int, standing: Bool = true) -> Color {
        if !standing || hp <= 0 { return fallen }
        return hp * 2 <= maxHp ? Palette.ember : Palette.verdigris
    }
}
