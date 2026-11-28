import SwiftUI

/// Gathering the party: share the code, see who's here, pick the dungeon master, the kind of game,
/// how it is told and its length, start.
struct LobbyView: View {
    @Environment(AppModel.self) private var model
    @Bindable var session: GameSession
    @State private var sceneCount = AppConfig.lobbyScenesArgument ?? 4
    @State private var pickingDM = false
    /// The host's pick. Empty until they tap, so the default can follow the catalog as it loads.
    @State private var dungeon = ""
    /// The host's pick of how the game is told. Empty until they tap, as above.
    @State private var telling = ""

    /// The people this player has adventured with, who can be called to this door (Companions.swift).
    @State private var companions: [Companion] = []

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

    /// The ways this server can tell a game. None on a server from before tellings: no picker, and
    /// the start names none (the full story).
    private var tellings: [CatalogOption] { model.catalog?.tellings ?? [] }

    /// How the game will be told: the host's pick, else the `-lobbyTelling` argument, else the
    /// first the catalog lists (the full story).
    private var chosenTelling: String? {
        if tellings.contains(where: { $0.id == telling }) { return telling }
        if let asked = AppConfig.lobbyTellingArgument, tellings.contains(where: { $0.id == asked }) { return asked }
        return tellings.first?.id
    }

    /// A fixed dungeon's map follows the length: up to 4 scenes is 5 rooms, 5 or 6 is 7, 7 or 8 is 9.
    private var rooms: Int { sceneCount <= 4 ? 5 : sceneCount <= 6 ? 7 : 9 }
    /// The stepper's last stop, past the longest set length: no set length.
    private static let noLimitStep = 9
    private var noSetLength: Bool { sceneCount >= Self.noLimitStep }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 26) {
                codeCard
                party
                CompanionsToCall(session: session, companions: $companions)
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
            YourNameRow()
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
            if tellings.count > 1 { tellingPicker }
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Length").font(.display(16))
                        Text(noSetLength ? "No set length" : "\(sceneCount) scenes, finale included")
                            .font(.caption).foregroundStyle(Palette.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer()
                    // One step past the longest is no set length.
                    Stepper("Scenes", value: $sceneCount, in: 2...Self.noLimitStep).labelsHidden()
                        .accessibilityValue(noSetLength ? "No set length" : "\(sceneCount) scenes")
                }
                if noSetLength {
                    Label("It goes on for as long as the party likes. As host you call the ending from the Story tab; the scene being played is then the last.",
                          systemImage: "infinity")
                        .font(.footnote)
                        .foregroundStyle(Palette.parchment.opacity(0.8))
                        .fixedSize(horizontal: false, vertical: true)
                } else if let note = lengthNote(kind) {
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
                // 0 asks the server for no set length.
                Task { await session.begin(sceneCount: noSetLength ? 0 : sceneCount, dungeon: kind, telling: chosenTelling) }
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

    /// How the game is told: in full, or streamlined (the same game in a line or two). One row for
    /// each, shorter than the kinds of game above: it is a setting of the game picked there.
    private var tellingPicker: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel("How it is told")
            VStack(spacing: 0) {
                ForEach(Array(tellings.enumerated()), id: \.element.id) { index, option in
                    let selected = option.id == chosenTelling
                    if index > 0 {
                        Rectangle().fill(Palette.gold.opacity(0.14)).frame(height: 1).padding(.leading, 14)
                    }
                    Button {
                        withAnimation(.snappy) { telling = option.id }
                    } label: {
                        HStack(alignment: .top, spacing: 12) {
                            Image(systemName: option.symbol ?? "text.book.closed")
                                .font(.system(size: 17))
                                .foregroundStyle(Palette.gold)
                                .frame(width: 26)
                                .padding(.top, 2)
                                .accessibilityHidden(true)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(option.name).font(.display(16)).multilineTextAlignment(.leading)
                                if let blurb = option.blurb, !blurb.isEmpty {
                                    Text(blurb)
                                        .font(.footnote)
                                        .foregroundStyle(Palette.muted)
                                        .multilineTextAlignment(.leading)
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                            }
                            Spacer(minLength: 0)
                            Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                                .foregroundStyle(selected ? Palette.gold : Palette.muted)
                                .padding(.top, 2)
                                .accessibilityHidden(true)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(14)
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("telling-\(option.id)")
                    .accessibilityAddTraits(selected ? .isSelected : [])
                }
            }
            .card()
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
