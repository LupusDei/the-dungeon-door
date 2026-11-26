import SwiftUI

/// Party chat. Text for now; voice messages in your character's voice come later.
struct ChatView: View {
    @Bindable var session: GameSession
    @State private var draft = ""
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 10) {
                        if session.messages.isEmpty {
                            Text("No words spoken yet.")
                                .font(.proseSmall.italic())
                                .foregroundStyle(Palette.muted)
                                .frame(maxWidth: .infinity)
                                .padding(.top, 30)
                        }
                        ForEach(session.messages) { message in
                            MessageLine(message: message,
                                        portrait: session.state.player(message.playerId)?.character.portraitURL,
                                        isMine: message.playerId == session.playerId)
                                .id(message.id)
                        }
                    }
                    .padding(16)
                }
                .defaultScrollAnchor(.bottom)
                .onChange(of: session.messages.last?.id) { _, id in
                    withAnimation { proxy.scrollTo(id, anchor: .bottom) }
                }
            }
            .safeAreaInset(edge: .bottom) { composer }
            .screenChrome()
            .navigationTitle("Party Chat")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { session.chatOpen = false } }
            }
        }
    }

    private var composer: some View {
        HStack(alignment: .bottom, spacing: 10) {
            TextField("Speak to the party…", text: $draft, axis: .vertical)
                .font(.prose)
                .lineLimit(1...4)
                .focused($focused)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .card()
                .onSubmit(send)
            Button(action: send) {
                Image(systemName: "arrow.up.circle.fill").font(.system(size: 34))
            }
            .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            .accessibilityLabel("Send")
        }
        .padding(12)
        .background(Palette.ink)
    }

    private func send() {
        let text = draft
        draft = ""
        Task { await session.say(text) }
    }
}

struct MessageLine: View {
    let message: Message
    var portrait: URL? = nil
    var compact = false
    var isMine = false

    var body: some View {
        switch message.kind {
        case .system:
            Text(message.text)
                .font(.caption.italic())
                .foregroundStyle(Palette.muted)
                .frame(maxWidth: .infinity, alignment: compact ? .leading : .center)
        case .dm:
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: "theatermasks.fill").foregroundStyle(Palette.gold)
                Text(message.text)
                    .font(compact ? .footnote.italic() : .proseSmall.italic())
                    .foregroundStyle(Palette.gold.opacity(0.9))
                    .lineLimit(compact ? 2 : nil)
            }
        case .chat:
            if compact {
                (Text((message.characterName ?? "Someone") + ": ").bold() + Text(message.text))
                    .font(.footnote)
                    .lineLimit(2)
            } else {
                HStack(alignment: .top, spacing: 10) {
                    PortraitView(url: portrait, size: 32, circular: true)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(message.characterName ?? "Someone")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(isMine ? Palette.gold : Palette.verdigris)
                        Text(message.text).font(.prose)
                    }
                }
            }
        }
    }
}

/// The story so far, scene by scene. A round of a fight has no party choice to report: each hero
/// acted for themselves.
struct ChronicleView: View {
    @Environment(\.dismiss) private var dismiss
    @Bindable var session: GameSession

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    ForEach(session.state.chronicle ?? []) { entry in
                        VStack(alignment: .leading, spacing: 10) {
                            SectionLabel("Scene \(entry.index + 1)")
                            Text(entry.title).font(.display(22, weight: .bold))
                            IllustrationView(url: entry.imageURL, paintingLabel: "No painting survived")
                            if let deed = session.deed(of: entry) {
                                Text(deed).font(.proseSmall.weight(.semibold)).foregroundStyle(Palette.gold)
                            }
                            Text(entry.outcome).font(.prose)
                        }
                    }
                }
                .padding(20)
                .frame(maxWidth: 720)
                .frame(maxWidth: .infinity)
            }
            .defaultScrollAnchor(AppConfig.launchScrollAnchor)
            .screenChrome()
            .navigationTitle(session.state.title ?? "The Chronicle")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}
