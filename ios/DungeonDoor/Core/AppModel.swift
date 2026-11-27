import Foundation
import Observation

/// App-wide state: the catalog, this player's heroes, and the game they're in.
/// The catalog and roster are cached on disk so the app opens instantly and survives a bad signal.
@MainActor @Observable
final class AppModel {
    let api: APIClient
    let playerId: String

    private(set) var catalog: Catalog?
    /// The SRD text behind the sheets. Nil until it has been fetched once (and on a server without
    /// one); everything falls back to ids turned into words.
    private(set) var reference: Reference?
    private var referenceIsFresh = false
    private(set) var characters: [Character] = []
    var catalogError: String?
    var activeGame: GameSession? { didSet { PushCenter.shared.openGame = activeGame?.code } }
    /// Invitations to parties still gathering, newest first.
    private(set) var invitations: [Invitation] = []
    /// A door code to knock on, from a tapped invitation. The home screen opens the join sheet with it.
    var joinCode: String?
    /// True once the first refresh has come back (or failed), so launch arguments know the roster is as fresh as it gets.
    private(set) var didRefresh = false
    #if DEBUG
    /// When set, refresh and resume do nothing so a screenshot harness can hold fixture state.
    private var demoFrozen = false
    #endif

    init() {
        playerId = AppConfig.playerId
        api = APIClient(base: AppConfig.apiBase, playerId: playerId, appKey: AppConfig.appKey)
        catalog = Self.load(Catalog.self, from: "catalog.json")
        reference = Self.load(Reference.self, from: "reference.json")
        characters = Self.load([Character].self, from: "characters-\(playerId).json") ?? []
    }

    func refresh() async {
        #if DEBUG
        if demoFrozen { return }
        #endif
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
        // The reference is static: once per launch is plenty, and the copy on disk does until then.
        if !referenceIsFresh, let fresh = try? await api.reference() {
            reference = fresh
            referenceIsFresh = true
            Self.store(fresh, to: "reference.json")
        }
        await refreshInvitations()
        didRefresh = true
    }

    func refreshInvitations() async {
        if let fresh = try? await api.invitations() { invitations = fresh }
    }

    func decline(_ invitation: Invitation) async {
        invitations.removeAll { $0.code == invitation.code }
        try? await api.decline(invitationTo: invitation.code)
    }

    /// A tapped notification: an invitation opens the way in; anything else opens its game.
    func open(_ news: PushNews) async {
        if news.isInvite {
            await refreshInvitations()
            if activeGame == nil { joinCode = news.code }
            return
        }
        guard activeGame?.code != news.code else { return }
        guard let state = try? await api.game(news.code, since: nil), state.player(playerId) != nil else { return }
        enter(state)
    }

    /// Saves a hero. `backgroundId` is the forge's pick for a new or level-1 hero; nil keeps the
    /// sheet as it is (or lets the server pick, for a new hero).
    func save(_ character: Character, backgroundId: String? = nil) async throws -> Character {
        var c = character
        c.ownerId = playerId
        let saved = try await api.save(c, backgroundId: backgroundId)
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

    /// Has a temple raise a dead hero, paid from `payer`'s purse (the hero's own, or another of
    /// the player's living heroes).
    func raise(_ hero: Character, paidBy payer: Character) async throws {
        let raised = try await api.revive(characterId: hero.id, payerId: payer.id == hero.id ? nil : payer.id)
        if let i = characters.firstIndex(where: { $0.id == raised.id }) { characters[i] = raised }
        persistCharacters()
        // The payer's purse is lighter now: fetch the roster as the server has it.
        await refresh()
    }

    func enter(_ state: GameState) {
        activeGame?.stop()
        let session = GameSession(api: api, playerId: playerId, initial: state)
        activeGame = session
        UserDefaults.standard.set(state.code, forKey: "dd.lastGame")
        session.start()
        invitations.removeAll { $0.code == state.code }
        // Leave to notify is asked at launch (DungeonDoorApp). Asked again here for a player who
        // opened the app before the server sent pushes; it is a no-op once iOS has an answer.
        if catalog?.push == true { Task { await PushCenter.shared.enable() } }
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
        // An adventure sends each hero's sheet home (level, XP, or their death): fetch the roster again.
        Task { await refresh() }
    }

    /// Reopens the game this device was last in, if it's still going.
    func resumeIfPossible() async {
        #if DEBUG
        if demoFrozen { return }
        #endif
        guard activeGame == nil else { return }
        // A game named on the command line opens even when it has ended, to look at its finale.
        let asked = AppConfig.openGameArgument
        let code = asked ?? UserDefaults.standard.string(forKey: "dd.lastGame")
        guard let code, let state = try? await api.game(code, since: nil),
              state.status != .ended || asked != nil, state.player(playerId) != nil else { return }
        enter(state)
    }

    #if DEBUG
    /// Loads fixture catalog and roster, then ignores the network. Screenshot harness only.
    func freezeForDemo(catalog: Catalog, characters: [Character], reference: Reference? = nil) {
        self.catalog = catalog
        self.characters = characters
        if let reference { self.reference = reference }
        referenceIsFresh = true
        catalogError = nil
        didRefresh = true
        demoFrozen = true
    }
    #endif

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
