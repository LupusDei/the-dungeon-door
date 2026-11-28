import SwiftUI

// The pieces of painting a portrait, shared by the forge's last step and the hero page's repaint
// sheet. Neither saves: the screen that holds the `PortraitRemake` does, with its own button.

/// The painting on show. While a new one is painted it stays, dimmed, under the forging animation.
struct PortraitCanvas: View {
    let url: URL?
    let symbol: String
    var size: CGFloat = 240
    let forging: Bool

    var body: some View {
        PortraitView(url: url, symbol: symbol, size: size, opensViewer: !forging)
            .overlay {
                if forging {
                    ForgingView()
                        .background(Palette.ink.opacity(url == nil ? 0.85 : 0.6))
                        .clipShape(.rect(cornerRadius: size * 0.16))
                        .transition(.opacity)
                }
            }
            .animation(.easeInOut(duration: 0.3), value: forging)
            .frame(maxWidth: .infinity)
    }
}

/// The optional details for the next painting, and the button that paints it.
struct RepaintControls: View {
    let painting: PortraitRemake
    @Binding var note: String
    let busy: Bool
    let paint: () -> Void

    private var hint: String {
        painting.hasPainting ? "Paints a new portrait. The current one stays until you keep the new one." : "Paints their first portrait."
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if painting.hasPainting {
                VStack(alignment: .leading, spacing: 6) {
                    SectionLabel("Anything to change? (optional)")
                    TextField("Darker armour, an older face, a raven on the shoulder…", text: $note, axis: .vertical)
                        .font(.prose)
                        .returnIsDone($note)
                        .padding(12)
                        .card()
                        .onChange(of: note) { _, new in if new.count > 300 { note = String(new.prefix(300)) } }
                }
            }
            Button(action: paint) {
                Label(painting.paintLabel, systemImage: "paintbrush.fill")
            }
            .buttonStyle(painting.hasPainting ? .gildedOutline : .gilded)
            .disabled(busy)
            .accessibilityHint(hint)
        }
    }
}

/// After a repaint: keep the new painting, or go back to the one before it. Neither saves.
struct PortraitChoiceBar: View {
    let disabled: Bool
    let backToLast: () -> Void
    let keepNew: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Button("Back to the last one", action: backToLast)
                .buttonStyle(.gildedOutline)
            Button("Keep the new one", action: keepNew)
                .buttonStyle(.gilded)
        }
        .disabled(disabled)
    }
}

/// A line under a new painting, saying the last one is still the hero's.
struct PortraitChoiceNote: View {
    var body: some View {
        Label("A new painting. The last one is still theirs until you keep this one.", systemImage: "sparkles")
            .font(.proseSmall.italic())
            .foregroundStyle(Palette.muted)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .center)
            .multilineTextAlignment(.center)
    }
}

/// Shown while the portrait is generated (10–40 s), so the wait feels like part of the game.
struct ForgingView: View {
    private let lines = [
        "Stoking the forge…", "Consulting the bards…", "Grinding pigments from dragon scale…",
        "The dungeon master squints at your hero…", "Painting by candlelight…", "Varnishing the canvas…",
    ]

    var body: some View {
        TimelineView(.periodic(from: .now, by: 3)) { context in
            let tick = Int(context.date.timeIntervalSinceReferenceDate / 3)
            VStack(spacing: 14) {
                Image(systemName: "flame.fill")
                    .font(.system(size: 44))
                    .foregroundStyle(LinearGradient(colors: [Palette.gold, Palette.ember], startPoint: .top, endPoint: .bottom))
                    .symbolEffect(.pulse, options: .repeating)
                Text(lines[tick % lines.count])
                    .font(.proseSmall.italic())
                    .foregroundStyle(Palette.parchment)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 12)
                    .contentTransition(.opacity)
                    .animation(.easeInOut, value: tick)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Painting the portrait")
    }
}
