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

    func myCharacters() async throws -> [Character] {
        struct Wrapper: Decodable { let characters: [Character] }
        let w: Wrapper = try await send("GET", "api/characters")
        return w.characters
    }

    func save(_ character: Character) async throws -> Character {
        try await send("PUT", "api/characters", body: character)
    }

    func delete(characterId: String) async throws {
        struct OK: Decodable { let ok: Bool }
        let _: OK = try await send("DELETE", "api/characters", query: ["id": characterId])
    }

    func forgePortrait(for character: Character, previousAppearance: String?, note: String?) async throws -> PortraitResult {
        struct Body: Encodable { let character: Character; let previousAppearance: String?; let note: String? }
        return try await send("POST", "api/portrait",
                              body: Body(character: character, previousAppearance: previousAppearance, note: note),
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

    func start(_ code: String, sceneCount: Int) async throws -> GameState {
        struct Body: Encodable { let sceneCount: Int }
        return try await send("POST", "api/games/\(code)/start", body: Body(sceneCount: sceneCount))
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
