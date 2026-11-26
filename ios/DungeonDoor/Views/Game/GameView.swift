import SwiftUI

/// The whole game, full screen: lobby, then the play dashboard (the hero's sheet, which is where
/// the game is played), then the finale on that same screen. Chat, the chronicle, the full tabbed
/// sheet and (in a dungeon) the map open as sheets from the toolbar.
struct GameView: View {
    @Environment(AppModel.self) private var model
    @Bindable var session: GameSession
    @State private var showChronicle = false
    @State private var showMap = false
    /// `-showMap YES` opens the map by itself, once.
    @State private var mapShownForLaunch = false
    @State private var confirmLeave = false
    /// Reads scenes aloud for as long as the game is on screen.
    @State private var narrator = Narrator()
    /// The hero whose sheet is open, by player id.
    @State private var sheetHero: SheetHero?
    /// The tab each hero's sheet was left on, for as long as the game is on screen.
    @State private var sheetTabs: [String: HeroSheetTab] = [:]
    /// `-openMySheet YES` opens the caller's sheet by itself, once.
    @State private var sheetShownForLaunch = false

    private struct SheetHero: Identifiable {
        let playerId: String
        var id: String { playerId }
    }

    private var hasMap: Bool { session.state.rules?.dungeon != nil }

    var body: some View {
        NavigationStack {
            Group {
                switch session.state.status {
                case .lobby:
                    LobbyView(session: session)
                case .preparing where session.state.scene == nil:
                    PreparingView(title: session.state.title)
                default:
                    PlayDashboard(session: session, narrator: narrator, openMap: { showMap = true }) {
                        sheetHero = SheetHero(playerId: $0)
                    }
                }
            }
            .animation(.easeInOut(duration: 0.4), value: session.state.status)
            .screenChrome()
            .navigationTitle(session.state.title ?? "Door \(session.code)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { toolbar }
            .safeAreaInset(edge: .top) {
                if session.connectionTrouble {
                    Label("Reconnecting…", systemImage: "wifi.exclamationmark")
                        .font(.caption)
                        .padding(6)
                        .frame(maxWidth: .infinity)
                        .background(Palette.ember.opacity(0.85))
                }
            }
        }
        .sheet(isPresented: $session.chatOpen) {
            ChatView(session: session)
                .presentationDetents([.medium, .large])
                .presentationBackground(Palette.ink)
        }
        .sheet(isPresented: $showChronicle) {
            ChronicleView(session: session)
                .presentationBackground(Palette.ink)
        }
        .sheet(isPresented: $showMap) {
            DungeonMapView(session: session)
                .presentationBackground(Palette.ink)
        }
        .sheet(item: $sheetHero) { target in
            // Read from the session each time, so the sheet keeps up with the game: in a rules game
            // the player's character is the hero as it stands (hit points, level, slots, gear).
            if let player = session.state.player(target.playerId) {
                HeroSheetScreen(character: player.character,
                                live: session.state.live(of: target.playerId),
                                tab: Binding(get: { sheetTabs[target.playerId] ?? .launchDefault },
                                             set: { sheetTabs[target.playerId] = $0 }))
            }
        }
        .task(id: hasMap) {
            // Debug launch arguments. The pause lets this screen finish arriving before a sheet goes over it.
            let named = AppConfig.openSheetOfArgument
            guard AppConfig.showMapArgument || AppConfig.openMySheetArgument || AppConfig.showChronicleArgument || named != nil else { return }
            try? await Task.sleep(for: .milliseconds(700))
            guard !Task.isCancelled else { return }
            if AppConfig.openMySheetArgument || named != nil {
                let target = named.flatMap { name in
                    session.state.players.first { $0.character.name.localizedCaseInsensitiveContains(name) }?.playerId
                } ?? session.playerId
                if !sheetShownForLaunch && session.state.player(target) != nil {
                    sheetShownForLaunch = true
                    sheetHero = SheetHero(playerId: target)
                }
            } else if AppConfig.showChronicleArgument {
                if !mapShownForLaunch && !(session.state.chronicle ?? []).isEmpty {
                    mapShownForLaunch = true
                    showChronicle = true
                }
            } else if hasMap && !mapShownForLaunch {
                mapShownForLaunch = true
                showMap = true
            }
        }
        .onDisappear { narrator.stop() }
        .confirmationDialog("Leave the party?", isPresented: $confirmLeave, titleVisibility: .visible) {
            Button("Leave", role: .destructive) { Task { await model.leaveGame() } }
        } message: {
            Text("The others can carry on without you.")
        }
    }

    @ToolbarContentBuilder private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .cancellationAction) {
            if session.state.status == .ended {
                Button("Done") { model.closeGame() }
            } else {
                Menu {
                    Button("Close (stay in party)", systemImage: "arrow.down.right.and.arrow.up.left") { model.closeGame() }
                    Button("Leave party", systemImage: "figure.walk.departure", role: .destructive) { confirmLeave = true }
                } label: { Image(systemName: "xmark") }
            }
        }
        ToolbarItemGroup(placement: .primaryAction) {
            // A server from before the rules engine sends no sheet: nothing to open.
            if session.me?.character.sheet != nil {
                Button { sheetHero = SheetHero(playerId: session.playerId) } label: { Image(systemName: "person.text.rectangle") }
                    .accessibilityLabel("My hero")
            }
            if hasMap {
                Button { showMap = true } label: { Image(systemName: "map") }
                    .accessibilityLabel("The dungeon map")
            }
            if !(session.state.chronicle ?? []).isEmpty {
                Button { showChronicle = true } label: { Image(systemName: "book.pages") }
                    .accessibilityLabel("The story so far")
            }
            Button { session.chatOpen = true } label: {
                Image(systemName: "bubble.left.and.bubble.right")
                    .overlay(alignment: .topTrailing) {
                        if session.unreadChat > 0 {
                            Text("\(min(session.unreadChat, 99))")
                                .font(.system(size: 10, weight: .bold))
                                .padding(.horizontal, 4).padding(.vertical, 1)
                                .background(Palette.ember, in: .capsule)
                                .foregroundStyle(.white)
                                .offset(x: 10, y: -8)
                        }
                    }
            }
            .accessibilityLabel("Party chat")
        }
    }
}

/// Between "start" and the first scene.
struct PreparingView: View {
    let title: String?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var doorOpen = false

    var body: some View {
        VStack(spacing: 22) {
            Spacer()
            DoorMark(open: doorOpen).frame(width: 110)
                .onAppear {
                    // The door creaks open; with Reduce Motion it simply stands open.
                    if reduceMotion { doorOpen = true } else {
                        withAnimation(.easeOut(duration: 1.8).delay(0.25)) { doorOpen = true }
                    }
                }
            Text(title ?? "The door creaks open…")
                .font(.display(26, weight: .bold))
                .multilineTextAlignment(.center)
            TimelineView(.periodic(from: .now, by: 3.5)) { context in
                let lines = ["The dungeon master is sketching the map…", "Rolling for the weather…",
                             "Placing something nasty in the dark…", "Lighting the first torch…"]
                let i = Int(context.date.timeIntervalSinceReferenceDate / 3.5) % lines.count
                Text(lines[i]).font(.prose.italic()).foregroundStyle(Palette.muted)
                    .contentTransition(.opacity).animation(.easeInOut, value: i)
            }
            ProgressView().tint(Palette.gold)
            Spacer()
        }
        .padding(30)
        // Fill the screen: the backdrop behind this view is only as wide as the view itself.
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
