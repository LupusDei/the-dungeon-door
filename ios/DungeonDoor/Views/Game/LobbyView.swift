import SwiftUI

/// Gathering the party: share the code, see who's here, pick the dungeon master, the kind of game
/// and its length, start.
struct LobbyView: View {
    @Environment(AppModel.self) private var model
    @Bindable var session: GameSession
    @State private var sceneCount = 4
    @State private var pickingDM = false
    /// The host's pick. Empty until they tap, so the default can follow the catalog as it loads.
    @State private var dungeon = ""
    /// Players this one has adventured with, who can be invited by name.
    @State private var companions: [Companion] = []
    /// Companions invited from this lobby, by player id.
    @State private var invited: Set<String> = []

    private var state: GameState { session.state }
    /// The kinds of game this server can start. None on a server that only tells stories.
    private var dungeons: [CatalogOption] { model.catalog?.dungeons ?? [] }

    /// The kind of game on show: the host's pick, else the `-lobbyAdventure` argument, else the
    /// first the catalog lists (a tale told).
    private var chosenDungeon: String? {
        if dungeons.contains(where: { $0.id == dungeon }) { return dungeon }
        if let asked = AppConfig.lobbyAdventureArgument, dungeons.contains(where: { $0.id == asked }) { return asked }
        return dungeons.first?.id
    }

    /// A fixed dungeon's map follows the length: up to 4 scenes is 5 rooms, 5 or 6 is 7, 7 or 8 is 9.
    private var rooms: Int { sceneCount <= 4 ? 5 : sceneCount <= 6 ? 7 : 9 }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 26) {
                codeCard
                party
                companionsToCall
                dungeonMaster
                chatPeek
                if model.catalog?.push == true { NotificationsRow() }
                if session.isHost { hostControls } else { waiting }
                ErrorLine(text: session.error)
            }
            .padding(20)
            .frame(maxWidth: 640)
            .frame(maxWidth: .infinity)
        }
        .defaultScrollAnchor(AppConfig.launchScrollAnchor)
        .sheet(isPresented: $pickingDM) { dmSheet }
        .task { companions = (try? await model.api.companions()) ?? [] }
    }

    /// Companions who are not here yet, each a tap away from an invitation. Nothing for a player
    /// who has not adventured with anyone, or once the party is full.
    @ViewBuilder private var companionsToCall: some View {
        let here = Set(state.players.map(\.playerId))
        let absent = companions.filter { !here.contains($0.playerId) }.prefix(6)
        if !absent.isEmpty && state.players.count < 6 {
            VStack(alignment: .leading, spacing: 10) {
                SectionLabel("Call your companions")
                VStack(spacing: 0) {
                    ForEach(Array(absent.enumerated()), id: \.element.id) { index, companion in
                        if index > 0 {
                            Rectangle().fill(Palette.gold.opacity(0.14)).frame(height: 1).padding(.leading, 14)
                        }
                        HStack(spacing: 10) {
                            Image(systemName: "person.fill")
                                .font(.system(size: 13))
                                .foregroundStyle(Palette.muted)
                                .frame(width: 22)
                                .accessibilityHidden(true)
                            Text(companion.name).font(.serif(.body, weight: .semibold))
                            Spacer(minLength: 8)
                            if invited.contains(companion.playerId) {
                                Label("Invited", systemImage: "checkmark")
                                    .font(.serif(.footnote, weight: .semibold))
                                    .foregroundStyle(Palette.verdigris)
                            } else {
                                Button("Invite") { Task { await invite(companion) } }
                                    .font(.serif(.footnote, weight: .semibold))
                                    .foregroundStyle(Palette.gold)
                                    .padding(.horizontal, 12)
                                    .padding(.vertical, 6)
                                    .overlay { Capsule().strokeBorder(Palette.gold.opacity(0.6), lineWidth: 1) }
                                    .buttonStyle(.plain)
                            }
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .frame(minHeight: 46)
                    }
                }
                .card()
                Text(model.catalog?.push == true
                     ? "They get a notification and find your door on their home screen."
                     : "They find your door on their home screen.")
                    .font(.caption)
                    .foregroundStyle(Palette.muted)
            }
        }
    }

    private func invite(_ companion: Companion) async {
        do {
            try await model.api.invite(session.code, playerId: companion.playerId)
            invited.insert(companion.playerId)
        } catch {
            session.error = error.localizedDescription
        }
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
                            if player.outdated {
                                Text("Needs update")
                                    .font(.caption2.weight(.semibold))
                                    .foregroundStyle(Palette.ember)
                            }
                        }
                        Text(describe(player.character)).font(.caption).foregroundStyle(Palette.muted)
                        if let vitals = player.character.vitalsLine {
                            Text(vitals)
                                .font(.caption2.weight(.semibold))
                                .monospacedDigit()
                                .foregroundStyle(Palette.verdigris)
                        }
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
        // A server that only tells stories sends no kinds of game: the length stepper and nothing else.
        let kind = chosenDungeon
        return VStack(spacing: 14) {
            if !dungeons.isEmpty { dungeonPicker }
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Length").font(.display(16))
                        Text("\(sceneCount) scenes, finale included").font(.caption).foregroundStyle(Palette.muted)
                    }
                    Spacer()
                    Stepper("Scenes", value: $sceneCount, in: 2...8).labelsHidden()
                }
                if let note = lengthNote(kind) {
                    Label(note, systemImage: kind == "fixed" ? "map" : "info.circle")
                        .font(.footnote)
                        .foregroundStyle(Palette.parchment.opacity(0.8))
                        .fixedSize(horizontal: false, vertical: true)
                        .contentTransition(.numericText())
                        .animation(.snappy, value: rooms)
                }
            }
            .padding(14)
            .card()
            Button {
                Task { await session.begin(sceneCount: sceneCount, dungeon: kind) }
            } label: {
                if session.busy { ProgressView().tint(Palette.ink) } else { Label("Open the door", systemImage: "door.left.hand.open") }
            }
            .buttonStyle(.gilded)
            .disabled(session.busy || updateHold != nil)
            if let updateHold {
                Text(updateHold)
                    .font(.footnote)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(Palette.ember)
            } else if state.players.count == 1 {
                Text("You can go alone, or wait for friends to knock.")
                    .font(.footnote.italic()).foregroundStyle(Palette.muted)
            }
        }
    }

    /// What the length means for the kind of game picked.
    private func lengthNote(_ kind: String?) -> String? {
        switch kind {
        case "fixed":
            "A dungeon of \(rooms) rooms. The map grows with the length: up to 4 scenes is 5 rooms, 5 or 6 is 7 rooms, 7 or 8 is 9 rooms."
        case nil:
            nil
        default:
            "Every round of a fight is a scene of its own, on top of these."
        }
    }

    private var dungeonPicker: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel("Kind of game")
            ForEach(dungeons) { option in
                let selected = option.id == chosenDungeon
                Button {
                    withAnimation(.snappy) { dungeon = option.id }
                } label: {
                    HStack(alignment: .top, spacing: 14) {
                        ZStack {
                            Circle().fill(Palette.gold.opacity(0.16))
                            Image(systemName: option.symbol ?? "book.closed")
                                .font(.system(size: 20))
                                .foregroundStyle(Palette.gold)
                        }
                        .frame(width: 44, height: 44)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(option.name).font(.display(17)).multilineTextAlignment(.leading)
                            if let blurb = option.blurb, !blurb.isEmpty {
                                Text(blurb)
                                    .font(.footnote)
                                    .foregroundStyle(Palette.muted)
                                    .multilineTextAlignment(.leading)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        Spacer(minLength: 0)
                        if selected { Image(systemName: "checkmark.seal.fill").foregroundStyle(Palette.gold) }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(14)
                    .card(highlighted: selected)
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selected ? .isSelected : [])
            }
        }
    }

    private var waiting: some View {
        HStack(spacing: 10) {
            if updateHold == nil { ProgressView().tint(Palette.gold) }
            Text(updateHold ?? "Waiting for \(state.player(state.hostId)?.character.name ?? "the host") to open the door…")
                .font(.proseSmall.italic())
                .foregroundStyle(updateHold == nil ? Palette.muted : Palette.ember)
                .multilineTextAlignment(.leading)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
    }

    /// Who has to update before the door can open, in the same words the server uses when start is refused.
    private var updateHold: String? {
        let names = state.players.filter(\.outdated).map(\.character.name)
        guard let first = names.first else { return nil }
        let who: String
        if names.count == 1 {
            who = first
        } else if names.count == 2 {
            who = "\(first) and \(names[1])"
        } else {
            who = "\(names.dropLast().joined(separator: ", ")) and \(names[names.count - 1])"
        }
        return "\(who) \(names.count == 1 ? "needs" : "need") to update the app before the adventure can begin."
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
