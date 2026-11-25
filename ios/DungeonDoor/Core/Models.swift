import Foundation

// Mirrors docs/api.md. Timestamps stay ISO-8601 strings; nothing here does date math on them.

struct CatalogOption: Codable, Hashable, Identifiable {
    let id: String
    let name: String
    var blurb: String?
    var symbol: String?
}

struct DungeonMasterInfo: Codable, Hashable, Identifiable {
    let id: String
    let name: String
    let tagline: String
    let description: String
    var symbol: String?
    var accent: String?
}

struct Catalog: Codable, Hashable {
    var races: [CatalogOption]
    var classes: [CatalogOption]
    var temperaments: [CatalogOption]
    var genders: [CatalogOption]
    var alignments: [CatalogOption]
    var dungeonMasters: [DungeonMasterInfo]

    func name(_ id: String, in list: KeyPath<Catalog, [CatalogOption]>) -> String {
        self[keyPath: list].first { $0.id == id }?.name ?? id.capitalized
    }

    func dungeonMaster(_ id: String) -> DungeonMasterInfo? {
        dungeonMasters.first { $0.id == id }
    }
}

struct Character: Codable, Hashable, Identifiable {
    var id: String
    var ownerId: String
    var name: String
    var race: String
    var characterClass: String
    var gender: String
    var temperament: String
    var alignment: String
    var backstory: String
    var description: String
    var appearance: String?
    var portraitUrl: String?
    var createdAt: String
    var updatedAt: String

    static func blank(ownerId: String) -> Character {
        let now = ISO8601DateFormatter().string(from: .now)
        return Character(
            id: UUID().uuidString.lowercased(), ownerId: ownerId, name: "",
            race: "", characterClass: "", gender: "", temperament: "", alignment: "",
            backstory: "", description: "", appearance: nil, portraitUrl: nil,
            createdAt: now, updatedAt: now)
    }

    var portraitURL: URL? { portraitUrl.flatMap(URL.init(string:)) }
}

enum GameStatus: String, Codable {
    case lobby, preparing, voting, resolving, ended
}

struct GamePlayer: Codable, Hashable, Identifiable {
    let playerId: String
    let character: Character
    let isHost: Bool
    let joinedAt: String
    var id: String { playerId }
}

struct Choice: Codable, Hashable, Identifiable {
    let id: String
    let label: String
    let detail: String
}

struct Vote: Codable, Hashable {
    let playerId: String
    let choiceId: String
    let roll: Int
}

struct GameScene: Codable, Hashable {
    let index: Int
    let title: String
    let narration: String
    let imageUrl: String?
    let choices: [Choice]
    let isFinale: Bool
    let votes: [Vote]
    let myVote: String?
    let outcome: String?

    var imageURL: URL? { imageUrl.flatMap(URL.init(string:)) }
}

struct ChronicleEntry: Codable, Hashable, Identifiable {
    let index: Int
    let title: String
    let imageUrl: String?
    let choiceLabel: String
    let outcome: String
    var id: Int { index }
    var imageURL: URL? { imageUrl.flatMap(URL.init(string:)) }
}

struct Message: Codable, Hashable, Identifiable {
    enum Kind: String, Codable { case chat, system, dm }
    let id: Int
    let kind: Kind
    let playerId: String?
    let characterName: String?
    let text: String
    let createdAt: String
}

struct GameState: Codable, Hashable {
    let code: String
    let hostId: String
    let status: GameStatus
    let dungeonMaster: String
    let title: String?
    let sceneCount: Int
    let players: [GamePlayer]
    let scene: GameScene?
    var chronicle: [ChronicleEntry]?
    let messages: [Message]
    let updatedAt: String

    func player(_ id: String?) -> GamePlayer? { players.first { $0.playerId == id } }
}

struct PortraitResult: Codable {
    let appearance: String
    let portraitUrl: String
}
