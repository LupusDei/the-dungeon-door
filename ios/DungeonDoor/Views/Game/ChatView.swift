import SwiftUI

/// Party chat. A line is the hero speaking, the player out of character, an emote, or a whisper.
/// It can quote another line, name a character or a player, and carry emoji. The composer also sits
/// on the table itself, so a player can talk without opening this sheet.
struct ChatView: View {
    @Bindable var session: GameSession

    var body: some View {
        NavigationStack {
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
                    }
                    .padding(16)
                }
                .defaultScrollAnchor(.bottom)
                .onChange(of: session.messages.last?.id) { _, id in
                    withAnimation { proxy.scrollTo(id, anchor: .bottom) }
                }
            }
            .safeAreaInset(edge: .bottom) { ChatComposerBar(session: session, showsError: true) }
            .screenChrome()
            .navigationTitle("Party Chat")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { session.chatOpen = false } }
            }
        }
    }
}

/// The line the party is writing. Used in the chat sheet and, while that is closed, on the table.
struct ChatComposerBar: View {
    @Bindable var session: GameSession
    /// Opens the thread. The sheet already is the thread, so it leaves this off.
    var showsThread = false
    /// The sheet covers the screen's own error line, so it shows a failed send here.
    var showsError = false
    @FocusState private var focused: Bool
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !session.typing.isEmpty {
                Text(typingLine)
                    .font(.caption.italic())
                    .foregroundStyle(Palette.muted)
            }
            if showsError, let error = session.error, !error.isEmpty {
                Text(error).font(.caption).foregroundStyle(Palette.ember)
            }
            if let reply = session.replyingTo {
                HStack(alignment: .top, spacing: 8) {
                    RoundedRectangle(cornerRadius: 1).fill(Palette.gold).frame(width: 3)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(reply.characterName ?? "Earlier")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(Palette.gold)
                        Text(reply.text).font(.caption).foregroundStyle(Palette.muted).lineLimit(2)
                    }
                    Spacer(minLength: 0)
                    Button { session.replyingTo = nil } label: { Image(systemName: "xmark") }
                        .accessibilityLabel("Cancel reply")
                }
                .padding(8)
                .background(Palette.raised, in: RoundedRectangle(cornerRadius: 10))
            }
            if !mentionChoices.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(mentionChoices) { choice in
                            Button(choice.label) { insertMention(choice.insert) }
                                .font(.caption.weight(.semibold))
                                .padding(.horizontal, 10)
                                .padding(.vertical, 6)
                                .background(Palette.raised, in: Capsule())
                                .foregroundStyle(choice.player ? Palette.verdigris : Palette.gold)
                        }
                    }
                }
            }
            if !session.whisperTo.isEmpty {
                HStack(spacing: 8) {
                    Text(whisperCaption)
                        .font(.caption.italic())
                        .foregroundStyle(Palette.verdigris)
                    Spacer(minLength: 0)
                    Button { session.whisperTo = [] } label: { Image(systemName: "xmark") }
                        .accessibilityLabel("Stop whispering")
                }
            }
            if session.whisperPickerOpen {
                whisperPicker
            }
            // With large text the voice switch has its own line, so the hero's name is whole and the
            // field keeps its width. Emote and whisper sit with it.
            HStack(spacing: 8) {
                if typeSize >= .xxLarge { voiceSwitch(wide: true) }
                modeButton(session.emoting ? "*me*" : "Emote", on: session.emoting, tint: Palette.gold) {
                    session.emoting.toggle()
                }
                .accessibilityLabel(session.emoting ? "Emoting" : "Speak instead of emoting")
                modeButton("Whisper", on: session.whisperPickerOpen || !session.whisperTo.isEmpty, tint: Palette.verdigris) {
                    session.whisperPickerOpen.toggle()
                }
                .accessibilityLabel("Choose who to whisper to")
                Spacer(minLength: 0)
            }
            HStack(alignment: .bottom, spacing: 10) {
                if typeSize < .xxLarge { voiceSwitch(wide: false) }
                TextField(fieldPrompt, text: $session.draft, axis: .vertical)
                    .font(.prose)
                    .lineLimit(1...4)
                    .focused($focused)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .card()
                    .onSubmit(send)
                if showsThread {
                    Button { session.chatOpen = true } label: {
                        Image(systemName: "bubble.left.and.bubble.right")
                            .overlay(alignment: .topTrailing) { unreadBadge }
                    }
                    .accessibilityLabel(session.unreadChat > 0 ? "Party chat, \(session.unreadChat) unread" : "Party chat")
                }
                Button(action: send) {
                    Image(systemName: "arrow.up.circle.fill").font(.system(size: 34))
                }
                .disabled(session.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .accessibilityLabel("Send")
            }
        }
        .padding(12)
        // Down to the screen's edge where the bar is the last thing on it, so nothing scrolls into view
        // under the home indicator. Ignoring the safe area does that while the bar's height is a whole
        // number of points; with larger text it is not, and the strip under the bar was left bare. The
        // second background is that strip, drawn outright.
        .background { Palette.ink.ignoresSafeArea(edges: .bottom) }
        .background(alignment: .bottom) { Palette.ink.frame(height: 50).offset(y: 50).allowsHitTesting(false) }
        .onChange(of: session.draft) { _, text in session.noteDraft(text) }
    }

    /// Who the next line is spoken as: the hero, or the player out of character.
    private func voiceSwitch(wide: Bool) -> some View {
        Button { session.speakingInCharacter = !session.speakingInCharacter } label: {
            Text(session.speakingInCharacter ? (session.me?.character.name ?? "Hero") : (wide ? "Out of character" : "OOC"))
                .font(.caption.weight(.semibold))
                .lineLimit(wide ? 2 : 1)
                .minimumScaleFactor(0.7)
                .frame(maxWidth: wide ? nil : 72)
                .padding(.horizontal, wide ? 12 : 8)
                .padding(.vertical, 8)
                .background(Palette.raised, in: Capsule())
                .foregroundStyle(session.speakingInCharacter ? Palette.gold : Palette.parchment)
        }
        .accessibilityLabel(session.speakingInCharacter ? "Speaking as your hero" : "Speaking out of character")
    }

    private func modeButton(_ title: String, on: Bool, tint: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.caption.weight(.semibold))
                .lineLimit(1)
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .background((on ? tint : Palette.raised).opacity(on ? 0.28 : 1), in: Capsule())
                .foregroundStyle(on ? tint : Palette.parchment)
        }
    }

    private var fieldPrompt: String {
        let name = session.me?.character.name ?? "your hero"
        if !session.whisperTo.isEmpty {
            return session.emoting ? "Whisper what \(name) does…" : "Whisper…"
        }
        if session.emoting {
            return session.speakingInCharacter ? "What \(name) does…" : "What you do, out of character…"
        }
        return session.speakingInCharacter ? "Speak as \(name)…" : "Out of character…"
    }

    private var whisperCaption: String {
        let names = session.whisperTo.map { $0.target == "player" ? "\($0.name)'s player" : $0.name }
        switch names.count {
        case 0: return "Whisper"
        case 1: return "Whisper to \(names[0])"
        case 2: return "Whisper to \(names[0]) and \(names[1])"
        default:
            let head = names.dropLast().joined(separator: ", ")
            return "Whisper to \(head) and \(names[names.count - 1])"
        }
    }

    private struct WhisperChoice: Identifiable {
        let id: String
        let playerId: String
        let name: String
        let target: String
        let label: String
    }

    private var whisperChoices: [WhisperChoice] {
        session.state.players.filter { $0.playerId != session.playerId }.flatMap { seated in
            let name = seated.character.name
            return [
                WhisperChoice(id: "\(seated.playerId)-hero", playerId: seated.playerId, name: name, target: "hero", label: "\(name) · character"),
                WhisperChoice(id: "\(seated.playerId)-player", playerId: seated.playerId, name: name, target: "player", label: "\(name) · player"),
            ]
        }
    }

    private var whisperPicker: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(whisperChoices) { choice in
                    let on = session.whisperTo.contains { $0.playerId == choice.playerId && $0.target == choice.target }
                    Button { toggleWhisper(choice) } label: {
                        Text(choice.label)
                            .font(.caption.weight(.semibold))
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background((on ? Palette.verdigris : Palette.raised).opacity(on ? 0.28 : 1), in: Capsule())
                            .foregroundStyle(on ? Palette.verdigris : Palette.parchment)
                    }
                    .accessibilityLabel(on ? "\(choice.label), selected" : choice.label)
                }
            }
        }
    }

    private func toggleWhisper(_ choice: WhisperChoice) {
        if let index = session.whisperTo.firstIndex(where: { $0.playerId == choice.playerId && $0.target == choice.target }) {
            session.whisperTo.remove(at: index)
        } else {
            session.whisperTo.append(Message.Mention(playerId: choice.playerId, name: choice.name, target: choice.target))
        }
    }

    private var typingLine: String {
        let names = session.typing.map(\.name)
        switch names.count {
        case 1: return "\(names[0]) is writing…"
        case 2: return "\(names[0]) and \(names[1]) are writing…"
        default: return "\(names[0]) and \(names.count - 1) others are writing…"
        }
    }

    @ViewBuilder private var unreadBadge: some View {
        if session.unreadChat > 0 {
            Text("\(min(session.unreadChat, 99))")
                .font(.system(size: 10, weight: .bold))
                .padding(.horizontal, 4).padding(.vertical, 1)
                .background(Palette.ember, in: Capsule())
                .foregroundStyle(.white)
                .offset(x: 10, y: -8)
        }
    }

    /// What follows the `@` the player is still typing, when it is the end of the line.
    private var mentionFragment: String? {
        let text = session.draft
        guard let at = text.lastIndex(of: "@") else { return nil }
        if at > text.startIndex {
            let previous = text[text.index(before: at)]
            if previous.isLetter || previous.isNumber { return nil }
        }
        return String(text[text.index(after: at)...])
    }

    private struct MentionChoice: Identifiable {
        let id: String
        let label: String
        let insert: String
        let player: Bool
    }

    private var mentionChoices: [MentionChoice] {
        guard let raw = mentionFragment else { return [] }
        let playerMode = raw.lowercased().hasPrefix("player:")
        let query = playerMode ? String(raw.dropFirst("player:".count)) : raw
        return session.state.players.flatMap { seated -> [MentionChoice] in
            let name = seated.character.name
            guard query.isEmpty || name.lowercased().hasPrefix(query.lowercased()) else { return [] }
            if playerMode {
                return [MentionChoice(id: "\(seated.playerId)-player", label: "\(name) · player", insert: "@player:\(name) ", player: true)]
            }
            return [
                MentionChoice(id: "\(seated.playerId)-hero", label: "\(name) · character", insert: "@\(name) ", player: false),
                MentionChoice(id: "\(seated.playerId)-player", label: "\(name) · player", insert: "@player:\(name) ", player: true),
            ]
        }
    }

    private func insertMention(_ token: String) {
        guard let at = session.draft.lastIndex(of: "@") else { return }
        var text = session.draft
        text.replaceSubrange(at..., with: token)
        session.draft = text
    }

    private func send() {
        let text = session.draft
        let voice = session.speakingInCharacter ? "in" : "out"
        let reply = session.replyingTo?.id
        let emote = session.emoting
        let whisper = session.whisperTo
        session.draft = ""
        session.replyingTo = nil
        Task { await session.say(text, voice: voice, replyTo: reply, emote: emote, whisperTo: whisper) }
    }
}

struct MessageLine: View {
    let message: Message
    var portrait: URL? = nil
    var compact = false
    var isMine = false
    /// The caller, so a reaction they already gave is marked as theirs.
    var playerId: String? = nil
    var heroName: (String) -> String = { _ in "Someone" }
    var onReply: (() -> Void)? = nil
    var onReact: ((String) -> Void)? = nil
    @State private var pickingEmoji = false

    static let quick = ["👍", "👎", "😂", "😮", "❤️", "💀"]
    private static let more = ["🔥", "👀", "🎲", "⚔️", "🙏", "😅", "🎉", "💯", "🤔", "👏", "😭", "🙌", "✨", "🐉", "🚪"]

    var body: some View {
        if message.kind == .chat, onReply != nil || onReact != nil {
            content.contextMenu {
                if let onReply {
                    Button("Reply", systemImage: "arrowshape.turn.up.left") { onReply() }
                }
                if let onReact {
                    ForEach(Self.quick, id: \.self) { emoji in
                        Button(emoji) { onReact(emoji) }
                    }
                }
            }
        } else {
            content
        }
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: 6) {
            line
            if compact {
                if !message.reactions.isEmpty {
                    Text(message.reactions.map { "\($0.emoji)\($0.count)" }.joined(separator: " "))
                        .font(.caption2)
                        .foregroundStyle(Palette.muted)
                }
            } else if onReact != nil, message.kind == .chat {
                reactions
            }
        }
    }

    @ViewBuilder private var line: some View {
        switch message.kind {
        case .system:
            Text(message.text)
                .font(.caption.italic())
                .foregroundStyle(Palette.muted)
                .frame(maxWidth: .infinity, alignment: compact ? .leading : .center)
        case .dm:
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: "theatermasks.fill").foregroundStyle(Palette.gold)
                VStack(alignment: .leading, spacing: 4) {
                    if let quote = message.reply, !compact { quoteView(quote) }
                    Text(message.text)
                        .font(compact ? .footnote.italic() : .proseSmall.italic())
                        .foregroundStyle(Palette.gold.opacity(0.9))
                        .lineLimit(compact ? 2 : nil)
                }
            }
        case .chat:
            if message.emote {
                emoteLine
            } else if compact {
                compactChat
            } else {
                speech
            }
        }
    }

    /// "*Mira draws her sword*", italic, and tinted when it is also a whisper.
    private var emoteLine: some View {
        let words = styled("*\(speaker) \(message.text)*")
            .font(compact ? .footnote.italic() : .prose.italic())
            .foregroundStyle(message.isWhisper ? Palette.verdigris : (message.voice == "out" ? Palette.muted : Palette.gold.opacity(0.95)))
            .lineLimit(compact ? 2 : nil)
            .fixedSize(horizontal: false, vertical: !compact)
        return VStack(alignment: .leading, spacing: 3) {
            if message.isWhisper {
                Text(message.whisperLabel).font(.caption2.italic()).foregroundStyle(Palette.verdigris)
            } else if message.voice == "out", !compact {
                Text("out of character").font(.caption2).foregroundStyle(Palette.muted)
            }
            if let quote = message.reply, !compact { quoteView(quote) }
            words
        }
        .padding(message.isWhisper && !compact ? 8 : 0)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            if message.isWhisper && !compact {
                RoundedRectangle(cornerRadius: 10).fill(Palette.verdigris.opacity(0.12))
            }
        }
    }

    private var compactChat: some View {
        Group {
            if message.isWhisper {
                (Text("\(speaker) whispers: ").foregroundStyle(Palette.verdigris).bold() + styled(message.text).italic())
                    .font(.footnote)
            } else {
                (Text(speaker + ": ").bold() + styled(message.text))
                    .font(.footnote)
            }
        }
        .lineLimit(2)
    }

    private var speech: some View {
        HStack(alignment: .top, spacing: 10) {
            if message.inCharacter {
                PortraitView(url: portrait, size: 32, circular: true)
            } else {
                PortraitView(url: nil, symbol: "person.fill", size: 32, circular: true)
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(speaker)
                    .font(.caption.weight(.semibold))
                    .fixedSize(horizontal: false, vertical: true)
                    .foregroundStyle(message.isWhisper ? Palette.verdigris : (message.inCharacter ? (isMine ? Palette.gold : Palette.verdigris) : Palette.parchment))
                if message.isWhisper {
                    Text(message.whisperLabel).font(.caption2.italic()).foregroundStyle(Palette.verdigris)
                } else if message.voice == "out" {
                    Text("out of character").font(.caption2).foregroundStyle(Palette.muted)
                }
                if let quote = message.reply { quoteView(quote) }
                styled(message.text)
                    .font(message.isWhisper || message.inCharacter ? .prose.italic() : .prose)
                    .lineLimit(nil)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(message.isWhisper ? 8 : 0)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            if message.isWhisper {
                RoundedRectangle(cornerRadius: 10).fill(Palette.verdigris.opacity(0.12))
            }
        }
    }

    private var speaker: String {
        let name = message.characterName ?? "Someone"
        return message.voice == "out" ? "\(name)'s player" : name
    }

    private func quoteView(_ quote: Message.Quote) -> some View {
        HStack(alignment: .top, spacing: 6) {
            RoundedRectangle(cornerRadius: 1).fill(Palette.gold.opacity(0.7)).frame(width: 2)
            VStack(alignment: .leading, spacing: 1) {
                Text(quote.characterName ?? "Earlier").font(.caption2.weight(.semibold)).foregroundStyle(Palette.gold)
                Text(quote.emote ? "*\(quote.characterName ?? "Someone") \(quote.text)*" : quote.text)
                    .font(.caption.italic())
                    .foregroundStyle(Palette.muted)
                    .lineLimit(2)
            }
        }
    }

    private var reactions: some View {
        HStack(spacing: 6) {
            ForEach(message.reactions) { reaction in
                reactionButton(reaction.emoji)
            }
            Button { pickingEmoji = true } label: {
                Image(systemName: "plus.bubble").font(.footnote)
            }
            .accessibilityLabel("Add a reaction")
            .popover(isPresented: $pickingEmoji) {
                LazyVGrid(columns: Array(repeating: GridItem(.fixed(36)), count: 6), spacing: 8) {
                    ForEach(Self.quick + Self.more, id: \.self) { emoji in
                        Button(emoji) {
                            onReact?(emoji)
                            pickingEmoji = false
                        }
                        .font(.title2)
                    }
                }
                .padding()
                .presentationCompactAdaptation(.popover)
            }
            if onReply != nil {
                Button { onReply?() } label: { Image(systemName: "arrowshape.turn.up.left").font(.footnote) }
                    .accessibilityLabel("Reply")
            }
        }
        .foregroundStyle(Palette.muted)
    }

    private func reactionButton(_ emoji: String) -> some View {
        let reaction = message.reactions.first { $0.emoji == emoji }
        let mine = playerId.map { id in reaction?.playerIds.contains(id) ?? false } ?? false
        let count = reaction?.count ?? 0
        return Button { onReact?(emoji) } label: {
            HStack(spacing: 3) {
                Text(emoji).font(.footnote)
                if count > 0 { Text("\(count)").font(.caption2.weight(.semibold)) }
            }
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background((mine ? Palette.gold : Palette.raised).opacity(mine ? 0.35 : 1), in: Capsule())
            .overlay { Capsule().strokeBorder(mine ? Palette.gold : Palette.gold.opacity(0.15), lineWidth: 1) }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(reactionLabel(emoji, count: count, ids: reaction?.playerIds ?? []))
    }

    private func reactionLabel(_ emoji: String, count: Int, ids: [String]) -> String {
        let who = ids.map(heroName).joined(separator: ", ")
        if count == 0 { return "React with \(emoji)" }
        return who.isEmpty ? "\(emoji), \(count)" : "\(emoji), \(count): \(who)"
    }

    private func styled(_ text: String) -> Text {
        let spans = mentionSpans(text)
        if spans.isEmpty { return Text(text) }
        var result = Text("")
        var cursor = text.startIndex
        for span in spans {
            if cursor < span.start { result = result + Text(String(text[cursor..<span.start])) }
            let color = span.target == "hero" ? Palette.gold : Palette.verdigris
            result = result + Text(String(text[span.start..<span.end])).foregroundStyle(color).bold()
            cursor = span.end
        }
        if cursor < text.endIndex { result = result + Text(String(text[cursor...])) }
        return result
    }

    private struct Span {
        let start: String.Index
        let end: String.Index
        let target: String
    }

    /// Highlights `@Name` and `@player:Name` for mentions the server accepted.
    private func mentionSpans(_ text: String) -> [Span] {
        var spans: [Span] = []
        var index = text.startIndex
        while index < text.endIndex {
            if text[index] == "@", let span = span(in: text, at: index) {
                spans.append(span)
                index = span.end
            } else {
                index = text.index(after: index)
            }
        }
        return spans
    }

    private func span(in text: String, at at: String.Index) -> Span? {
        let rest = text[text.index(after: at)...]
        if rest.lowercased().hasPrefix("player:") {
            let nameStart = text.index(at, offsetBy: 1 + "player:".count, limitedBy: text.endIndex) ?? text.endIndex
            guard nameStart <= text.endIndex else { return nil }
            guard let mention = match(text[nameStart...], target: "player") else { return nil }
            guard let end = text.index(nameStart, offsetBy: mention.name.count, limitedBy: text.endIndex) else { return nil }
            return Span(start: at, end: end, target: "player")
        }
        let nameStart = text.index(after: at)
        guard let mention = match(text[nameStart...], target: "hero") else { return nil }
        guard let end = text.index(nameStart, offsetBy: mention.name.count, limitedBy: text.endIndex) else { return nil }
        return Span(start: at, end: end, target: "hero")
    }

    private func match(_ tail: Substring, target: String) -> Message.Mention? {
        message.mentions
            .filter { $0.target == target && tail.lowercased().hasPrefix($0.name.lowercased()) }
            .filter { mention in
                let after = tail.dropFirst(mention.name.count)
                return after.first.map { !$0.isLetter && !$0.isNumber } ?? true
            }
            .max { $0.name.count < $1.name.count }
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
                            ForEach(Array(entry.roleplay.enumerated()), id: \.offset) { _, line in
                                (Text(line.characterName + ": ").bold() + Text(line.text))
                                    .font(.proseSmall)
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
