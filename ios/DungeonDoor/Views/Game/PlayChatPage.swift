import SwiftUI

/// Party chat as a tab. The composer lives here. System and dungeon-master lines carry no reactions.
struct PlayChatPage: View {
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
                guard let id else { return }
                withAnimation { proxy.scrollTo(id, anchor: .bottom) }
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            ChatComposerBar(session: session, showsError: true)
        }
    }
}
