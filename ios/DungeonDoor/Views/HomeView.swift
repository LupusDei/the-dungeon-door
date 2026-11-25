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

    var body: some View {
        NavigationStack {
            ZStack {
                DragonBackdrop(playing: model.activeGame == nil)
                scrims
                EmberField()
                VStack(spacing: 0) {
                    title
                        .opacity(revealed ? 1 : 0)
                        .offset(y: revealed ? 0 : -14)
                    Spacer(minLength: 24)
                    panel
                        .opacity(revealed ? 1 : 0)
                        .offset(y: revealed ? 0 : 24)
                }
                .padding(.horizontal, 20)
                .padding(.top, 14)
                .padding(.bottom, 10)
                .frame(maxWidth: 560)
            }
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
