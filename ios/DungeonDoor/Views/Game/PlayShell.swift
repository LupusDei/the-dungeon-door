import SwiftUI

enum PlayTab: String, CaseIterable, Identifiable, Hashable {
    case story, sheet, map, chat

    var id: String { rawValue }

    var title: String {
        switch self {
        case .story: "Story"
        case .sheet: "Sheet"
        case .map: "Map"
        case .chat: "Chat"
        }
    }

    var symbol: String {
        switch self {
        case .story: "book.pages"
        case .sheet: "person.text.rectangle"
        case .map: "square.grid.3x3"
        case .chat: "bubble.left.and.bubble.right"
        }
    }
}

enum PlaySheetPane: String, CaseIterable, Identifiable, Hashable {
    case abilities, saves, attacks, spells, items, features

    var id: String { rawValue }

    var title: String {
        switch self {
        case .abilities: "Abilities & Skills"
        case .saves: "Saves"
        case .attacks: "Attacks"
        case .spells: "Spells"
        case .items: "Items"
        case .features: "Features"
        }
    }
}

/// The game, once the door is open: the party's heads-up display, one Act chip, and four tabs.
struct PlayShell: View {
    @Environment(AppModel.self) private var model
    @Bindable var session: GameSession
    var narrator: Narrator
    var hidesNavigation = false

    @State private var tab: PlayTab
    @State private var pane: PlaySheetPane
    @State private var focusOffers: Int
    /// Offer-focuses already scrolled. Kept here so opening Story again does not jump down.
    @State private var offersSeen: Int
    @State private var pending: LegalAction?
    @State private var pendingIntent = ""
    @State private var mapTarget: String?

    init(session: GameSession, narrator: Narrator,
         initialTab: PlayTab = .story, initialPane: PlaySheetPane = .abilities,
         mapTarget: String? = nil, scrollOffers: Bool = false, hidesNavigation: Bool = false) {
        self.session = session
        self.narrator = narrator
        self.hidesNavigation = hidesNavigation
        _tab = State(initialValue: initialTab)
        _pane = State(initialValue: initialPane)
        _mapTarget = State(initialValue: mapTarget)
        _focusOffers = State(initialValue: scrollOffers ? 1 : 0)
        _offersSeen = State(initialValue: 0)
    }

    private var state: GameState { session.state }
    private var inCombat: Bool { state.scene?.combat == true }

    var body: some View {
        VStack(spacing: 0) {
            PartyHUD(session: session)
            PlayActBar(session: session, choose: focusStory)
            if inCombat, let hud = state.rules?.combat?.hud {
                Rectangle().fill(Palette.gold.opacity(0.2)).frame(height: 1)
                CombatHUD(hud: hud, me: session.playerId)
            }
            Rectangle().fill(Palette.gold.opacity(0.2)).frame(height: 1)
            tabBody
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .clipped()
                .overlay {
                    // The Story tab draws this on its own page, and leaves the tab bar free.
                    if tab != .story, state.status == .resolving, let scene = state.scene {
                        ResolvingOverlay(scene: scene, players: state.players, coversChrome: false)
                    }
                }
            PlayTabBar(tab: $tab, inCombat: inCombat, unread: session.unreadChat)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .toolbar(hidesNavigation ? .hidden : .automatic, for: .navigationBar)
        .onAppear { session.setChatVisible(tab == .chat) }
        .onChange(of: tab) { _, new in session.setChatVisible(new == .chat) }
        .sheet(item: $pending) { action in
            TargetPicker(action: action) { targets in
                let words = pendingIntent
                pending = nil
                pendingIntent = ""
                Task {
                    await session.vote(actionId: action.id, targets: targets, intent: words)
                    focusStory()
                }
            } cancel: {
                pending = nil
                pendingIntent = ""
            }
            .presentationDetents([.medium])
            .presentationBackground(Palette.ink)
        }
        .overlay {
            if let notice = session.levelUp {
                LevelUpOverlay(notice: notice) {
                    withAnimation(.easeOut(duration: 0.25)) { session.levelUp = nil }
                }
            }
        }
        .animation(.easeInOut, value: state.status)
        .animation(.spring(duration: 0.5, bounce: 0.3), value: session.levelUp)
        .task(id: state.scene?.index) {
            narrator.offer(model.catalog)
            narrator.arrived(at: state.scene, in: session)
        }
        .onChange(of: model.catalog?.narrators) { _, _ in narrator.offer(model.catalog) }
    }

    @ViewBuilder private var tabBody: some View {
        switch tab {
        case .story:
            PlayStoryPage(session: session, narrator: narrator, focusOffers: focusOffers,
                          offersSeen: $offersSeen, openMap: { withAnimation(.snappy) { tab = .map } })
        case .sheet:
            PlaySheetPage(session: session, pane: $pane, onStory: focusStory) { action, intent in
                consider(action, intent: intent)
            }
        case .map:
            PlayMapPage(session: session, initialTarget: mapTarget)
        case .chat:
            PlayChatPage(session: session)
        }
    }

    private func focusStory() {
        withAnimation(.snappy) { tab = .story }
        focusOffers += 1
    }

    /// Sends the action, asks who it names, or opens the map when the move is a square.
    /// After a vote, Story is showing again.
    private func consider(_ action: LegalAction, intent: String = "") {
        if action.kind == "move", !action.squares.isEmpty {
            withAnimation(.snappy) { tab = .map }
            return
        }
        guard action.available, PlayTurn.canSend(status: state.status, scene: state.scene, busy: session.busy) else { return }
        if action.picks == "one" && action.targets.count > 1 {
            pending = action
            pendingIntent = intent
            return
        }
        if action.picks == "many" && action.targets.count > 1 {
            pending = action
            pendingIntent = intent
            return
        }
        var targets: [String] = []
        if action.targets.count == 1, action.picks == "one" || action.picks == "many" {
            targets = [action.targets[0].id]
        }
        Task {
            await session.vote(actionId: action.id, targets: targets, intent: intent)
            focusStory()
        }
    }
}

// MARK: - Act bar

struct PlayActBar: View {
    @Bindable var session: GameSession
    var choose: () -> Void

    private var scene: GameScene? { session.state.scene }
    private var chosen: String? {
        guard let scene else { return nil }
        return PlayTurn.chosenLine(scene: scene, playerId: session.playerId)
    }
    private var canSend: Bool {
        PlayTurn.canSend(status: session.state.status, scene: scene, busy: session.busy)
    }

    var body: some View {
        HStack(spacing: 10) {
            if let chosen, let scene {
                if let roll = PlayTurn.roll(scene: scene, playerId: session.playerId) {
                    D20Badge(roll: roll, size: 32)
                }
                VStack(alignment: .leading, spacing: 1) {
                    Text("Voted").font(.system(size: 10, weight: .semibold, design: .serif)).foregroundStyle(Palette.muted)
                    Text(chosen)
                        .font(.serif(.subheadline, weight: .bold))
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                }
                Spacer(minLength: 0)
                if canSend {
                    Button("Change", action: choose)
                        .font(.serif(.caption, weight: .semibold))
                        .foregroundStyle(Palette.gold)
                        .accessibilityLabel("Change your action")
                }
            } else {
                Image(systemName: "wand.and.stars")
                    .foregroundStyle(Palette.gold)
                    .frame(width: 28)
                VStack(alignment: .leading, spacing: 1) {
                    Text("Act").font(.serif(.subheadline, weight: .bold))
                    Text(hint)
                        .font(.system(size: 11, design: .serif))
                        .foregroundStyle(Palette.muted)
                        .lineLimit(2)
                        .minimumScaleFactor(0.8)
                }
                Spacer(minLength: 0)
                if canSend {
                    Button(action: choose) {
                        Text("Choose")
                            .font(.serif(.caption, weight: .semibold))
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .background(Palette.gold, in: Capsule())
                            .foregroundStyle(Palette.ink)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Choose an action")
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(Palette.surface)
    }

    private var hint: String {
        if scene?.canAct == false { return "You cannot act this round." }
        if session.state.status == .resolving { return "The table is resolving." }
        if session.state.status != .voting { return "Waiting for the next scene." }
        if scene?.combat == true { return "Attack, cast, move, or another action." }
        return "A scene offer, or write in your own words."
    }
}

// MARK: - Tab bar

struct PlayTabBar: View {
    @Binding var tab: PlayTab
    var inCombat: Bool
    var unread: Int

    var body: some View {
        HStack(spacing: 0) {
            ForEach(PlayTab.allCases) { item in
                Button {
                    withAnimation(.snappy) { tab = item }
                } label: {
                    VStack(spacing: 3) {
                        ZStack(alignment: .topTrailing) {
                            Image(systemName: item.symbol)
                                .font(.system(size: 18, weight: tab == item ? .semibold : .regular))
                                .foregroundStyle(tab == item ? Palette.gold : Palette.muted)
                                .frame(height: 22)
                            if item == .chat, unread > 0 {
                                Text("\(min(unread, 99))")
                                    .font(.system(size: 9, weight: .bold))
                                    .padding(.horizontal, 4)
                                    .padding(.vertical, 1)
                                    .background(Palette.ember, in: Capsule())
                                    .foregroundStyle(.white)
                                    .offset(x: 12, y: -6)
                            }
                            if item == .map, inCombat {
                                Circle()
                                    .fill(Palette.ember)
                                    .frame(width: 7, height: 7)
                                    .offset(x: 10, y: -2)
                                    .accessibilityHidden(true)
                            }
                        }
                        Text(item.title)
                            .font(.system(size: 11, weight: tab == item ? .semibold : .regular, design: .serif))
                            .foregroundStyle(tab == item ? Palette.gold : Palette.muted)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.top, 8)
                    .padding(.bottom, 6)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(label(item))
                .accessibilityAddTraits(tab == item ? .isSelected : [])
            }
        }
        .background(Palette.ink.ignoresSafeArea(edges: .bottom))
        .overlay(alignment: .top) { Rectangle().fill(Palette.gold.opacity(0.25)).frame(height: 1) }
    }

    private func label(_ item: PlayTab) -> String {
        var parts = [item.title]
        if item == .chat, unread > 0 { parts.append("\(unread) unread") }
        if item == .map, inCombat { parts.append("battle in progress") }
        return parts.joined(separator: ", ")
    }
}

// MARK: - Who the action names

private struct TargetPicker: View {
    let action: LegalAction
    var send: ([String]) -> Void
    var cancel: () -> Void
    @State private var picked: [String] = []

    private var many: Bool { action.picks == "many" }
    private var limit: Int { action.limit ?? action.targets.count }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    Text(many ? "Choose up to \(limit)." : "Choose one.")
                        .font(.serif(.caption))
                        .foregroundStyle(Palette.muted)
                    ForEach(action.targets) { target in
                        Button { toggle(target.id) } label: {
                            HStack {
                                Text(target.name)
                                    .font(.serif(.body, weight: .semibold))
                                    .foregroundStyle(Palette.parchment)
                                    .fixedSize(horizontal: false, vertical: true)
                                Spacer(minLength: 8)
                                if picked.contains(target.id) {
                                    Image(systemName: "checkmark.circle.fill").foregroundStyle(Palette.gold)
                                }
                            }
                            .padding(12)
                            .card(highlighted: picked.contains(target.id))
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(16)
            }
            .screenChrome()
            .navigationTitle(action.label)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel", action: cancel) }
                if many {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Vote") { send(picked) }
                            .disabled(picked.isEmpty)
                    }
                }
            }
        }
    }

    private func toggle(_ id: String) {
        if !many {
            send([id])
            return
        }
        if let index = picked.firstIndex(of: id) {
            picked.remove(at: index)
            return
        }
        guard picked.count < limit else { return }
        picked.append(id)
    }
}
