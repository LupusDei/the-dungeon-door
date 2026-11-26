import SwiftUI

/// The front of the game: the old dragon on his summit, embers in the air, and beneath him your
/// heroes and the way into an adventure.
struct HomeView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.scenePhase) private var scenePhase
    @State private var forging = false
    @State private var newGame = false
    @State private var joining = false
    @State private var revealed = false
    @State private var director = DragonDirector()
    /// Where the controls begin, so taps down there aren't taken for pokes.
    @State private var panelTop: CGFloat = .infinity

    var body: some View {
        NavigationStack {
            ZStack {
                DragonBackdrop(director: director, playing: model.activeGame == nil)
                scrims
                EmberField(bursts: director.bursts)
                    .ignoresSafeArea()
                VStack(spacing: 0) {
                    title
                        .opacity(revealed ? 1 : 0)
                        .offset(y: revealed ? 0 : -14)
                    Spacer(minLength: 24)
                    dragonWords
                    panel
                        .opacity(revealed ? 1 : 0)
                        .offset(y: revealed ? 0 : 24)
                        .onGeometryChange(for: CGFloat.self) { $0.frame(in: .global).minY } action: { panelTop = $0 }
                }
                .padding(.horizontal, 20)
                .padding(.top, 14)
                .padding(.bottom, 10)
                .frame(maxWidth: 560)
            }
            .overlay(alignment: .topTrailing) { soundToggle }
            // Anywhere above the controls is the dragon. Buttons and hero tiles keep their own taps.
            .contentShape(Rectangle())
            .gesture(SpatialTapGesture(coordinateSpace: .global).onEnded { tap in
                if tap.location.y < panelTop - 8 { director.poke(at: tap.location) }
            })
            .foregroundStyle(Palette.parchment)
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: Character.self) { CharacterDetailView(character: $0) }
        }
        .sheet(isPresented: $forging) { CharacterForgeView() }
        .sheet(isPresented: $newGame) { NewGameView() }
        .sheet(isPresented: $joining) { JoinGameView() }
        .fullScreenCover(isPresented: Binding(get: { model.activeGame != nil }, set: { if !$0 { model.closeGame() } })) {
            if let session = model.activeGame { GameView(session: session) }
        }
        .onAppear {
            withAnimation(.easeOut(duration: 1.1).delay(0.35)) { revealed = true }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await model.refresh() } }
        }
    }

    /// Darkens the sky behind the title and the cliffs behind the controls; the dragon stays clear.
    private var scrims: some View {
        VStack(spacing: 0) {
            LinearGradient(colors: [Palette.ink.opacity(0.88), Palette.ink.opacity(0.45), .clear],
                           startPoint: .top, endPoint: .bottom)
                .frame(height: 280)
            Spacer(minLength: 0)
            LinearGradient(stops: [.init(color: .clear, location: 0),
                                   .init(color: Palette.ink.opacity(0.78), location: 0.42),
                                   .init(color: Palette.ink.opacity(0.97), location: 1)],
                           startPoint: .top, endPoint: .bottom)
                .frame(height: 470)
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
    }

    private var title: some View {
        VStack(spacing: 6) {
            Text("THE")
                .font(.display(14))
                .tracking(12)
                .padding(.leading, 12) // optically centre the tracked letters
                .foregroundStyle(Palette.gold)
            GlintingTitle(text: "Dungeon Door")
            Flourish()
                .frame(width: 210)
                .padding(.vertical, 2)
            Text("Gather your party.\nThe master of this dungeon is watching.")
                .font(.system(size: 16, design: .serif).italic())
                .multilineTextAlignment(.center)
                .foregroundStyle(Palette.parchment.opacity(0.9))
                .shadow(color: .black, radius: 6)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
        .accessibilityAction(named: "Wake the dragon") {
            director.poke(at: CGPoint(x: 200, y: 400))
        }
    }

    /// What the dragon is saying, as a caption (it's the only way to follow him on silent), or a
    /// nudge to try poking him until the player has.
    private var dragonWords: some View {
        ZStack(alignment: .bottom) {
            if let line = director.caption {
                Text("\u{201C}\(line)\u{201D}")
                    .font(.system(size: 19, weight: .medium, design: .serif).italic())
                    .multilineTextAlignment(.center)
                    .foregroundStyle(Color(hex: "#FFE9B0"))
                    .shadow(color: .black, radius: 3)
                    .shadow(color: .black.opacity(0.9), radius: 12)
                    .id(line)
                    .transition(.opacity)
                    .accessibilityLabel("The dragon says: \(line)")
            } else if !director.hasBeenPoked && director.isSettled && revealed {
                Text("Touch the dragon, if you dare")
                    .font(.system(size: 13, weight: .semibold, design: .serif))
                    .tracking(1.6)
                    .textCase(.uppercase)
                    .foregroundStyle(Palette.gold.opacity(0.85))
                    .shadow(color: .black, radius: 8)
                    .phaseAnimator([0.35, 1.0]) { view, glow in
                        view.opacity(glow)
                    } animation: { _ in .easeInOut(duration: 1.6) }
                    .transition(.opacity)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 76, alignment: .bottom)
        .padding(.bottom, 14)
        .allowsHitTesting(false)
    }

    private var soundToggle: some View {
        Button {
            director.soundOn.toggle()
        } label: {
            Image(systemName: director.soundOn ? "speaker.wave.2.fill" : "speaker.slash.fill")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Palette.gold)
                .frame(width: 38, height: 38)
                .glassCard(cornerRadius: 19)
                .contentTransition(.symbolEffect(.replace))
        }
        .padding(.trailing, 16)
        .padding(.top, 4)
        .opacity(revealed ? 1 : 0)
        .accessibilityLabel(director.soundOn ? "Mute the dragon" : "Unmute the dragon")
    }

    @ViewBuilder private var panel: some View {
        VStack(spacing: 14) {
            if let error = model.catalogError {
                VStack(alignment: .leading, spacing: 6) {
                    ErrorLine(text: "Can't reach the tavern: \(error)")
                    Button("Try again") { Task { await model.refresh() } }.font(.proseSmall)
                }
                .padding(12)
                .glassCard()
            }
            if model.characters.isEmpty {
                firstHero
            } else {
                roster
                Button { newGame = true } label: {
                    Label("Open a new door", systemImage: "door.left.hand.open")
                }
                .buttonStyle(.gilded)
                .breathingGlow()
                Button { joining = true } label: {
                    Label("Join a party", systemImage: "person.3.sequence.fill")
                }
                .buttonStyle(.glass)
            }
        }
        .disabled(model.catalog == nil)
    }

    /// First launch: one clear thing to do.
    private var firstHero: some View {
        VStack(spacing: 14) {
            VStack(spacing: 6) {
                Text("Every legend begins with a name")
                    .font(.display(21))
                    .multilineTextAlignment(.center)
                Text("Describe your hero and the dungeon master will paint them. Then open a door, or knock on a friend's.")
                    .font(.system(size: 15, design: .serif))
                    .multilineTextAlignment(.center)
                    .foregroundStyle(Palette.parchment.opacity(0.78))
            }
            .shadow(color: .black, radius: 8)
            Button { forging = true } label: {
                Label("Forge your hero", systemImage: "wand.and.stars")
            }
            .buttonStyle(.gilded)
            .breathingGlow()
        }
    }

    private var roster: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel("Your heroes")
                .shadow(color: .black, radius: 6)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(model.characters) { hero in
                        NavigationLink(value: hero) { HeroTile(hero: hero) }
                            .buttonStyle(.plain)
                    }
                    Button { forging = true } label: { ForgeTile() }
                        .buttonStyle(.plain)
                }
                .padding(.vertical, 2)
            }
            .scrollClipDisabled()
        }
    }
}

private struct HeroTile: View {
    @Environment(AppModel.self) private var model
    let hero: Character

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            PortraitView(url: hero.portraitURL, symbol: classSymbol, size: 104)
            Text(hero.name)
                .font(.display(15))
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            Text(subtitle)
                .font(.caption2)
                .foregroundStyle(Palette.muted)
                .lineLimit(1)
        }
        .frame(width: 104)
        .padding(9)
        .glassCard()
    }

    private var classSymbol: String {
        model.catalog?.classes.first { $0.id == hero.characterClass }?.symbol ?? "shield.lefthalf.filled"
    }

    private var subtitle: String {
        guard let c = model.catalog else { return hero.characterClass.capitalized }
        return "\(c.name(hero.race, in: \.races)) \(c.name(hero.characterClass, in: \.classes))"
    }
}

private struct ForgeTile: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ZStack {
                RoundedRectangle(cornerRadius: 17)
                    .strokeBorder(Palette.gold.opacity(0.55), style: StrokeStyle(lineWidth: 1.5, dash: [6, 5]))
                Image(systemName: "wand.and.stars")
                    .font(.system(size: 32))
                    .foregroundStyle(Palette.gold)
                    .symbolEffect(.pulse, options: .repeating)
            }
            .frame(width: 104, height: 104)
            Text("Forge a hero").font(.display(15)).lineLimit(1)
            Text("Describe, we paint").font(.caption2).foregroundStyle(Palette.muted).lineLimit(1)
        }
        .frame(width: 104)
        .padding(9)
        .glassCard()
    }
}

/// A thin gilt rule with a diamond at its heart.
private struct Flourish: View {
    var body: some View {
        HStack(spacing: 8) {
            line(leading: true)
            Rectangle()
                .fill(Palette.gold)
                .frame(width: 6, height: 6)
                .rotationEffect(.degrees(45))
                .shadow(color: Palette.gold, radius: 5)
            line(leading: false)
        }
        .accessibilityHidden(true)
    }

    private func line(leading: Bool) -> some View {
        LinearGradient(colors: leading ? [.clear, Palette.gold] : [Palette.gold, .clear],
                       startPoint: .leading, endPoint: .trailing)
            .frame(height: 1)
    }
}
