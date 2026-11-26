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

/// The game, once the door is open: a slim vitals strip, one Act chip, and four tabs.
struct PlayShell: View {
    @Environment(AppModel.self) private var model
    @Bindable var session: GameSession
    var narrator: Narrator
    var openHero: (String) -> Void
    var hidesNavigation = false

    @State private var tab: PlayTab
    @State private var pane: PlaySheetPane
    @State private var focusOffers: Int
    @State private var pending: LegalAction?
    @State private var mapTarget: String?

    init(session: GameSession, narrator: Narrator, openHero: @escaping (String) -> Void,
         initialTab: PlayTab = .story, initialPane: PlaySheetPane = .abilities,
         mapTarget: String? = nil, scrollOffers: Bool = false, hidesNavigation: Bool = false) {
        self.session = session
        self.narrator = narrator
        self.openHero = openHero
        self.hidesNavigation = hidesNavigation
        _tab = State(initialValue: initialTab)
        _pane = State(initialValue: initialPane)
        _mapTarget = State(initialValue: mapTarget)
        _focusOffers = State(initialValue: scrollOffers ? 1 : 0)
    }

    private var state: GameState { session.state }
    private var inCombat: Bool { state.scene?.combat == true }

    var body: some View {
        VStack(spacing: 0) {
            PlayTopStrip(session: session)
            PlayActBar(session: session, choose: focusStory)
            Rectangle().fill(Palette.gold.opacity(0.2)).frame(height: 1)
            tabBody
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .clipped()
            PlayTabBar(tab: $tab, inCombat: inCombat, unread: session.unreadChat)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .toolbar(hidesNavigation ? .hidden : .automatic, for: .navigationBar)
        .onAppear { session.setChatVisible(tab == .chat) }
        .onChange(of: tab) { _, new in session.setChatVisible(new == .chat) }
        .sheet(item: $pending) { action in
            TargetPicker(action: action) { targets in
                pending = nil
                Task { await session.vote(actionId: action.id, targets: targets) }
            } cancel: {
                pending = nil
            }
            .presentationDetents([.medium])
            .presentationBackground(Palette.ink)
        }
        .overlay {
            if state.status == .resolving, let scene = state.scene {
                ResolvingOverlay(scene: scene, players: state.players)
            }
        }
        .overlay {
            if let notice = session.levelUp {
                LevelUpOverlay(notice: notice) {
                    withAnimation(.easeOut(duration: 0.25)) { session.levelUp = nil }
                } showSheet: {
                    session.levelUp = nil
                    openHero(session.playerId)
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
                          openHero: openHero, onOffer: considerOffer)
        case .sheet:
            PlaySheetPage(session: session, pane: $pane, onAction: consider)
        case .map:
            PlayMapPage(session: session, initialTarget: mapTarget, openHero: openHero)
        case .chat:
            PlayChatPage(session: session)
        }
    }

    private func focusStory() {
        withAnimation(.snappy) { tab = .story }
        focusOffers += 1
    }

    private func considerOffer(_ offer: TableOffer) {
        if let action = offer.action {
            consider(action)
        } else if let choice = offer.choice, PlayTurn.canSend(status: state.status, scene: state.scene, busy: session.busy) {
            Task { await session.vote(choice) }
        }
    }

    /// Sends the action, asks who it names, or opens the map when the move is a square.
    private func consider(_ action: LegalAction) {
        if action.kind == "move", !action.squares.isEmpty {
            withAnimation(.snappy) { tab = .map }
            return
        }
        guard action.available, PlayTurn.canSend(status: state.status, scene: state.scene, busy: session.busy) else { return }
        if action.picks == "one" && action.targets.count > 1 {
            pending = action
            return
        }
        if action.picks == "many" && action.targets.count > 1 {
            pending = action
            return
        }
        var targets: [String] = []
        if action.targets.count == 1, action.picks == "one" || action.picks == "many" {
            targets = [action.targets[0].id]
        }
        Task { await session.vote(actionId: action.id, targets: targets) }
    }
}

// MARK: - Top strip

struct PlayTopStrip: View {
    @Bindable var session: GameSession

    private var me: Character? { session.me?.character }
    private var live: LiveHero? { session.state.live(of: session.playerId) }
    private var hp: Int { live?.standing.hp ?? me?.sheet?.hp ?? 0 }
    private var maxHp: Int { live?.standing.maxHp ?? me?.sheet?.maxHp ?? 1 }
    private var ac: Int { live?.standing.armorClass ?? me?.sheet?.armorClass ?? 10 }

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            PortraitView(url: me?.portraitURL, size: 32, circular: true)
            VStack(alignment: .leading, spacing: 2) {
                Text(me?.name ?? "Hero")
                    .font(.serif(.subheadline, weight: .bold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                HStack(spacing: 6) {
                    HPBar(hp: hp, maxHp: max(maxHp, 1),
                          tint: Health.tint(hp: hp, maxHp: max(maxHp, 1), standing: hp > 0), height: 5)
                        .frame(width: 72)
                    Text("\(hp)/\(maxHp)")
                        .font(.system(size: 11, weight: .semibold, design: .serif))
                        .monospacedDigit()
                        .foregroundStyle(Palette.muted)
                }
            }
            acBadge
            if !conditionNames.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 4) {
                        ForEach(conditionNames, id: \.self) { name in
                            Text(name)
                                .font(.system(size: 10, weight: .semibold, design: .serif))
                                .lineLimit(1)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 3)
                                .background(Palette.ember.opacity(0.25), in: Capsule())
                                .overlay { Capsule().strokeBorder(Palette.ember.opacity(0.6), lineWidth: 0.75) }
                        }
                    }
                }
                .frame(maxWidth: 120)
            }
            Spacer(minLength: 4)
            turnBadge
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(Palette.ink)
    }

    private var conditionNames: [String] {
        var seen = Set<String>()
        var names: [String] = []
        func add(_ id: String) {
            let key = id.lowercased()
            guard !key.isEmpty, seen.insert(key).inserted else { return }
            names.append(SRD.name(id))
        }
        for id in live?.conditions ?? [] { add(id) }
        for held in live?.standing.conditions ?? [] { add(held.condition) }
        return names
    }

    private var acBadge: some View {
        VStack(spacing: 0) {
            Text("AC").font(.system(size: 8, weight: .semibold, design: .serif)).foregroundStyle(Palette.muted)
            Text("\(ac)").font(.serif(.headline, weight: .bold)).monospacedDigit()
        }
        .frame(width: 36, height: 36)
        .background(Palette.surface, in: RoundedRectangle(cornerRadius: 8))
        .overlay { RoundedRectangle(cornerRadius: 8).strokeBorder(Palette.gold.opacity(0.35), lineWidth: 1) }
        .accessibilityLabel("Armour class \(ac)")
    }

    private var turnBadge: some View {
        let line = turnLine
        return VStack(alignment: .trailing, spacing: 1) {
            if session.state.scene?.combat == true, let round = session.state.rules?.combat?.round {
                Text("Round \(round)")
                    .font(.system(size: 10, weight: .semibold, design: .serif))
                    .foregroundStyle(Palette.gold)
            }
            Text(line)
                .font(.system(size: 11, weight: .semibold, design: .serif))
                .foregroundStyle(line == "Your turn" ? Palette.gold : Palette.muted)
                .multilineTextAlignment(.trailing)
                .lineLimit(2)
                .minimumScaleFactor(0.8)
        }
        .frame(maxWidth: 96, alignment: .trailing)
        .accessibilityLabel(line)
    }

    private var turnLine: String {
        if session.state.status == .resolving { return "Resolving…" }
        guard let scene = session.state.scene else { return "Holding" }
        if !scene.canAct { return "You are down" }
        if PlayTurn.chosenLine(scene: scene, playerId: session.playerId) != nil {
            var acted = Set(scene.votes.map(\.playerId))
            for turn in scene.freeforms {
                if let playerId = turn.playerId { acted.insert(playerId) }
            }
            acted.insert(session.playerId)
            let waiting: Bool
            if scene.combat, let combat = session.state.rules?.combat {
                waiting = combat.combatants.contains { !$0.isFoe && $0.isUp && !acted.contains($0.id) }
            } else {
                waiting = session.state.players.contains { !acted.contains($0.playerId) }
            }
            return waiting ? "Waiting on others" : "Ready"
        }
        if session.state.status == .voting { return "Your turn" }
        return "Holding"
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
