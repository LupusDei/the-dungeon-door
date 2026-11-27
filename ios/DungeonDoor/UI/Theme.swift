import SwiftUI

/// Candlelit manuscript: warm near-black, parchment text, gilt edges, an ember for danger.
enum Palette {
    static let ink = Color(hex: "#0F0B08")
    static let inkGlow = Color(hex: "#3A2414")
    static let surface = Color(hex: "#1C1510")
    static let raised = Color(hex: "#2A2018")
    static let parchment = Color(hex: "#EADBC0")
    static let muted = Color(hex: "#A8957A")
    static let gold = Color(hex: "#D9A649")
    static let ember = Color(hex: "#C4552B")
    static let verdigris = Color(hex: "#6FA898")
}

extension Font {
    static func display(_ size: CGFloat, weight: Font.Weight = .semibold) -> Font {
        .system(size: size, weight: weight, design: .serif)
    }
    /// A serif face in a text style, so it grows and shrinks with Dynamic Type.
    static func serif(_ style: Font.TextStyle, weight: Font.Weight = .regular) -> Font {
        .system(style, design: .serif, weight: weight)
    }
    static let prose = Font.system(.body, design: .serif)
    static let proseSmall = Font.system(.subheadline, design: .serif)
}

extension Color {
    init(hex: String) {
        var value: UInt64 = 0
        Scanner(string: hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))).scanHexInt64(&value)
        self.init(red: Double((value >> 16) & 0xFF) / 255,
                  green: Double((value >> 8) & 0xFF) / 255,
                  blue: Double(value & 0xFF) / 255)
    }
}

/// The warm room behind every screen.
struct Backdrop: View {
    var body: some View {
        ZStack {
            Palette.ink
            RadialGradient(colors: [Palette.inkGlow.opacity(0.9), .clear],
                           center: .init(x: 0.5, y: -0.05), startRadius: 10, endRadius: 520)
        }
        .ignoresSafeArea()
    }
}

struct CardModifier: ViewModifier {
    var highlighted = false
    func body(content: Content) -> some View {
        content
            .background(highlighted ? Palette.raised : Palette.surface, in: .rect(cornerRadius: 14))
            .overlay {
                RoundedRectangle(cornerRadius: 14)
                    .strokeBorder(Palette.gold.opacity(highlighted ? 0.9 : 0.22), lineWidth: highlighted ? 1.5 : 1)
            }
    }
}

extension View {
    func card(highlighted: Bool = false) -> some View { modifier(CardModifier(highlighted: highlighted)) }

    func screenChrome() -> some View {
        // Fill the screen first: a background is only as large as the view it sits behind, and a
        // narrow screen (a title and a spinner) would leave bare black at its sides.
        self.frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Backdrop())
            .toolbarBackground(Palette.ink, for: .navigationBar)
            .foregroundStyle(Palette.parchment)
    }
}

struct SectionLabel: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        // The caption style is 12 points at the default text size and grows with it. A heading in
        // spaced capitals gets wide fast, so it stops growing at the second accessibility size.
        Text(text.uppercased())
            .font(.system(.caption, design: .serif, weight: .semibold))
            .tracking(2.2)
            .foregroundStyle(Palette.gold)
            .fixedSize(horizontal: false, vertical: true)
            .dynamicTypeSize(...DynamicTypeSize.accessibility2)
    }
}

struct GildedButtonStyle: ButtonStyle {
    var prominent = true
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.display(17))
            .tracking(0.6)
            .frame(maxWidth: .infinity, minHeight: 52)
            .padding(.horizontal, 16)
            .foregroundStyle(prominent ? Palette.ink : Palette.gold)
            .background {
                if prominent {
                    LinearGradient(colors: [Color(hex: "#F0C66B"), Palette.gold, Color(hex: "#A87A2C")],
                                   startPoint: .top, endPoint: .bottom)
                } else {
                    Palette.surface
                }
            }
            .clipShape(.rect(cornerRadius: 12))
            .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(Palette.gold.opacity(prominent ? 0 : 0.6)) }
            .opacity(isEnabled ? (configuration.isPressed ? 0.75 : 1) : 0.4)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

/// A secondary button made of smoked glass, for use over artwork.
struct GlassButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.display(17))
            .tracking(0.6)
            .frame(maxWidth: .infinity, minHeight: 52)
            .padding(.horizontal, 16)
            .foregroundStyle(Palette.gold)
            .glassCard(cornerRadius: 12)
            .opacity(isEnabled ? (configuration.isPressed ? 0.7 : 1) : 0.4)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

extension ButtonStyle where Self == GlassButtonStyle {
    static var glass: GlassButtonStyle { GlassButtonStyle() }
}

extension ButtonStyle where Self == GildedButtonStyle {
    static var gilded: GildedButtonStyle { GildedButtonStyle() }
    static var gildedOutline: GildedButtonStyle { GildedButtonStyle(prominent: false) }
}

/// A character portrait, or their class sigil while there isn't one yet. A painted portrait opens
/// full screen when tapped; the sigil (no picture yet) does not.
///
/// `opensViewer: false` leaves the tap to whatever the portrait sits in: on a tile that opens the
/// hero's page, the picture is part of the tile, and it is on that page that a tap shows it large.
struct PortraitView: View {
    let url: URL?
    var symbol: String = "person.fill"
    var size: CGFloat = 64
    var circular = false
    var opensViewer = true

    var body: some View {
        let shape = circular ? AnyShape(Circle()) : AnyShape(RoundedRectangle(cornerRadius: size * 0.16))
        AsyncImage(url: url, transaction: Transaction(animation: .easeIn(duration: 0.4))) { phase in
            switch phase {
            case .success(let image):
                image.resizable().scaledToFill()
            default:
                ZStack {
                    Palette.raised
                    Image(systemName: symbol)
                        .font(.system(size: size * 0.38))
                        .foregroundStyle(Palette.gold.opacity(0.7))
                }
            }
        }
        .frame(width: size, height: size)
        .clipShape(shape)
        .overlay { shape.stroke(Palette.gold.opacity(0.55), lineWidth: 1) }
        .generatedImageViewer(url: opensViewer ? url : nil, title: "Portrait")
    }
}

/// A wide illustration that holds its space while the art is still being painted. Once it has a
/// picture, a tap opens that picture full screen.
struct IllustrationView: View {
    let url: URL?
    var aspect: CGFloat = 4 / 3
    var paintingLabel = "The scene is being painted…"

    var body: some View {
        Color.clear
            .aspectRatio(aspect, contentMode: .fit)
            .overlay {
                AsyncImage(url: url, transaction: Transaction(animation: .easeIn(duration: 0.6))) { phase in
                    if case .success(let image) = phase {
                        image.resizable().scaledToFill()
                    } else {
                        ZStack {
                            LinearGradient(colors: [Palette.raised, Palette.surface], startPoint: .top, endPoint: .bottom)
                            VStack(spacing: 10) {
                                ProgressView().tint(Palette.gold)
                                Text(url == nil ? paintingLabel : "Unrolling the canvas…")
                                    .font(.proseSmall.italic())
                                    .foregroundStyle(Palette.muted)
                            }
                        }
                    }
                }
            }
            .clipShape(.rect(cornerRadius: 14))
            .overlay { RoundedRectangle(cornerRadius: 14).strokeBorder(Palette.gold.opacity(0.3)) }
            .generatedImageViewer(url: url, title: "Scene")
    }
}

/// A d20 result. Natural 20s glow gold, natural 1s burn.
struct D20Badge: View {
    let roll: Int?
    var size: CGFloat = 34

    var body: some View {
        if let roll {
            badge(roll)
        }
    }

    private func badge(_ roll: Int) -> some View {
        let tint = roll == 20 ? Palette.gold : roll == 1 ? Palette.ember : Palette.parchment
        ZStack {
            Hexagon().fill(Palette.raised)
            Hexagon().stroke(tint, lineWidth: 1.5)
            Text("\(roll)")
                .font(.system(size: size * 0.42, weight: .bold, design: .serif))
                .foregroundStyle(tint)
        }
        .frame(width: size, height: size)
        .shadow(color: roll == 20 ? Palette.gold.opacity(0.7) : .clear, radius: 8)
        .accessibilityLabel("Rolled \(roll)")
    }
}

/// A d20 turning while the dungeon master writes the next turn. With Reduce Motion it holds still.
struct TumblingD20: View {
    var size: CGFloat = 72
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: reduceMotion)) { context in
            let lap = context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 1.8) / 1.8
            ZStack {
                Hexagon().fill(Palette.raised)
                Hexagon().stroke(Palette.gold, lineWidth: max(1.5, size * 0.028))
                Text("20")
                    .font(.system(size: size * 0.32, weight: .bold, design: .serif))
                    .foregroundStyle(Palette.gold)
            }
            .rotationEffect(.degrees(reduceMotion ? 0 : lap * 360))
            .shadow(color: Palette.gold.opacity(reduceMotion ? 0.25 : 0.45), radius: 10)
        }
        .frame(width: size, height: size)
        .accessibilityLabel("A die is rolling")
    }
}

struct Hexagon: Shape {
    func path(in rect: CGRect) -> Path {
        let w = rect.width, h = rect.height
        return Path { p in
            p.move(to: CGPoint(x: w * 0.5, y: 0))
            p.addLine(to: CGPoint(x: w, y: h * 0.25))
            p.addLine(to: CGPoint(x: w, y: h * 0.75))
            p.addLine(to: CGPoint(x: w * 0.5, y: h))
            p.addLine(to: CGPoint(x: 0, y: h * 0.75))
            p.addLine(to: CGPoint(x: 0, y: h * 0.25))
            p.closeSubpath()
        }
    }
}

/// The arched door that gives the game its name. Shut, or swung into the room on its left-hand hinge.
///
/// The leaf is drawn by its own geometry (`DoorSwing`) and clipped by the frame, the way a wall hides
/// what is behind it, so an open door always fits its doorway. `open` animates.
struct DoorMark: View {
    var open = false
    private var amount: Double { open ? 1 : 0 }

    var body: some View {
        GeometryReader { geo in
            ZStack {
                // The dark beyond, and torchlight spilling out across the threshold.
                ArchShape().fill(Color.black)
                RadialGradient(colors: [Palette.gold.opacity(open ? 0.85 : 0), .clear],
                               center: .bottom, startRadius: 2, endRadius: geo.size.height * 0.9)
                DoorLeafShape(amount: amount)
                    .fill(LinearGradient(colors: [Color(hex: "#5A3A22"), Color(hex: "#34200F")],
                                         startPoint: .leading, endPoint: .trailing))
                DoorLeafDetail(amount: amount).stroke(Color.black.opacity(0.35), lineWidth: 1.5)
                DoorLeafDetail(amount: amount, ring: true).stroke(Palette.gold, lineWidth: 2)
            }
            .clipShape(ArchShape())
            .overlay { ArchShape().stroke(Palette.gold.opacity(0.8), lineWidth: 2) }
        }
        .aspectRatio(0.66, contentMode: .fit)
    }
}

/// Where each point of the door leaf is seen once it has swung into the room: hinged on the left jamb,
/// turned by up to `widest`, and looked at by someone standing in front of the doorway.
struct DoorSwing {
    let size: CGSize
    /// 0 shut … 1 as far open as it goes.
    let amount: Double

    static let widest = Angle.degrees(64)
    /// How far away the eye is, in door widths, and where on the door it looks.
    private static let distance = 2.4
    private static let eye = UnitPoint(x: 0.5, y: 0.56)

    /// The point (u, v) of the shut door (u across from the hinge, v down), as seen.
    func point(_ u: CGFloat, _ v: CGFloat) -> CGPoint {
        let angle = Self.widest.radians * amount
        let across = u * cos(angle)
        let depth = u * sin(angle) / size.width
        let scale = Self.distance / (Self.distance + depth)
        let cx = size.width * Self.eye.x, cy = size.height * Self.eye.y
        return CGPoint(x: cx + (across - cx) * scale, y: cy + (v - cy) * scale)
    }

    /// The top of the arched leaf at u.
    func top(_ u: CGFloat) -> CGFloat {
        let r = size.width / 2
        return r - sqrt(max(0, r * r - (r - u) * (r - u)))
    }
}

/// The outline of the leaf.
struct DoorLeafShape: Shape {
    var amount: Double
    var animatableData: Double {
        get { amount }
        set { amount = newValue }
    }

    func path(in rect: CGRect) -> Path {
        let swing = DoorSwing(size: rect.size, amount: amount)
        let steps = 40
        return Path { p in
            p.move(to: swing.point(0, rect.height))
            for i in 0...steps {
                let u = rect.width * CGFloat(i) / CGFloat(steps)
                p.addLine(to: swing.point(u, swing.top(u)))
            }
            p.addLine(to: swing.point(rect.width, rect.height))
            p.closeSubpath()
        }
    }
}

/// What the leaf carries: the joins between its planks, or the iron ring by its free edge.
struct DoorLeafDetail: Shape {
    var amount: Double
    var ring = false
    var animatableData: Double {
        get { amount }
        set { amount = newValue }
    }

    func path(in rect: CGRect) -> Path {
        let swing = DoorSwing(size: rect.size, amount: amount)
        let w = rect.width, h = rect.height
        return Path { p in
            if ring {
                let centre = CGPoint(x: w * 0.80, y: h * 0.58), radius = w * 0.06
                for i in 0...28 {
                    let a = Double(i) / 28 * 2 * .pi
                    let q = swing.point(centre.x + radius * cos(a), centre.y + radius * sin(a))
                    if i == 0 { p.move(to: q) } else { p.addLine(to: q) }
                }
                p.closeSubpath()
            } else {
                for u in [0.2, 0.4, 0.6, 0.8].map({ w * $0 }) {
                    p.move(to: swing.point(u, swing.top(u)))
                    p.addLine(to: swing.point(u, h))
                }
            }
        }
    }
}

struct ArchShape: Shape {
    func path(in rect: CGRect) -> Path {
        let r = rect.width / 2
        return Path { p in
            p.move(to: CGPoint(x: rect.minX, y: rect.maxY))
            p.addLine(to: CGPoint(x: rect.minX, y: rect.minY + r))
            p.addArc(center: CGPoint(x: rect.midX, y: rect.minY + r), radius: r,
                     startAngle: .degrees(180), endAngle: .degrees(0), clockwise: false)
            p.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
            p.closeSubpath()
        }
    }
}

/// Error line shown under forms and in game screens.
struct ErrorLine: View {
    let text: String?
    var body: some View {
        if let text {
            Label(text, systemImage: "exclamationmark.triangle.fill")
                .font(.footnote)
                .foregroundStyle(Palette.ember)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}
