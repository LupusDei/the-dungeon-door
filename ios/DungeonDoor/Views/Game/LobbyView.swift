import SwiftUI

/// Gathering the party: share the code, see who's here, pick the dungeon master, start.
struct LobbyView: View {
    @Environment(AppModel.self) private var model
    @Bindable var session: GameSession
    @State private var sceneCount = 4
    @State private var pickingDM = false

    private var state: GameState { session.state }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 26) {
                codeCard
                party
                dungeonMaster
                chatPeek
                if session.isHost { hostControls } else { waiting }
                ErrorLine(text: session.error)
            }
            .padding(20)
            .frame(maxWidth: 640)
            .frame(maxWidth: .infinity)
        }
        .sheet(isPresented: $pickingDM) { dmSheet }
    }

    private var codeCard: some View {
        VStack(spacing: 12) {
            SectionLabel("Door code")
            CodeTiles(code: session.code, size: 44)
            ShareLink(item: "Join my party in The Dungeon Door — the door code is \(session.code).") {
                Label("Invite friends", systemImage: "square.and.arrow.up")
                    .font(.proseSmall)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(18)
        .card()
    }

    private var party: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel("The party · \(state.players.count)/6")
            ForEach(state.players) { player in
                HStack(spacing: 12) {
                    PortraitView(url: player.character.portraitURL, size: 56, circular: true)
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            Text(player.character.name).font(.display(17))
                            if player.isHost {
                                Image(systemName: "crown.fill").font(.caption).foregroundStyle(Palette.gold)
                            }
                            if player.playerId == session.playerId {
                                Text("you").font(.caption2).foregroundStyle(Palette.muted)
                            }
                        }
                        Text(describe(player.character)).font(.caption).foregroundStyle(Palette.muted)
                    }
                    Spacer()
                }
                .padding(10)
                .card()
                .transition(.move(edge: .leading).combined(with: .opacity))
            }
        }
        .animation(.snappy, value: state.players.map(\.playerId))
    }

    @ViewBuilder private var dungeonMaster: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel("Dungeon master")
            if let dm = model.catalog?.dungeonMaster(state.dungeonMaster) {
                Button { if session.isHost { pickingDM = true } } label: {
                    DungeonMasterRow(dm: dm, selected: true)
                        .overlay(alignment: .bottomTrailing) {
                            if session.isHost {
                                Text("Change").font(.caption.weight(.semibold)).foregroundStyle(Palette.gold).padding(12)
                            }
                        }
                }
                .buttonStyle(.plain)
            } else {
                Text(state.dungeonMaster).font(.display(17))
            }
        }
    }

    private var chatPeek: some View {
        Button { session.chatOpen = true } label: {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    SectionLabel("Party chat")
                    Spacer()
                    Image(systemName: "chevron.up").foregroundStyle(Palette.muted)
                }
                let recent = session.messages.suffix(3)
                if recent.isEmpty {
                    Text("Say hello while you wait for the others.").font(.footnote.italic()).foregroundStyle(Palette.muted)
                } else {
                    ForEach(Array(recent)) { message in
                        MessageLine(message: message, compact: true, isMine: message.playerId == session.playerId)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .card()
        }
        .buttonStyle(.plain)
    }

    private var hostControls: some View {
        VStack(spacing: 14) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Length").font(.display(16))
                    Text("\(sceneCount) scenes, finale included").font(.caption).foregroundStyle(Palette.muted)
                }
                Spacer()
                Stepper("Scenes", value: $sceneCount, in: 2...8).labelsHidden()
            }
            .padding(14)
            .card()
            Button {
                Task { await session.begin(sceneCount: sceneCount) }
            } label: {
                if session.busy { ProgressView().tint(Palette.ink) } else { Label("Open the door", systemImage: "door.left.hand.open") }
            }
            .buttonStyle(.gilded)
            .disabled(session.busy)
            if state.players.count == 1 {
                Text("You can go alone, or wait for friends to knock.")
                    .font(.footnote.italic()).foregroundStyle(Palette.muted)
            }
        }
    }

    private var waiting: some View {
        HStack(spacing: 10) {
            ProgressView().tint(Palette.gold)
            Text("Waiting for \(state.player(state.hostId)?.character.name ?? "the host") to open the door…")
                .font(.proseSmall.italic())
                .foregroundStyle(Palette.muted)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
    }

    private var dmSheet: some View {
        NavigationStack {
            ScrollView {
                DungeonMasterPicker(
                    masters: model.catalog?.dungeonMasters ?? [],
                    selection: Binding(
                        get: { state.dungeonMaster },
                        set: { id in
                            pickingDM = false
                            Task { await session.chooseDungeonMaster(id) }
                        }))
                    .padding(20)
            }
            .screenChrome()
            .navigationTitle("Choose your DM")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { pickingDM = false } } }
        }
        .presentationBackground(Palette.ink)
    }

    private func describe(_ c: Character) -> String {
        guard let catalog = model.catalog else { return c.characterClass.capitalized }
        return "\(catalog.name(c.race, in: \.races)) \(catalog.name(c.characterClass, in: \.classes)) · \(catalog.name(c.temperament, in: \.temperaments))"
    }
}
