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
        self.background(Backdrop())
            .toolbarBackground(Palette.ink, for: .navigationBar)
            .foregroundStyle(Palette.parchment)
    }
}

struct SectionLabel: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 12, weight: .semibold, design: .serif))
            .tracking(2.2)
            .foregroundStyle(Palette.gold)
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

/// A character portrait, or their class sigil while there isn't one yet.
struct PortraitView: View {
    let url: URL?
    var symbol: String = "person.fill"
    var size: CGFloat = 64
    var circular = false

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
    }
}

/// A wide illustration that holds its space while the art is still being painted.
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
    }
}

/// A d20 result. Natural 20s glow gold, natural 1s burn.
struct D20Badge: View {
    let roll: Int
    var size: CGFloat = 34

    var body: some View {
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

/// The arched door that gives the game its name.
struct DoorMark: View {
    var open = false

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width, h = geo.size.height
            ZStack {
                ArchShape().fill(Color.black)
                    .overlay(alignment: .bottom) {
                        // Torchlight spilling out from behind the door.
                        RadialGradient(colors: [Palette.gold.opacity(open ? 0.85 : 0.0), .clear],
                                       center: .bottom, startRadius: 2, endRadius: h * 0.9)
                            .clipShape(ArchShape())
                    }
                ArchShape()
                    .fill(LinearGradient(colors: [Color(hex: "#5A3A22"), Color(hex: "#3B2515")],
                                         startPoint: .leading, endPoint: .trailing))
                    .overlay {
                        HStack(spacing: w * 0.05) {
                            ForEach(0..<4, id: \.self) { _ in
                                Rectangle().fill(Color.black.opacity(0.35)).frame(width: 1.5)
                                Spacer(minLength: 0)
                            }
                        }
                        .padding(.horizontal, w * 0.12)
                        .clipShape(ArchShape())
                    }
                    .overlay(alignment: .trailing) {
                        Circle().stroke(Palette.gold, lineWidth: 2)
                            .frame(width: w * 0.12, height: w * 0.12)
                            .padding(.trailing, w * 0.14)
                            .offset(y: h * 0.08)
                    }
                    .rotation3DEffect(.degrees(open ? -68 : 0), axis: (x: 0, y: 1, z: 0),
                                      anchor: .leading, perspective: 0.5)
                ArchShape().stroke(Palette.gold.opacity(0.8), lineWidth: 2)
            }
        }
        .aspectRatio(0.66, contentMode: .fit)
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
