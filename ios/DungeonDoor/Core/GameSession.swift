import Foundation
import Observation

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
    var chatOpen = false { didSet { if chatOpen { unreadChat = 0 } } }
    var error: String?
    var busy = false
    var connectionTrouble = false

    private var pollTask: Task<Void, Never>?

    init(api: APIClient, playerId: String, initial: GameState) {
        self.api = api
        self.playerId = playerId
        self.code = initial.code
        self.state = initial
        absorb(initial, countUnread: false)
    }

    var me: GamePlayer? { state.player(playerId) }
    var isHost: Bool { state.hostId == playerId }
    var myVote: Vote? { state.scene?.votes.first { $0.playerId == playerId } }
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
        }
    }

    // MARK: Actions

    func say(_ text: String) async {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        await run {
            let message = try await self.api.say(self.code, text: String(trimmed.prefix(500)))
            self.append([message], countUnread: false)
        }
    }

    func chooseDungeonMaster(_ id: String) async {
        await run { self.absorb(try await self.api.setDungeonMaster(self.code, id: id)) }
    }

    func begin(sceneCount: Int) async {
        await run { self.absorb(try await self.api.start(self.code, sceneCount: sceneCount)) }
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
        state = fresh
        append(fresh.messages, countUnread: countUnread)
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
}
