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

/// The colour of the engine's words for how hard a foe or a fight is: calm for what the party should
/// win ("puny", "weak", a "low" fight), gold for an even match ("even", "moderate"), ember for what
/// may kill ("strong", "high", "deadly"). A word the app doesn't know is drawn in ember.
enum Danger {
    static func tint(_ word: String?) -> Color {
        switch word?.lowercased() {
        case "puny", "weak", "low": Palette.verdigris
        case "even", "moderate": Palette.gold
        default: Palette.ember
        }
    }
}

/// A hit-point bar. The caller picks the tint; `Health.tint` has the party's colours.
struct HPBar: View {
    /// How full, 0 to 1.
    let fraction: CGFloat
    var tint: Color = Palette.verdigris
    var height: CGFloat = 6
    /// A foe's fuzzy gauge: its end fades out instead of stopping sharp, so it reads as an impression.
    var soft = false

    init(hp: Int, maxHp: Int, tint: Color = Palette.verdigris, height: CGFloat = 6) {
        self.init(fraction: maxHp > 0 ? Double(hp) / Double(maxHp) : 0, tint: tint, height: height)
    }

    init(fraction: Double, tint: Color = Palette.verdigris, height: CGFloat = 6, soft: Bool = false) {
        self.fraction = CGFloat(min(1, max(0, fraction.isFinite ? fraction : 0)))
        self.tint = tint
        self.height = height
        self.soft = soft
    }

    /// The length over which a soft bar's end fades.
    private static let fade: CGFloat = 16

    var body: some View {
        GeometryReader { geo in
            let width = geo.size.width * fraction
            ZStack(alignment: .leading) {
                Capsule(style: .circular).fill(Color.black.opacity(0.45))
                if soft && fraction < 1 {
                    let reach = min(geo.size.width, width + Self.fade / 2)
                    Capsule(style: .circular)
                        .fill(LinearGradient(stops: [
                            .init(color: tint, location: 0),
                            .init(color: tint, location: max(0, (reach - Self.fade) / max(reach, 1))),
                            .init(color: tint.opacity(0), location: 1),
                        ], startPoint: .leading, endPoint: .trailing))
                        .frame(width: reach)
                        .blur(radius: 0.8)
                } else {
                    Capsule(style: .circular).fill(tint).frame(width: width)
                }
            }
        }
        .frame(height: height)
        .overlay { Capsule(style: .circular).strokeBorder(Palette.gold.opacity(0.18), lineWidth: 0.5) }
        .animation(.easeOut(duration: 0.5), value: fraction)
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
