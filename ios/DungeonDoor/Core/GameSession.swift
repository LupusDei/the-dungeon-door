import Foundation
import Observation

/// The moment the caller's hero gains a level, for the scene to make something of.
struct LevelUp: Identifiable, Equatable {
    let heroName: String
    let level: Int
    /// Hit points added to the maximum, when the app saw both sides of the change.
    var hpGained: Int?
    /// Class features the new level brought, by name.
    var newFeatures: [String] = []
    var id: Int { level }
}

/// One game the player is in. Polls the server every couple of seconds (the MVP has no sockets),
/// keeps the full chat log, and wraps the game actions.
@MainActor @Observable
final class GameSession {
    let api: APIClient
    let playerId: String
    let code: String

    private(set) var state: GameState
    private(set) var messages: [Message] = []
    private(set) var unreadChat = 0
    /// Who else is composing, from the last poll.
    private(set) var typing: [TypingNotice] = []
    /// The line in the composer. Shared by the bar on the table and the open chat.
    var draft = ""
    /// True when the hero speaks. False is the player, out of character.
    var speakingInCharacter = true
    /// The line the next message will quote.
    var replyingTo: Message?
    var chatOpen = false { didSet { if chatOpen { unreadChat = 0 } } }
    private var lastTypingPing: Date?
    private var announcedTyping = false
    var error: String?
    var busy = false
    var connectionTrouble = false
    /// Set when the caller's hero gains a level; the scene shows it until it is dismissed.
    var levelUp: LevelUp?
    /// Scenes seen as rounds of a fight, by index. The chronicle doesn't say which entries were.
    private(set) var combatScenes: Set<Int> = []

    private var pollTask: Task<Void, Never>?

    init(api: APIClient, playerId: String, initial: GameState) {
        self.api = api
        self.playerId = playerId
        self.code = initial.code
        self.state = initial
        noteLevel(before: nil, after: initial)
        noteCombat(initial)
        absorb(initial, countUnread: false)
    }

    var me: GamePlayer? { state.player(playerId) }
    var isHost: Bool { state.hostId == playerId }
    var myVote: Vote? { state.scene?.votes.first { $0.playerId == playerId } }
    /// How my own hero stands in the rules engine's party, once the adventure is under way.
    var myStanding: HeroStanding? { state.standing(playerId) }
    var lastMessageId: Int? { messages.last?.id }

    func start() {
        guard pollTask == nil else { return }
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(2))
                await self?.poll()
            }
        }
    }

    func stop() {
        pollTask?.cancel()
        pollTask = nil
    }

    func poll() async {
        do {
            let fresh = try await api.game(code, since: lastMessageId)
            absorb(fresh)
            connectionTrouble = false
        } catch {
            connectionTrouble = true
            #if DEBUG
            // A reply the app can't read looks the same as a lost signal; say which it was.
            if !(error is CancellationError) { print("[DungeonDoor] poll failed: \(error.localizedDescription)") }
            #endif
        }
    }

    // MARK: Actions

    func say(_ text: String, voice: String = "in", replyTo: Int? = nil) async {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        announcedTyping = false
        lastTypingPing = nil
        await run {
            let message = try await self.api.say(self.code, text: String(trimmed.prefix(500)), voice: voice, replyTo: replyTo)
            try? await self.api.typing(self.code, typing: false)
            self.append([message], countUnread: false)
        }
    }

    /// Toggles an emoji on a line. The id does not change, so the log is edited in place.
    func react(to messageId: Int, with emoji: String) async {
        do {
            let message = try await api.react(code, messageId: messageId, emoji: emoji)
            merge([message])
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// Pings the table while a line is being written, and clears it when the composer is empty.
    func noteDraft(_ text: String) {
        let composing = !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        if composing {
            let now = Date()
            if let lastTypingPing, now.timeIntervalSince(lastTypingPing) < 2 { return }
            lastTypingPing = now
            announcedTyping = true
            Task { try? await self.api.typing(self.code, typing: true) }
        } else if announcedTyping {
            announcedTyping = false
            lastTypingPing = nil
            Task { try? await self.api.typing(self.code, typing: false) }
        }
    }

    /// What this hero says or does, in the story. No roll. The narrator answers it next turn.
    func speakInCharacter(_ text: String) async {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        await run { self.absorb(try await self.api.speak(self.code, text: String(trimmed.prefix(500)))) }
    }

    func chooseDungeonMaster(_ id: String) async {
        await run { self.absorb(try await self.api.setDungeonMaster(self.code, id: id)) }
    }

    /// Opens the door. `dungeon` is the kind of game (a catalog dungeons id); nil tells a story.
    func begin(sceneCount: Int, dungeon: String?) async {
        await run { self.absorb(try await self.api.start(self.code, sceneCount: sceneCount, dungeon: dungeon)) }
    }

    func vote(_ choice: Choice) async {
        guard let scene = state.scene else { return }
        await run { self.absorb(try await self.api.vote(self.code, sceneIndex: scene.index, choiceId: choice.id)) }
    }

    func advance() async {
        await run { self.absorb(try await self.api.advance(self.code)) }
    }

    private func run(_ work: @escaping () async throws -> Void) async {
        busy = true
        defer { busy = false }
        do {
            try await work()
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    // MARK: Merging

    private func absorb(_ fresh: GameState, countUnread: Bool = true) {
        noteLevel(before: state, after: fresh)
        noteCombat(fresh)
        state = fresh
        append(fresh.messages, countUnread: countUnread)
        merge(fresh.messageUpdates)
        typing = fresh.typing
    }

    /// Remembers which scenes were rounds of a fight: the one on show, and the earlier rounds of
    /// the same fight (round 3 means the two scenes before it were rounds 1 and 2).
    private func noteCombat(_ fresh: GameState) {
        guard let scene = fresh.scene, scene.combat, !scene.isFinale else { return }
        let rounds = max(1, fresh.rules?.combat?.round ?? 1)
        for index in max(0, scene.index - (rounds - 1))...scene.index { combatScenes.insert(index) }
    }

    // MARK: Leveling

    private static func levelKey(_ characterId: String) -> String { "dd.level.\(characterId)" }

    /// Notices when my hero gains a level: between two polls, or since the app last looked (the
    /// level it last saw is kept on the device, so a level gained while it was closed still counts).
    private func noteLevel(before: GameState?, after: GameState) {
        guard after.rules != nil, let hero = after.player(playerId)?.character else { return }
        let level = after.standing(playerId)?.level ?? hero.sheet?.level
        guard let level else { return }
        let defaults = UserDefaults.standard
        let key = Self.levelKey(hero.id)
        let old = before?.player(playerId)?.character.sheet
        let seen = old?.level ?? (defaults.object(forKey: key) as? Int)
        defaults.set(level, forKey: key)
        guard let seen, level > seen else { return }
        var notice = LevelUp(heroName: hero.name, level: level)
        if let old, let new = hero.sheet {
            notice.hpGained = new.maxHp - old.maxHp
            var had = old.features
            // A feature can be gained twice (Action Surge): only what the old list can't account for is new.
            notice.newFeatures = new.features.filter { name in
                if let index = had.firstIndex(of: name) { had.remove(at: index); return false }
                return true
            }
        }
        levelUp = notice
    }

    private func append(_ incoming: [Message], countUnread: Bool) {
        let known = Set(messages.map(\.id))
        let new = incoming.filter { !known.contains($0.id) }
        guard !new.isEmpty else { return }
        messages = (messages + new).sorted { $0.id < $1.id }
        if countUnread && !chatOpen {
            unreadChat += new.filter { $0.kind == .chat && $0.playerId != playerId }.count
        }
    }

    /// Reactions edit a line the log already has. The id stays, so this is not a new message.
    private func merge(_ updates: [Message]) {
        guard !updates.isEmpty else { return }
        for update in updates {
            if let index = messages.firstIndex(where: { $0.id == update.id }) {
                messages[index] = update
            }
        }
    }
}
