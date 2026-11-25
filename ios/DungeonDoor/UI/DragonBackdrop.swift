import AVFoundation
import SwiftUI

/// The home screen's living background: the old dragon flies in and lands on his summit once per
/// launch ("dragon-return"), then sits watching in a seamless loop ("dragon-watcher").
/// With Reduce Motion on, it's a still painting of the same frame.
struct DragonBackdrop: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    /// False while something covers the home screen, so the players rest.
    var playing = true

    var body: some View {
        // Sized by the screen, never by the artwork: the painting and video fill and are clipped,
        // nudged down a little so the dragon's head sits clear of the title above it.
        GeometryReader { geo in
            ZStack {
                Image("DragonPerch")
                    .resizable()
                    .scaledToFill()
                    .frame(width: geo.size.width, height: geo.size.height)
                    .clipped()
                if !reduceMotion {
                    DragonVideoView(playing: playing && scenePhase == .active)
                }
            }
            .frame(width: geo.size.width, height: geo.size.height)
            // Feather the top edge so the shifted picture melts into the night above it.
            .mask(LinearGradient(stops: [.init(color: .clear, location: 0),
                                         .init(color: .black, location: 0.16),
                                         .init(color: .black, location: 1)],
                                 startPoint: .top, endPoint: .bottom))
            .offset(y: geo.size.height * 0.06)
        }
        .background(Color.black)
        .clipped()
        .ignoresSafeArea()
        .accessibilityHidden(true)
    }
}

private struct DragonVideoView: UIViewRepresentable {
    let playing: Bool

    func makeUIView(context: Context) -> DragonPlayerView { DragonPlayerView() }

    func updateUIView(_ view: DragonPlayerView, context: Context) {
        view.setPlaying(playing)
    }

    static func dismantleUIView(_ view: DragonPlayerView, coordinator: ()) {
        view.setPlaying(false)
    }
}

/// Two stacked video layers: the watcher loop underneath, and the one-time arrival on top, which
/// fades away when it ends to reveal the loop already sitting on the same frame.
final class DragonPlayerView: UIView {
    /// The arrival plays once per app launch, not every time the home screen reappears.
    private static var arrivalShown = false

    private let loopPlayer = AVQueuePlayer()
    private var looper: AVPlayerLooper?
    private let loopLayer = AVPlayerLayer()

    private var arrivalPlayer: AVPlayer?
    private var arrivalLayer: AVPlayerLayer?
    private var arrivalObserver: NSObjectProtocol?

    private var wantsPlayback = false

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .clear
        isUserInteractionEnabled = false

        if let url = Bundle.main.url(forResource: "dragon-watcher", withExtension: "mp4") {
            configure(loopPlayer)
            looper = AVPlayerLooper(player: loopPlayer, templateItem: AVPlayerItem(url: url))
            loopLayer.player = loopPlayer
            loopLayer.videoGravity = .resizeAspectFill
            layer.addSublayer(loopLayer)
        }

        if !Self.arrivalShown, let url = Bundle.main.url(forResource: "dragon-return", withExtension: "mp4") {
            let item = AVPlayerItem(url: url)
            let player = AVPlayer(playerItem: item)
            configure(player)
            player.actionAtItemEnd = .pause
            let top = AVPlayerLayer(player: player)
            top.videoGravity = .resizeAspectFill
            layer.addSublayer(top)
            arrivalPlayer = player
            arrivalLayer = top
            arrivalObserver = NotificationCenter.default.addObserver(
                forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main
            ) { [weak self] _ in
                self?.finishArrival()
            }
        }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    deinit {
        if let arrivalObserver { NotificationCenter.default.removeObserver(arrivalObserver) }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        loopLayer.frame = bounds
        arrivalLayer?.frame = bounds
        CATransaction.commit()
    }

    func setPlaying(_ playing: Bool) {
        wantsPlayback = playing
        guard playing else {
            loopPlayer.pause()
            arrivalPlayer?.pause()
            return
        }
        if let arrivalPlayer {
            arrivalPlayer.play()
        } else {
            loopPlayer.play()
        }
    }

    private func configure(_ player: AVPlayer) {
        // Silent scenery: never take over the audio session or keep the screen awake.
        player.isMuted = true
        player.preventsDisplaySleepDuringVideoPlayback = false
        player.allowsExternalPlayback = false
    }

    private func finishArrival() {
        Self.arrivalShown = true
        if wantsPlayback { loopPlayer.play() }
        let leaving = arrivalLayer
        arrivalPlayer = nil
        arrivalLayer = nil
        CATransaction.begin()
        CATransaction.setAnimationDuration(0.6)
        CATransaction.setCompletionBlock { leaving?.removeFromSuperlayer() }
        leaving?.opacity = 0
        CATransaction.commit()
    }
}

/// Embers and arcane motes drifting up through the scene. Drawn in one Canvas; every particle's
/// path is a pure function of time, so there's no state to keep and nothing to leak.
struct EmberField: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var count = 64

    private struct Mote {
        let x: Double        // 0–1 start column
        let speed: Double    // screen heights per second
        let phase: Double    // 0–1 offset into its climb
        let sway: Double     // horizontal wander, in points
        let swayRate: Double
        let size: Double
        let arcane: Bool     // the rare blue ones
        let twinkle: Double
    }

    private let motes: [Mote]

    init(count: Int = 64) {
        self.count = count
        var rng = SeededGenerator(seed: 0xD4A60)
        motes = (0..<count).map { _ in
            Mote(x: .random(in: 0...1, using: &rng),
                 speed: .random(in: 0.018...0.07, using: &rng),
                 phase: .random(in: 0...1, using: &rng),
                 sway: .random(in: 6...34, using: &rng),
                 swayRate: .random(in: 0.25...0.9, using: &rng),
                 size: .random(in: 1.0...3.2, using: &rng),
                 arcane: Double.random(in: 0...1, using: &rng) < 0.22,
                 twinkle: .random(in: 0.6...2.4, using: &rng))
        }
    }

    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 30, paused: reduceMotion)) { timeline in
            Canvas { context, size in
                let t = timeline.date.timeIntervalSinceReferenceDate
                context.blendMode = .plusLighter
                for mote in motes {
                    let life = (t * mote.speed + mote.phase).truncatingRemainder(dividingBy: 1)
                    let y = size.height * (1.08 - life * 1.16)
                    let x = mote.x * size.width + sin(t * mote.swayRate + mote.phase * 20) * mote.sway
                    // Fade in from the bottom, out toward the top, and flicker on the way.
                    let fade = sin(life * .pi)
                    let flicker = 0.65 + 0.35 * sin(t * mote.twinkle * 3 + mote.phase * 40)
                    let alpha = fade * flicker * (mote.arcane ? 0.9 : 0.8)
                    let core = mote.arcane ? Color(hex: "#8FD3FF") : Color(hex: "#FFC56B")
                    let halo = mote.arcane ? Color(hex: "#3B7BFF") : Color(hex: "#FF7A2E")
                    let glow = mote.size * 3.6
                    let rect = CGRect(x: x - glow, y: y - glow, width: glow * 2, height: glow * 2)
                    context.fill(
                        Path(ellipseIn: rect),
                        with: .radialGradient(
                            Gradient(stops: [
                                .init(color: core.opacity(alpha), location: 0),
                                .init(color: halo.opacity(alpha * 0.35), location: 0.25),
                                .init(color: .clear, location: 1),
                            ]),
                            center: CGPoint(x: x, y: y), startRadius: 0, endRadius: glow))
                }
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

/// A tiny deterministic generator so the ember field looks the same on every launch.
private struct SeededGenerator: RandomNumberGenerator {
    private var state: UInt64
    init(seed: UInt64) { state = seed }
    mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }
}

/// Gilded lettering with a slow glint of light passing across it.
struct GlintingTitle: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let text: String
    var size: CGFloat = 46
    @State private var sweep = false

    var body: some View {
        let label = Text(text)
            .font(.display(size, weight: .bold))
            .lineLimit(1)
            .minimumScaleFactor(0.6)
        label
            .foregroundStyle(
                LinearGradient(colors: [Color(hex: "#FFE9B0"), Color(hex: "#E9B95A"), Color(hex: "#9C6B22")],
                               startPoint: .top, endPoint: .bottom))
            .overlay {
                GeometryReader { geo in
                    LinearGradient(colors: [.clear, .white.opacity(0.95), .clear],
                                   startPoint: .leading, endPoint: .trailing)
                        .frame(width: geo.size.width * 0.28)
                        .rotationEffect(.degrees(18))
                        .offset(x: sweep ? geo.size.width * 1.2 : -geo.size.width * 0.5)
                        .blendMode(.plusLighter)
                }
                .mask(label)
                .allowsHitTesting(false)
            }
            .shadow(color: Color(hex: "#FF9A3D").opacity(0.55), radius: 18)
            .shadow(color: .black.opacity(0.9), radius: 3, y: 2)
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.easeInOut(duration: 2.4).delay(1.5).repeatForever(autoreverses: false)) {
                    sweep = true
                }
            }
    }
}

/// A slow pulse of firelight behind something important.
struct BreathingGlow: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var color = Palette.gold
    @State private var bright = false

    func body(content: Content) -> some View {
        content
            .shadow(color: color.opacity(bright ? 0.75 : 0.25), radius: bright ? 22 : 10)
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.easeInOut(duration: 2.2).repeatForever(autoreverses: true)) { bright = true }
            }
    }
}

extension View {
    func breathingGlow(_ color: Color = Palette.gold) -> some View { modifier(BreathingGlow(color: color)) }

    /// Smoked glass with a gilt edge, for controls that float over the dragon.
    func glassCard(cornerRadius: CGFloat = 14, highlighted: Bool = false) -> some View {
        self
            .background(.ultraThinMaterial.opacity(0.9), in: .rect(cornerRadius: cornerRadius))
            .background(Palette.ink.opacity(0.45), in: .rect(cornerRadius: cornerRadius))
            .overlay {
                RoundedRectangle(cornerRadius: cornerRadius)
                    .strokeBorder(
                        LinearGradient(colors: [Palette.gold.opacity(highlighted ? 0.95 : 0.6), Palette.gold.opacity(0.12)],
                                       startPoint: .top, endPoint: .bottom),
                        lineWidth: 1)
            }
    }
}
