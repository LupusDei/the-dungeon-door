import SwiftUI

/// The front of the game: the old dragon on his summit, embers in the air, and beneath him your
/// heroes and the way into an adventure.
struct HomeView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.scenePhase) private var scenePhase
    @State private var forging = false
    @State private var newGame = false
    @State private var joining = false
    @State private var hall = AppConfig.showHallArgument
    @State private var revealed = false
    @State private var director = DragonDirector()
    /// Where the controls begin, so taps down there aren't taken for pokes.
    @State private var panelTop: CGFloat = .infinity
    /// The hero pages on show. A path, so `-openHeroNamed` can push one.
    @State private var path: [Character] = []
    /// The forge that `-forgeStep` asked for, if any.
    @State private var launchForge: LaunchForge?
    @State private var launchHandled = false

    private struct LaunchForge: Identifiable {
        let id = UUID()
        let hero: Character?
        let step: CharacterForgeView.Step
    }

    var body: some View {
        NavigationStack(path: $path) {
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
            .overlay(alignment: .topLeading) { hallButton }
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
        .sheet(item: $launchForge) {
            CharacterForgeView(editing: $0.hero, draft: $0.hero == nil ? AppConfig.forgeNewArgument : nil, startingAt: $0.step)
        }
        .onChange(of: model.didRefresh, initial: true) { _, _ in handleLaunchArguments() }
        .sheet(isPresented: $newGame) { NewGameView() }
        .sheet(isPresented: $joining) { JoinGameView() }
        .sheet(isPresented: $hall) { HallOfHeroesView() }
        .sheet(item: Binding(get: { model.joinCode.map(DoorCode.init) }, set: { if $0 == nil { model.joinCode = nil } })) { door in
            // An invitation that asks for one of this player's heroes opens with that hero picked.
            JoinGameView(code: door.code, invitation: model.invitations.first { $0.code == door.code })
        }
        // A tapped notification: an invitation opens the way in, anything else its game.
        .onChange(of: PushCenter.shared.tapped, initial: true) { _, news in
            guard let news else { return }
            PushCenter.shared.tapped = nil
            Task { await model.open(news) }
        }
        .fullScreenCover(isPresented: Binding(get: { model.activeGame != nil }, set: { if !$0 { model.closeGame() } })) {
            if let session = model.activeGame { GameView(session: session) }
        }
        .overlay {
            if UpdateGate.shared.required && model.activeGame == nil {
                UpdateRequiredView().ignoresSafeArea()
            }
        }
        .onAppear {
            withAnimation(.easeOut(duration: 1.1).delay(0.35)) { revealed = true }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await model.refresh() } }
        }
    }

    /// The debug launch arguments (see `AppConfig`): straight to a hero's page, or into the forge
    /// at a given step. Anything that names a hero waits for the roster to be fresh.
    private func handleLaunchArguments() {
        guard !launchHandled else { return }
        func hero(named name: String) -> Character? {
            model.allHeroes.first { $0.name.compare(name, options: [.caseInsensitive, .diacriticInsensitive]) == .orderedSame }
        }
        if let name = AppConfig.openHeroArgument {
            guard model.didRefresh else { return }
            launchHandled = true
            if let found = hero(named: name) { path = [found] }
        } else if let step = AppConfig.forgeStepArgument.flatMap(CharacterForgeView.Step.init(argument:)) {
            var editing: Character?
            if let name = AppConfig.forgeHeroArgument {
                guard model.didRefresh else { return }
                editing = hero(named: name)
            }
            launchHandled = true
            Task {
                // A moment for the home screen to settle before a sheet goes over it.
                try? await Task.sleep(for: .milliseconds(400))
                launchForge = LaunchForge(hero: editing, step: step)
            }
        } else if AppConfig.newGameArgument {
            guard model.didRefresh else { return }
            launchHandled = true
            Task {
                try? await Task.sleep(for: .milliseconds(400))
                newGame = true
            }
        } else {
            launchHandled = true
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
                .fixedSize(horizontal: false, vertical: true)
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

    /// The way to the Hall of Heroes: the retired and the fallen. Only there once someone is in it.
    @ViewBuilder private var hallButton: some View {
        if !model.retired.isEmpty || !model.fallen.isEmpty {
            Button {
                hall = true
            } label: {
                Image(systemName: "building.columns.fill")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Palette.gold)
                    .frame(width: 38, height: 38)
                    .glassCard(cornerRadius: 19)
            }
            .padding(.leading, 16)
            .padding(.top, 4)
            .opacity(revealed ? 1 : 0)
            .accessibilityLabel("Hall of Heroes")
            .accessibilityHint("Your retired and fallen heroes")
        }
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
                ForEach(model.invitations.prefix(2)) { invitation in
                    InvitationCard(invitation: invitation,
                                   join: { model.joinCode = invitation.code },
                                   decline: { Task { await model.decline(invitation) } })
                        .transition(.move(edge: .top).combined(with: .opacity))
                }
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
                HStack(alignment: .top, spacing: 12) {
                    // Once any hero has a sheet, every tile keeps a line for it, so the row stays level.
                    let showVitals = model.characters.contains { $0.sheet != nil }
                    ForEach(model.characters) { hero in
                        NavigationLink(value: hero) { HeroTile(hero: hero, showVitals: showVitals) }
                            .buttonStyle(.plain)
                    }
                    Button { forging = true } label: { ForgeTile() }
                        .buttonStyle(.plain)
                }
                // As tall as the tallest tile and no taller: the tiles fill the row's height, and
                // without this the row would take all the height the screen offers.
                .fixedSize(horizontal: false, vertical: true)
                .padding(.vertical, 2)
            }
            .scrollClipDisabled()
        }
    }
}

/// A door code as something a sheet can be presented for.
private struct DoorCode: Identifiable {
    let code: String
    var id: String { code }
}

/// A companion's invitation to a party still gathering: who asks, who is there, and the way in.
private struct InvitationCard: View {
    let invitation: Invitation
    let join: () -> Void
    let decline: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "envelope.open.fill")
                .font(.system(size: 18))
                .foregroundStyle(Palette.gold)
                .frame(width: 30)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text("\(invitation.from) invites you")
                    .font(.display(16))
                    .fixedSize(horizontal: false, vertical: true)
                if let asks = invitation.asks {
                    Text(asks)
                        .font(.serif(.footnote, weight: .semibold))
                        .foregroundStyle(Palette.gold)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Text(invitation.detail)
                    .font(.caption)
                    .foregroundStyle(Palette.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 4)
            Button("Join", action: join)
                .font(.serif(.subheadline, weight: .semibold))
                .foregroundStyle(Palette.ink)
                .padding(.horizontal, 14)
                .padding(.vertical, 7)
                .background(Palette.gold, in: .capsule)
                .buttonStyle(.plain)
            Button(action: decline) {
                Image(systemName: "xmark")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Palette.muted)
                    .frame(width: 30, height: 30)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Decline \(invitation.from)\u{2019}s invitation")
        }
        .padding(12)
        .glassCard()
        .accessibilityElement(children: .contain)
    }
}

/// A roster tile's measures. Its column of text is 104 points wide at the default text size and
/// wider as the text grows (to 170), so a species and class or a line of vitals wraps onto whole
/// words instead of being cut short.
private enum Tile {
    static let base: CGFloat = 104
    /// The portrait at the accessibility sizes, where it sits beside the words instead of above them:
    /// this screen does not scroll, and a tall tile would push the title off it.
    static let smallPortrait: CGFloat = 72

    static func textWidth(_ percent: CGFloat) -> CGFloat { min(max(base * percent / 100, base), 170) }

    static func layout(big: Bool) -> AnyLayout {
        big ? AnyLayout(HStackLayout(alignment: .top, spacing: 10)) : AnyLayout(VStackLayout(alignment: .leading, spacing: 6))
    }
}

private struct TileChrome: ViewModifier {
    func body(content: Content) -> some View {
        content
            .frame(maxHeight: .infinity, alignment: .top)
            .padding(9)
            .glassCard()
            // A tile is a glance, not a page: its text stops growing at the second accessibility size.
            .dynamicTypeSize(...DynamicTypeSize.accessibility2)
    }
}

private struct HeroTile: View {
    @Environment(AppModel.self) private var model
    @ScaledMetric(relativeTo: .caption2) private var percent: CGFloat = 100
    @Environment(\.dynamicTypeSize) private var typeSize
    let hero: Character
    var showVitals = false

    private var big: Bool { typeSize.isAccessibilitySize }

    var body: some View {
        let fallen = hero.isFallen
        let width = Tile.textWidth(percent)
        let arrangement = Tile.layout(big: big)
        return arrangement {
            // The whole tile opens the hero's page; the picture opens large from there.
            PortraitView(url: hero.portraitURL, symbol: classSymbol, size: big ? Tile.smallPortrait : width, opensViewer: false)
                .saturation(fallen ? 0 : 1)
                .opacity(fallen ? 0.55 : 1)
                .overlay(alignment: .bottomLeading) {
                    if fallen && !big {
                        TagLabel("Fallen", tint: Palette.ember)
                            .background(Palette.ink.opacity(0.85), in: Capsule(style: .circular))
                            .padding(6)
                    }
                }
            // Below the accessibility sizes a name and the vitals keep to one line, shrunk a little if
            // need be (the tile has widened with the text). At those sizes they wrap in full.
            VStack(alignment: .leading, spacing: big ? 3 : 6) {
                Text(hero.name)
                    .font(.serif(.subheadline, weight: .semibold))
                    .lineLimit(big ? nil : 1)
                    .minimumScaleFactor(0.8)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                    .foregroundStyle(fallen ? Palette.muted : Palette.parchment)
                Text(subtitle)
                    .font(.caption2)
                    .foregroundStyle(Palette.muted)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                if showVitals {
                    Text(fallen ? "Died at level \(hero.sheet?.level ?? 1)" : hero.shortVitalsLine ?? " ")
                        .font(.caption2.weight(.semibold))
                        .monospacedDigit()
                        .foregroundStyle(fallen ? Palette.ember : Palette.verdigris)
                        .lineLimit(big ? nil : 1)
                        .minimumScaleFactor(0.8)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(width: width, alignment: .leading)
        }
        .modifier(TileChrome())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(fallen ? "\(hero.name), \(subtitle), fallen" : "\(hero.name), \(subtitle), \(hero.vitalsLine ?? "")")
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
    @ScaledMetric(relativeTo: .caption2) private var percent: CGFloat = 100
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let big = typeSize.isAccessibilitySize
        let width = Tile.textWidth(percent)
        let side = big ? Tile.smallPortrait : width
        let arrangement = Tile.layout(big: big)
        return arrangement {
            ZStack {
                RoundedRectangle(cornerRadius: 17)
                    .strokeBorder(Palette.gold.opacity(0.55), style: StrokeStyle(lineWidth: 1.5, dash: [6, 5]))
                Image(systemName: "wand.and.stars")
                    .font(.system(size: big ? 24 : 32))
                    .foregroundStyle(Palette.gold)
                    .symbolEffect(.pulse, options: .repeating)
            }
            .frame(width: side, height: side)
            VStack(alignment: .leading, spacing: big ? 3 : 6) {
                Text("Forge a hero")
                    .font(.serif(.subheadline, weight: .semibold))
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                Text("Describe, we paint")
                    .font(.caption2).foregroundStyle(Palette.muted)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(width: width, alignment: .leading)
        }
        .modifier(TileChrome())
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
