import SwiftUI

/// The whole game, full screen: lobby, then scenes, then the finale. Chat and the chronicle
/// open as sheets from the toolbar.
struct GameView: View {
    @Environment(AppModel.self) private var model
    @Bindable var session: GameSession
    @State private var showChronicle = false
    @State private var confirmLeave = false

    var body: some View {
        NavigationStack {
            Group {
                switch session.state.status {
                case .lobby:
                    LobbyView(session: session)
                case .preparing where session.state.scene == nil:
                    PreparingView(title: session.state.title)
                default:
                    SceneView(session: session)
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
            ChronicleView(entries: session.state.chronicle ?? [], title: session.state.title)
                .presentationBackground(Palette.ink)
        }
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
    var body: some View {
        VStack(spacing: 22) {
            Spacer()
            DoorMark(open: true).frame(width: 110)
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
    }
}
