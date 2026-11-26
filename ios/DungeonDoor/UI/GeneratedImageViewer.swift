import SwiftUI
import UIKit
import UniformTypeIdentifiers

// A generated picture (a hero's portrait, a scene painting) opens over the whole screen. Pinch and
// double tap zoom it, a drag pans once it is larger than the screen, and a downward drag at its
// fitted size — or the X — puts it away. Share hands the picture to the system share sheet, which
// is also where it is saved to Photos.

extension View {
    /// Opens `url` in the full-screen viewer. A nil url adds nothing, so a sigil or a scene that
    /// is still being painted keeps the tap it already had.
    func generatedImageViewer(url: URL?, title: String) -> some View {
        overlay {
            if let url {
                GeneratedImageTap(url: url, title: title)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .accessibilityLabel(title)
                    .accessibilityHint("Shows it full screen")
                    .accessibilityAddTraits(.isButton)
            }
        }
    }
}

/// The viewer itself. Presented from its own window so it covers a sheet or the game, which is
/// already a full-screen cover.
struct GeneratedImageViewer: View {
    let url: URL
    let title: String
    let onClose: () -> Void

    @State private var image: UIImage?
    @State private var jpeg: Data?
    @State private var failed = false

    var body: some View {
        ZStack {
            if let image {
                ZoomCanvas(image: image, jpeg: jpeg, title: title, onClose: onClose)
            } else {
                Color.black.ignoresSafeArea()
                if failed {
                    VStack(spacing: 12) {
                        Image(systemName: "photo")
                            .font(.system(size: 28))
                        Text("The painting couldn\u{2019}t be opened.")
                            .font(.prose)
                            .multilineTextAlignment(.center)
                    }
                    .foregroundStyle(Palette.muted)
                    .padding(32)
                } else {
                    ProgressView().tint(Palette.gold).controlSize(.large)
                }
            }
        }
        .overlay(alignment: .top) {
            // ZoomCanvas draws its own controls once the picture is here. Until then, only Close.
            if image == nil {
                ViewerChrome(title: title, jpeg: nil, opacity: 1, onClose: onClose)
            }
        }
        .tint(Palette.gold)
        .preferredColorScheme(.dark)
        .statusBarHidden(true)
        .persistentSystemOverlays(.hidden)
        .accessibilityAction(.escape) { onClose() }
        .task(id: url) { await load() }
        .onAppear { UIAccessibility.post(notification: .screenChanged, argument: title) }
    }

    private func load() async {
        do {
            var request = URLRequest(url: url, timeoutInterval: 45)
            request.cachePolicy = .returnCacheDataElseLoad
            let (data, response) = try await URLSession.shared.data(for: request)
            guard !Task.isCancelled else { return }
            if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
                failed = true
                return
            }
            guard let loaded = UIImage(data: data) else {
                failed = true
                return
            }
            image = loaded
            // Keep the original bytes when they are already a JPEG, so sharing does not re-encode.
            if data.starts(with: Data([0xFF, 0xD8, 0xFF])) {
                jpeg = data
            } else {
                jpeg = loaded.jpegData(compressionQuality: 0.92)
            }
        } catch is CancellationError {
            return
        } catch let error as URLError where error.code == .cancelled {
            return
        } catch {
            if !Task.isCancelled { failed = true }
        }
    }
}

/// Pinch, pan, double tap and the swipe-down dismiss, with the close and share controls floating
/// over the picture.
private struct ZoomCanvas: View {
    let image: UIImage
    let jpeg: Data?
    let title: String
    let onClose: () -> Void

    private static let maximumZoom: CGFloat = 5
    private static let tappedZoom: CGFloat = 2.5
    private static let dismissTravel: CGFloat = 120

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var committedScale: CGFloat = 1
    @State private var committedOffset: CGSize = .zero
    /// Live pinch, as a multiple of `committedScale`. One while the fingers are off the glass.
    @GestureState private var pinchMagnification: CGFloat = 1
    /// Live drag. Zero once the finger lifts, which is what snaps a short swipe back.
    @GestureState private var dragTranslation: CGSize = .zero

    private var gestureScale: CGFloat { capped(committedScale * pinchMagnification) }
    private var zoomed: Bool { gestureScale > 1.02 }

    private var pull: CGFloat { zoomed ? 0 : max(0, dragTranslation.height) }

    private var visualScale: CGFloat {
        let shrink = pull > 0 ? max(0.86, 1 - pull / 800) : 1
        return gestureScale * shrink
    }

    private var backdrop: Double { max(0.25, 1 - Double(pull) / 360) }

    var body: some View {
        ZStack {
            Color.black.opacity(backdrop).ignoresSafeArea()
            GeometryReader { geo in
                let fitted = Self.aspectFit(image.size, into: geo.size)
                Image(uiImage: image)
                    .resizable()
                    .interpolation(.high)
                    .scaledToFit()
                    .frame(width: fitted.width, height: fitted.height)
                    .scaleEffect(visualScale)
                    .offset(x: shownOffset(fitted: fitted, view: geo.size).width,
                            y: shownOffset(fitted: fitted, view: geo.size).height + pull)
                    .frame(width: geo.size.width, height: geo.size.height)
                    .contentShape(Rectangle())
                    .simultaneousGesture(doubleTap(in: geo.size, fitted: fitted))
                    .simultaneousGesture(pinch(fitted: fitted, view: geo.size))
                    .simultaneousGesture(drag(fitted: fitted, view: geo.size))
                    .accessibilityLabel(title)
                    .accessibilityHint("Pinch to zoom. Double tap to zoom. Swipe down to close.")
                    .accessibilityAddTraits(.isImage)
                    .accessibilityAction(named: "Zoom in") { zoomToPoint(at: center(of: geo.size), in: geo.size, fitted: fitted) }
                    .accessibilityAction(named: "Zoom out") { settle(scale: 1, offset: .zero) }
            }
            .ignoresSafeArea()
        }
        .overlay(alignment: .top) {
            ViewerChrome(title: title, jpeg: jpeg, opacity: backdrop, onClose: onClose)
        }
    }

    /// Where the picture sits while a gesture is in progress. A resting zoom uses the offset the
    /// last gesture settled on, so a double tap can animate there without the clamp fighting it.
    private func shownOffset(fitted: CGSize, view: CGSize) -> CGSize {
        guard zoomed else { return .zero }
        let raw = CGSize(width: committedOffset.width + dragTranslation.width,
                         height: committedOffset.height + dragTranslation.height)
        let resting = dragTranslation == .zero && pinchMagnification == 1
        return resting ? raw : clamp(raw, scale: gestureScale, fitted: fitted, view: view)
    }

    private func doubleTap(in view: CGSize, fitted: CGSize) -> some Gesture {
        SpatialTapGesture(count: 2).onEnded { value in
            if zoomed {
                settle(scale: 1, offset: .zero)
            } else {
                zoomToPoint(at: value.location, in: view, fitted: fitted)
            }
        }
    }

    /// Keeps the tapped point under the finger: scaling around the centre would walk it away, so
    /// the offset pulls it back by the same amount the scale pushed it.
    private func zoomToPoint(at point: CGPoint, in view: CGSize, fitted: CGSize) {
        let target = Self.tappedZoom
        let centre = center(of: view)
        let fromCentre = CGSize(width: point.x - centre.x, height: point.y - centre.y)
        let proposed = CGSize(width: fromCentre.width * (1 - target), height: fromCentre.height * (1 - target))
        settle(scale: target, offset: clamp(proposed, scale: target, fitted: fitted, view: view))
    }

    private func pinch(fitted: CGSize, view: CGSize) -> some Gesture {
        MagnifyGesture()
            .updating($pinchMagnification) { value, state, _ in
                state = value.magnification
            }
            .onEnded { value in
                let next = capped(committedScale * value.magnification)
                committedScale = next
                if next <= 1.01 {
                    committedOffset = .zero
                } else {
                    committedOffset = clamp(committedOffset, scale: next, fitted: fitted, view: view)
                }
            }
    }

    private func drag(fitted: CGSize, view: CGSize) -> some Gesture {
        DragGesture(minimumDistance: 10)
            .updating($dragTranslation) { value, state, _ in
                state = value.translation
            }
            .onEnded { value in
                let down = value.translation.height
                let flicked = value.predictedEndTranslation.height > 280 && down > 48
                let dismiss = committedScale <= 1.01 && (down > Self.dismissTravel || flicked) && down > abs(value.translation.width)
                if dismiss {
                    onClose()
                    return
                }
                guard committedScale > 1.01 else { return }
                let raw = CGSize(width: committedOffset.width + value.translation.width,
                                 height: committedOffset.height + value.translation.height)
                committedOffset = clamp(raw, scale: committedScale, fitted: fitted, view: view)
            }
    }

    private func settle(scale: CGFloat, offset: CGSize) {
        let change = {
            committedScale = scale
            committedOffset = offset
        }
        if reduceMotion { change() } else { withAnimation(.spring(duration: 0.32), change) }
    }

    private func capped(_ scale: CGFloat) -> CGFloat { min(Self.maximumZoom, max(1, scale)) }

    private func center(of view: CGSize) -> CGPoint { CGPoint(x: view.width / 2, y: view.height / 2) }

    /// The largest size that keeps the whole picture inside `view`.
    private static func aspectFit(_ image: CGSize, into view: CGSize) -> CGSize {
        guard image.width > 0, image.height > 0, view.width > 0, view.height > 0 else { return .zero }
        let scale = min(view.width / image.width, view.height / image.height)
        return CGSize(width: image.width * scale, height: image.height * scale)
    }

    /// Keeps an edge of the picture from sliding past the edge of the screen.
    private func clamp(_ offset: CGSize, scale: CGFloat, fitted: CGSize, view: CGSize) -> CGSize {
        let maxX = max(0, (fitted.width * scale - view.width) / 2)
        let maxY = max(0, (fitted.height * scale - view.height) / 2)
        return CGSize(width: min(maxX, max(-maxX, offset.width)),
                      height: min(maxY, max(-maxY, offset.height)))
    }
}

/// The X, and share once the picture has bytes the share sheet can save.
private struct ViewerChrome: View {
    let title: String
    let jpeg: Data?
    let opacity: Double
    let onClose: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Button(action: onClose) {
                ViewerRoundLabel(systemName: "xmark")
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Close")
            Spacer(minLength: 0)
                .allowsHitTesting(false)
            if let jpeg {
                ShareLink(item: SharedPainting(jpeg: jpeg), preview: SharePreview<Never, Never>(title)) {
                    ViewerRoundLabel(systemName: "square.and.arrow.up")
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Share")
                .accessibilityHint("Opens the share sheet, where the picture can be saved or sent")
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .frame(maxWidth: .infinity)
        .opacity(opacity)
    }
}

private struct ViewerRoundLabel: View {
    let systemName: String
    var body: some View {
        Image(systemName: systemName)
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(Palette.parchment)
            .frame(width: 44, height: 44)
            .background(Color.black.opacity(0.55), in: Circle())
            .overlay { Circle().strokeBorder(Palette.gold.opacity(0.5), lineWidth: 1) }
    }
}

/// JPEG bytes for the share sheet. Saving to Photos is one of the actions the sheet offers, which
/// is why the app names a photo-library purpose.
private struct SharedPainting: Transferable, Sendable {
    let jpeg: Data

    static var transferRepresentation: some TransferRepresentation {
        DataRepresentation(exportedContentType: UTType.jpeg) { painting in
            painting.jpeg
        }
        .suggestedFileName("Dungeon Door")
    }
}

/// Presents the viewer above whatever is on screen. A cover attached to the picture itself cannot
/// reliably appear over the game, which is already presented full screen, or from inside a button.
private final class GeneratedImageWindow {
    static let shared = GeneratedImageWindow()
    private var window: UIWindow?
    private weak var previousKey: UIWindow?

    func show(url: URL, title: String) {
        guard window == nil else { return }
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        guard let scene = scenes.first(where: { $0.activationState == .foregroundActive }) ?? scenes.first else { return }

        let window = UIWindow(windowScene: scene)
        window.windowLevel = UIWindow.Level(rawValue: UIWindow.Level.alert.rawValue + 1)
        window.backgroundColor = .clear
        window.overrideUserInterfaceStyle = .dark
        let root = ViewerHost(rootView: GeneratedImageViewer(url: url, title: title) { [weak self] in
            self?.hide()
        })
        root.view.backgroundColor = .clear
        root.view.accessibilityViewIsModal = true
        window.rootViewController = root
        previousKey = scene.windows.first { $0.isKeyWindow }
        window.alpha = 0
        window.makeKeyAndVisible()
        self.window = window
        UIView.animate(withDuration: 0.2) { window.alpha = 1 }
    }

    func hide() {
        guard let window else { return }
        self.window = nil
        let previous = previousKey
        window.isUserInteractionEnabled = false
        UIView.animate(withDuration: 0.18, animations: {
            window.alpha = 0
        }, completion: { _ in
            window.isHidden = true
            window.rootViewController = nil
            previous?.makeKey()
        })
    }
}

private final class ViewerHost<Content: View>: UIHostingController<Content> {
    override var prefersStatusBarHidden: Bool { true }
}

/// A clear control the size of the picture. A portrait often sits inside another button (a hero
/// in the party, a vote). This recognizer takes that tap, and makes the outer button wait, so the
/// picture opens and the row does not also fire. A scroll still wins once the finger actually moves.
private struct GeneratedImageTap: UIViewRepresentable {
    let url: URL
    let title: String

    func makeUIView(context: Context) -> ExclusiveTapControl {
        let view = ExclusiveTapControl()
        view.onTap = { GeneratedImageWindow.shared.show(url: url, title: title) }
        return view
    }

    func updateUIView(_ view: ExclusiveTapControl, context: Context) {
        view.onTap = { GeneratedImageWindow.shared.show(url: url, title: title) }
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: ExclusiveTapControl, context: Context) -> CGSize? {
        CGSize(width: proposal.width ?? 44, height: proposal.height ?? 44)
    }
}

private final class ExclusiveTapControl: UIView, UIGestureRecognizerDelegate {
    var onTap: () -> Void = {}

    override init(frame: CGRect) {
        super.init(frame: frame)
        isOpaque = false
        backgroundColor = .clear
        isAccessibilityElement = false
        let tap = UITapGestureRecognizer(target: self, action: #selector(fire))
        tap.cancelsTouchesInView = true
        tap.delegate = self
        addGestureRecognizer(tap)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    @objc private func fire() { onTap() }

    override var intrinsicContentSize: CGSize {
        CGSize(width: UIView.noIntrinsicMetric, height: UIView.noIntrinsicMetric)
    }

    /// Ancestor taps (the row this picture sits in) wait for this one. It wins a stationary tap
    /// and gives up as soon as the touch moves, so a scroll that starts on the picture still scrolls.
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldBeRequiredToFailBy otherGestureRecognizer: UIGestureRecognizer) -> Bool {
        !(otherGestureRecognizer is UIPanGestureRecognizer)
            && !(otherGestureRecognizer is UIPinchGestureRecognizer)
            && !(otherGestureRecognizer is UIRotationGestureRecognizer)
            && !(otherGestureRecognizer is UISwipeGestureRecognizer)
    }
}
