#if DEBUG
import SwiftUI

enum ProtoTab: String, CaseIterable, Identifiable, Hashable {
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

/// The new outer game: a slim vitals strip, one compact Act chip, and four bottom tabs.
@MainActor
struct ProtoPlayShell: View {
    @Environment(AppModel.self) private var model
    @Bindable var session: GameSession
    @State var tab: ProtoTab
    @State var sheetPane: ProtoSheetPane
    var preselectedTarget: String? = nil
    @State private var narrator = Narrator()

    private var state: GameState { session.state }
    private var inCombat: Bool { state.scene?.combat == true }
    private var unread: Int {
        session.messages.filter { $0.kind == .chat && $0.playerId != session.playerId }.count
    }

    var body: some View {
        VStack(spacing: 0) {
            ProtoTopStrip(session: session)
            ProtoActBar(session: session) {
                withAnimation(.snappy) { tab = .story }
            }
            Divider().overlay(Palette.gold.opacity(0.2))
            tabBody
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .clipped()
            ProtoTabBar(tab: $tab, inCombat: inCombat, unread: unread)
        }
        .screenChrome()
        .toolbar(.hidden, for: .navigationBar)
    }

    @ViewBuilder private var tabBody: some View {
        switch tab {
        case .story:
            ProtoStoryTab(session: session, narrator: narrator)
        case .sheet:
            ProtoSheetTab(session: session, pane: $sheetPane)
        case .map:
            ProtoMapTab(session: session, preselectedTarget: preselectedTarget)
        case .chat:
            ProtoChatTab(session: session)
        }
    }
}

// MARK: - Top strip

struct ProtoTopStrip: View {
    @Bindable var session: GameSession

    private var me: Character? { session.me?.character }
    private var live: LiveHero? { session.state.live(of: session.playerId) }
    private var hp: Int { live?.standing.hp ?? me?.sheet?.hp ?? 0 }
    private var maxHp: Int { live?.standing.maxHp ?? me?.sheet?.maxHp ?? 1 }
    private var ac: Int { live?.standing.armorClass ?? me?.sheet?.armorClass ?? 10 }
    private var conditions: [String] {
        (live?.conditions ?? []) + (live?.standing.conditions.map(\.condition) ?? [])
    }

    var body: some View {
        HStack(spacing: 10) {
            PortraitView(url: me?.portraitURL, size: 32, circular: true)
            VStack(alignment: .leading, spacing: 2) {
                Text(me?.name ?? "Hero")
                    .font(.serif(.subheadline, weight: .bold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                HStack(spacing: 6) {
                    HPBar(hp: hp, maxHp: max(maxHp, 1),
                          tint: Health.tint(hp: hp, maxHp: max(maxHp, 1), standing: hp > 0), height: 5)
                        .frame(width: 84)
                    Text("\(hp)/\(maxHp)")
                        .font(.system(size: 11, weight: .semibold, design: .serif))
                        .monospacedDigit()
                        .foregroundStyle(Palette.muted)
                }
            }
            acBadge
            if !conditions.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 4) {
                        ForEach(conditions, id: \.self) { id in
                            Text(SRD.name(id))
                                .font(.system(size: 10, weight: .semibold, design: .serif))
                                .padding(.horizontal, 6)
                                .padding(.vertical, 3)
                                .background(Palette.ember.opacity(0.25), in: Capsule())
                                .overlay { Capsule().strokeBorder(Palette.ember.opacity(0.6), lineWidth: 0.75) }
                        }
                    }
                }
            }
            Spacer(minLength: 6)
            turnBadge
        }
        .padding(.horizontal, 14)
        .padding(.top, 8)
        .padding(.bottom, 8)
        .background(Palette.ink)
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
        .accessibilityLabel(line)
    }

    private var turnLine: String {
        let scene = session.state.scene
        if session.state.status == .resolving { return "Resolving…" }
        if scene?.canAct == false { return "You are down" }
        if session.myVote != nil {
            let waiting = (scene?.votes.count ?? 0)
            let needed = session.state.players.filter { session.state.live(of: $0.playerId)?.standing.isUp != false }.count
            if waiting < needed { return "Waiting on others" }
            return "Ready"
        }
        if scene?.combat == true { return "Your turn" }
        return "Your turn"
    }
}

// MARK: - Act bar

struct ProtoActBar: View {
    @Bindable var session: GameSession
    var focusStory: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            if let vote = session.myVote, let scene = session.state.scene {
                D20Badge(roll: vote.roll, size: 32)
                VStack(alignment: .leading, spacing: 1) {
                    Text("Voted").font(.system(size: 10, weight: .semibold, design: .serif)).foregroundStyle(Palette.muted)
                    Text(label(for: vote, scene: scene))
                        .font(.serif(.subheadline, weight: .bold))
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                }
                Spacer(minLength: 0)
                Button("Change", action: focusStory)
                    .font(.serif(.caption, weight: .semibold))
                    .foregroundStyle(Palette.gold)
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
                Button(action: focusStory) {
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
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(Palette.surface)
        .overlay(alignment: .top) { Rectangle().fill(Palette.gold.opacity(0.15)).frame(height: 1) }
    }

    private var hint: String {
        if session.state.scene?.combat == true {
            return "Attack, cast, or dodge this round."
        }
        return "A scene offer, or write in your own words."
    }

    private func label(for vote: Vote, scene: GameScene) -> String {
        if let label = vote.label, !label.isEmpty { return label }
        return scene.choices.first { $0.id == vote.choiceId }?.label ?? "Chosen"
    }
}

// MARK: - Tab bar

struct ProtoTabBar: View {
    @Binding var tab: ProtoTab
    var inCombat: Bool
    var unread: Int

    var body: some View {
        HStack(spacing: 0) {
            ForEach(ProtoTab.allCases) { item in
                Button {
                    withAnimation(.snappy) { tab = item }
                } label: {
                    VStack(spacing: 3) {
                        ZStack(alignment: .topTrailing) {
                            Image(systemName: tab == item ? item.symbol : item.symbol)
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
                                    .offset(x: 10, y: -6)
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
            }
        }
        .background(Palette.ink.ignoresSafeArea(edges: .bottom))
        .overlay(alignment: .top) { Rectangle().fill(Palette.gold.opacity(0.25)).frame(height: 1) }
    }

    private func label(_ item: ProtoTab) -> String {
        var parts = [item.title]
        if item == .chat, unread > 0 { parts.append("\(unread) unread") }
        if item == .map, inCombat { parts.append("battle in progress") }
        if tab == item { parts.append("selected") }
        return parts.joined(separator: ", ")
    }
}

/// Party chat as a tab: the existing thread and composer, without a sheet chrome or Done button.
struct ProtoChatTab: View {
    @Bindable var session: GameSession

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 10) {
                    if session.messages.isEmpty {
                        Text("No words spoken yet. Talk it over.")
                            .font(.proseSmall.italic())
                            .foregroundStyle(Palette.muted)
                            .frame(maxWidth: .infinity)
                            .padding(.top, 30)
                    }
                    ForEach(session.messages) { message in
                        MessageLine(message: message,
                                    portrait: session.state.player(message.playerId)?.character.portraitURL,
                                    isMine: message.playerId == session.playerId,
                                    playerId: session.playerId,
                                    heroName: { session.state.player($0)?.character.name ?? "Someone" },
                                    onReply: { session.replyingTo = message },
                                    onReact: { emoji in Task { await session.react(to: message.id, with: emoji) } })
                            .id(message.id)
                    }
                    Color.clear.frame(height: 28).id("chat-end")
                }
                .padding(16)
            }
            .defaultScrollAnchor(.bottom)
            .onChange(of: session.messages.last?.id) { _, id in
                withAnimation { proxy.scrollTo(id, anchor: .bottom) }
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            ChatComposerBar(session: session, showsError: true)
        }
    }
}
#endif
