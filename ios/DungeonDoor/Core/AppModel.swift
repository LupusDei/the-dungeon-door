import Foundation
import Observation

/// App-wide state: the catalog, this player's heroes, and the game they're in.
/// The catalog and roster are cached on disk so the app opens instantly and survives a bad signal.
@MainActor @Observable
final class AppModel {
    let api: APIClient
    let playerId: String

    private(set) var catalog: Catalog?
    private(set) var characters: [Character] = []
    var catalogError: String?
    var activeGame: GameSession?

    init() {
        playerId = AppConfig.playerId
        api = APIClient(base: AppConfig.apiBase, playerId: playerId, appKey: AppConfig.appKey)
        catalog = Self.load(Catalog.self, from: "catalog.json")
        characters = Self.load([Character].self, from: "characters-\(playerId).json") ?? []
    }

    func refresh() async {
        do {
            let fresh = try await api.catalog()
            catalog = fresh
            catalogError = nil
            Self.store(fresh, to: "catalog.json")
        } catch {
            if catalog == nil { catalogError = error.localizedDescription }
        }
        if let mine = try? await api.myCharacters() {
            // Keep any local hero the server hasn't heard of yet (saved while offline).
            let serverIds = Set(mine.map(\.id))
            characters = mine + characters.filter { !serverIds.contains($0.id) }
            persistCharacters()
        }
    }

    func save(_ character: Character) async throws -> Character {
        var c = character
        c.ownerId = playerId
        c.updatedAt = ISO8601DateFormatter().string(from: .now)
        let saved = try await api.save(c)
        if let i = characters.firstIndex(where: { $0.id == saved.id }) {
            characters[i] = saved
        } else {
            characters.insert(saved, at: 0)
        }
        persistCharacters()
        return saved
    }

    func delete(_ character: Character) async throws {
        try await api.delete(characterId: character.id)
        characters.removeAll { $0.id == character.id }
        persistCharacters()
    }

    func enter(_ state: GameState) {
        activeGame?.stop()
        let session = GameSession(api: api, playerId: playerId, initial: state)
        activeGame = session
        UserDefaults.standard.set(state.code, forKey: "dd.lastGame")
        session.start()
    }

    func leaveGame() async {
        guard let session = activeGame else { return }
        session.stop()
        activeGame = nil
        UserDefaults.standard.removeObject(forKey: "dd.lastGame")
        try? await api.leave(session.code)
    }

    /// Closes the game screen without leaving the party (e.g. after the finale).
    func closeGame() {
        activeGame?.stop()
        activeGame = nil
        UserDefaults.standard.removeObject(forKey: "dd.lastGame")
    }

    /// Reopens the game this device was last in, if it's still going.
    func resumeIfPossible() async {
        guard activeGame == nil else { return }
        let code = AppConfig.openGameArgument ?? UserDefaults.standard.string(forKey: "dd.lastGame")
        guard let code, let state = try? await api.game(code, since: nil),
              state.status != .ended, state.player(playerId) != nil else { return }
        enter(state)
    }

    // MARK: Disk cache

    private func persistCharacters() {
        Self.store(characters, to: "characters-\(playerId).json")
    }

    private static func url(_ name: String) -> URL {
        URL.applicationSupportDirectory.appending(path: name)
    }

    private static func load<T: Decodable>(_ type: T.Type, from name: String) -> T? {
        guard let data = try? Data(contentsOf: url(name)) else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }

    private static func store<T: Encodable>(_ value: T, to name: String) {
        try? FileManager.default.createDirectory(at: .applicationSupportDirectory, withIntermediateDirectories: true)
        if let data = try? JSONEncoder().encode(value) { try? data.write(to: url(name), options: .atomic) }
    }
}
