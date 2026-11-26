import Foundation

private struct ErrorBody: Decodable { let error: String }

struct APIError: LocalizedError {
    let status: Int
    let message: String
    var errorDescription: String? { message }
}

/// Thin async client for docs/api.md. Every call carries the player id and, when built with one,
/// the shared app key.
struct APIClient: Sendable {
    let base: URL
    let playerId: String
    let appKey: String?

    // MARK: Catalog & characters

    func catalog() async throws -> Catalog {
        try await send("GET", "api/catalog")
    }

    /// The SRD text behind a sheet's ids. Static, so the app fetches it once and keeps it.
    func reference() async throws -> Reference {
        try await send("GET", "api/reference")
    }

    func myCharacters() async throws -> [Character] {
        struct Wrapper: Decodable { let characters: [Character] }
        let w: Wrapper = try await send("GET", "api/characters")
        return w.characters
    }

    /// Upserts a hero. `backgroundId` builds (or, at level 1, rebuilds) the sheet on that background;
    /// nil keeps the sheet the hero has, or lets the server pick a background for a new one.
    func save(_ character: Character, backgroundId: String?) async throws -> Character {
        try await send("PUT", "api/characters", body: CharacterDraft(character, backgroundId: backgroundId))
    }

    func delete(characterId: String) async throws {
        struct OK: Decodable { let ok: Bool }
        let _: OK = try await send("DELETE", "api/characters", query: ["id": characterId])
    }

    /// The level-1 sheet a save would build for this hero; nothing is stored. The id seeds the
    /// build, so the preview is the hero that will be saved.
    func sheet(id: String, name: String, race: String, characterClass: String, backgroundId: String?) async throws -> SheetPreview {
        struct Body: Encodable { let id: String; let name: String; let race: String; let characterClass: String; let backgroundId: String? }
        return try await send("POST", "api/sheet",
                              body: Body(id: id, name: name, race: race, characterClass: characterClass, backgroundId: backgroundId))
    }

    func forgePortrait(for character: Character, previousAppearance: String?, note: String?) async throws -> PortraitResult {
        struct Body: Encodable { let character: CharacterDraft; let previousAppearance: String?; let note: String? }
        return try await send("POST", "api/portrait",
                              body: Body(character: CharacterDraft(character), previousAppearance: previousAppearance, note: note),
                              timeout: 150)
    }

    // MARK: Games

    func createGame(characterId: String, dungeonMaster: String) async throws -> GameState {
        struct Body: Encodable { let characterId: String; let dungeonMaster: String }
        return try await send("POST", "api/games", body: Body(characterId: characterId, dungeonMaster: dungeonMaster))
    }

    func game(_ code: String, since: Int?) async throws -> GameState {
        try await send("GET", "api/games/\(code)", query: since.map { ["since": String($0)] } ?? [:])
    }

    func join(_ code: String, characterId: String) async throws -> GameState {
        struct Body: Encodable { let characterId: String }
        return try await send("POST", "api/games/\(code)/join", body: Body(characterId: characterId))
    }

    func leave(_ code: String) async throws {
        struct OK: Decodable { let ok: Bool }
        let _: OK = try await send("POST", "api/games/\(code)/leave", body: [String: String]())
    }

    func say(_ code: String, text: String) async throws -> Message {
        struct Body: Encodable { let text: String }
        return try await send("POST", "api/games/\(code)/messages", body: Body(text: text))
    }

    func setDungeonMaster(_ code: String, id: String) async throws -> GameState {
        struct Body: Encodable { let dungeonMaster: String }
        return try await send("POST", "api/games/\(code)/dungeon-master", body: Body(dungeonMaster: id))
    }

    /// `dungeon` is a catalog dungeons id ("none", "fixed", "explore"); nil is left out of the body,
    /// and the server tells a story.
    func start(_ code: String, sceneCount: Int?, dungeon: String?) async throws -> GameState {
        struct Body: Encodable { let sceneCount: Int?; let dungeon: String? }
        return try await send("POST", "api/games/\(code)/start", body: Body(sceneCount: sceneCount, dungeon: dungeon))
    }

    func vote(_ code: String, sceneIndex: Int, choiceId: String) async throws -> GameState {
        struct Body: Encodable { let sceneIndex: Int; let choiceId: String }
        return try await send("POST", "api/games/\(code)/vote", body: Body(sceneIndex: sceneIndex, choiceId: choiceId))
    }

    func advance(_ code: String) async throws -> GameState {
        try await send("POST", "api/games/\(code)/advance", body: [String: String]())
    }

    // MARK: Transport

    private func send<T: Decodable>(_ method: String, _ path: String, query: [String: String] = [:],
                                    body: (any Encodable)? = nil, timeout: TimeInterval = 30) async throws -> T {
        var components = URLComponents(url: base.appending(path: path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { components.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) } }
        var request = URLRequest(url: components.url!, timeoutInterval: timeout)
        request.httpMethod = method
        request.setValue(playerId, forHTTPHeaderField: "x-dd-player")
        if let appKey, !appKey.isEmpty { request.setValue(appKey, forHTTPHeaderField: "x-dd-key") }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "content-type")
            request.httpBody = try JSONEncoder().encode(body)
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let message = (try? JSONDecoder().decode(ErrorBody.self, from: data))?.error
                ?? HTTPURLResponse.localizedString(forStatusCode: status)
            throw APIError(status: status, message: message)
        }
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw APIError(status: status, message: "Unexpected reply from the server (\(error))")
        }
    }
}
