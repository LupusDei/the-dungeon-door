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
    /// `boost` is where that background's ability increases go.
    func save(_ character: Character, backgroundId: String?, boost: AbilityBoost?) async throws -> Character {
        try await send("PUT", "api/characters", body: CharacterDraft(character, backgroundId: backgroundId, boost: boost))
    }

    /// Places the background's ability increases once, on a hero the forge built whose scores are still that.
    func assignBonuses(characterId: String, boost: AbilityBoost) async throws -> Character {
        struct Body: Encodable { let characterId: String; let boost: AbilityBoost }
        return try await send("POST", "api/characters/ability-boost", body: Body(characterId: characterId, boost: boost))
    }

    func delete(characterId: String) async throws {
        struct OK: Decodable { let ok: Bool }
        let _: OK = try await send("DELETE", "api/characters", query: ["id": characterId])
    }

    /// A temple's Raise Dead between adventures. The dead hero's own purse pays, or `payerId`'s:
    /// another living hero of the same player. 409 when the purse is too light.
    func revive(characterId: String, payerId: String?) async throws -> Character {
        struct Body: Encodable { let characterId: String; let payerId: String? }
        return try await send("POST", "api/characters/revive", body: Body(characterId: characterId, payerId: payerId))
    }

    /// The level-1 sheet a save would build for this hero; nothing is stored. The id seeds the
    /// build, so the preview is the hero that will be saved.
    func sheet(id: String, name: String, race: String, characterClass: String, backgroundId: String?, boost: AbilityBoost?) async throws -> SheetPreview {
        struct Body: Encodable {
            let id: String
            let name: String
            let race: String
            let characterClass: String
            let backgroundId: String?
            let boost: AbilityBoost?
        }
        return try await send("POST", "api/sheet",
                              body: Body(id: id, name: name, race: race, characterClass: characterClass, backgroundId: backgroundId, boost: boost))
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

    /// `voice` is "in" (the hero) or "out" (the player). `replyTo` quotes that message.
    func say(_ code: String, text: String, voice: String, replyTo: Int?) async throws -> Message {
        struct Body: Encodable { let text: String; let voice: String; let replyTo: Int? }
        return try await send("POST", "api/games/\(code)/messages", body: Body(text: text, voice: voice, replyTo: replyTo))
    }

    /// Toggles the caller's emoji on a line. The returned line has the same id.
    func react(_ code: String, messageId: Int, emoji: String) async throws -> Message {
        struct Body: Encodable { let messageId: Int; let emoji: String }
        return try await send("POST", "api/games/\(code)/reactions", body: Body(messageId: messageId, emoji: emoji))
    }

    /// Says the caller is composing, or clears it. The next poll shows it to everyone else.
    func typing(_ code: String, typing: Bool) async throws {
        struct Body: Encodable { let typing: Bool }
        struct OK: Decodable { let ok: Bool }
        let _: OK = try await send("POST", "api/games/\(code)/typing", body: Body(typing: typing))
    }

    /// A line or a deed in character. No roll. The reply is the game, with the line on the scene.
    func speak(_ code: String, text: String) async throws -> GameState {
        struct Body: Encodable { let text: String }
        return try await send("POST", "api/games/\(code)/speak", body: Body(text: text))
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
        try await vote(code, sceneIndex: sceneIndex, choiceId: choiceId, actionId: nil, targets: [], move: nil)
    }

    /// Votes a letter, an action from `scene.actions`, or both. `move` is a band and/or a square.
    /// Targets are omitted when the action needs none.
    func vote(_ code: String, sceneIndex: Int, choiceId: String?, actionId: String?, targets: [String], move: VoteMove?) async throws -> GameState {
        struct Body: Encodable {
            let sceneIndex: Int
            let choiceId: String?
            let actionId: String?
            let targets: [String]
            let move: VoteMove?

            enum CodingKeys: String, CodingKey {
                case sceneIndex, choiceId, actionId, targets, move
            }

            func encode(to encoder: Encoder) throws {
                var c = encoder.container(keyedBy: CodingKeys.self)
                try c.encode(sceneIndex, forKey: .sceneIndex)
                try c.encodeIfPresent(choiceId, forKey: .choiceId)
                try c.encodeIfPresent(actionId, forKey: .actionId)
                if !targets.isEmpty { try c.encode(targets, forKey: .targets) }
                if let move, move.isSendable { try c.encode(move, forKey: .move) }
            }
        }
        return try await send("POST", "api/games/\(code)/vote",
                              body: Body(sceneIndex: sceneIndex, choiceId: choiceId, actionId: actionId, targets: targets, move: move))
    }

    /// What the player does, in their own words. The dungeon master classifies it; the engine keeps the numbers.
    func act(_ code: String, sceneIndex: Int, text: String) async throws -> GameState {
        struct Body: Encodable { let sceneIndex: Int; let text: String }
        return try await send("POST", "api/games/\(code)/action", body: Body(sceneIndex: sceneIndex, text: text))
    }

    func advance(_ code: String) async throws -> GameState {
        try await send("POST", "api/games/\(code)/advance", body: [String: String]())
    }

    /// Asks for a scene to be read aloud. The server makes one reading per scene, the first time
    /// anyone asks; while it is "making", the file arrives on the scene itself.
    /// `voice` is a catalog narrators id; nil leaves the choice to the server.
    func narration(_ code: String, sceneIndex: Int, voice: String?) async throws -> NarrationReply {
        struct Body: Encodable { let sceneIndex: Int; let voice: String? }
        return try await send("POST", "api/games/\(code)/narration", body: Body(sceneIndex: sceneIndex, voice: voice))
    }

    /// A reading's audio, whole: it is played from memory, so any server that can send a file will do.
    func audio(at url: URL) async throws -> Data {
        var request = URLRequest(url: url, timeoutInterval: 60)
        if let appKey, !appKey.isEmpty, url.host == base.host { request.setValue(appKey, forHTTPHeaderField: "x-dd-key") }
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode), !data.isEmpty else {
            throw URLError(.badServerResponse)
        }
        return data
    }

    // MARK: Transport

    // MARK: Pushes and invitations

    private struct OK: Decodable { let ok: Bool }

    /// This device takes pushes for this player. `environment` is "sandbox" or "production".
    func registerDevice(token: String, environment: String) async throws {
        struct Body: Encodable { let token: String; let environment: String }
        let _: OK = try await send("POST", "api/devices", body: Body(token: token, environment: environment))
    }

    func unregisterDevice(token: String) async throws {
        struct Body: Encodable { let token: String }
        let _: OK = try await send("DELETE", "api/devices", body: Body(token: token))
    }

    /// The players this one has shared a game with, most recent first.
    func companions() async throws -> [Companion] {
        struct Wrapper: Decodable { let companions: [Companion] }
        let w: Wrapper = try await send("GET", "api/companions")
        return w.companions
    }

    /// Invites a companion to a party in its lobby.
    func invite(_ code: String, playerId: String) async throws {
        struct Body: Encodable { let playerId: String }
        let _: OK = try await send("POST", "api/games/\(code)/invites", body: Body(playerId: playerId))
    }

    func invitations() async throws -> [Invitation] {
        struct Wrapper: Decodable { let invites: [Invitation] }
        let w: Wrapper = try await send("GET", "api/invites")
        return w.invites
    }

    func decline(invitationTo code: String) async throws {
        let _: OK = try await send("DELETE", "api/invites", query: ["code": code])
    }

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
