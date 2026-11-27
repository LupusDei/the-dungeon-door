import Foundation

// Mirrors docs/api.md. Timestamps stay ISO-8601 strings; nothing here does date math on them.
//
// Decoding is lenient on purpose. A server from before the rules engine (and any JSON cached on
// disk from then) leaves out sheets, parties, fights and maps, so every field that arrived with
// them falls back to an empty value instead of failing the whole reply.

extension KeyedDecodingContainer {
    /// The value for `key`, or `fallback` when the key is absent or null.
    func value<T: Decodable>(_ key: Key, or fallback: @autoclosure () -> T) throws -> T {
        try decodeIfPresent(T.self, forKey: key) ?? fallback()
    }

    /// A whole number, forgiving a server that sends 7.5 where the contract says 7.
    func whole(_ key: Key, or fallback: Int = 0) throws -> Int {
        if let exact = try? decodeIfPresent(Int.self, forKey: key) { return exact }
        guard let loose = try decodeIfPresent(Double.self, forKey: key), loose.isFinite, abs(loose) < 1e15 else {
            return fallback
        }
        return Int(loose.rounded())
    }

    /// A whole number when the key is present, or nil when it is absent or null.
    func optionalWhole(_ key: Key) throws -> Int? {
        guard contains(key) else { return nil }
        if try decodeNil(forKey: key) { return nil }
        return try whole(key)
    }
}

// MARK: - Catalog

struct CatalogOption: Codable, Hashable, Identifiable {
    let id: String
    let name: String
    var blurb: String?
    var symbol: String?
    /// Backgrounds only: the abilities the background can raise ("str", "dex", "con").
    var abilities: [String]?
}

struct DungeonMasterInfo: Codable, Hashable, Identifiable {
    let id: String
    let name: String
    let tagline: String
    let description: String
    var symbol: String?
    var accent: String?
}

/// A voice the narrator can read in (`catalog.narrators`).
struct NarratorInfo: Codable, Hashable, Identifiable {
    let id: String
    let name: String
    var description: String = ""
}

extension NarratorInfo {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.value(.name, or: id.capitalized)
        description = try c.value(.description, or: "")
    }
}

struct Catalog: Codable, Hashable {
    var races: [CatalogOption]
    var classes: [CatalogOption]
    var temperaments: [CatalogOption]
    var genders: [CatalogOption]
    var alignments: [CatalogOption]
    /// SRD backgrounds. Empty on a server without character sheets.
    var backgrounds: [CatalogOption]
    /// The kinds of game a host can start ("none", "fixed", "explore"), in the order to show them.
    /// Empty on a server that only tells stories.
    var dungeons: [CatalogOption]
    var dungeonMasters: [DungeonMasterInfo]
    /// The voices a scene can be read aloud in, in the order to show them. Empty on a server
    /// without them: the narrator then reads in the server's one voice.
    var narrators: [NarratorInfo] = []
    /// The narrator a request gets when it names none.
    var defaultNarrator: String?
    /// True when the server sends push notifications (it holds the push key). False on a server
    /// that does not, and on one from before pushes: the app then never asks leave to notify.
    var push = false

    func name(_ id: String, in list: KeyPath<Catalog, [CatalogOption]>) -> String {
        self[keyPath: list].first { $0.id == id }?.name ?? id.capitalized
    }

    func dungeonMaster(_ id: String) -> DungeonMasterInfo? {
        dungeonMasters.first { $0.id == id }
    }
}

extension Catalog {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        races = try c.decode([CatalogOption].self, forKey: .races)
        classes = try c.decode([CatalogOption].self, forKey: .classes)
        temperaments = try c.decode([CatalogOption].self, forKey: .temperaments)
        genders = try c.decode([CatalogOption].self, forKey: .genders)
        alignments = try c.decode([CatalogOption].self, forKey: .alignments)
        backgrounds = try c.value(.backgrounds, or: [])
        dungeons = try c.value(.dungeons, or: [])
        dungeonMasters = try c.decode([DungeonMasterInfo].self, forKey: .dungeonMasters)
        narrators = try c.value(.narrators, or: [])
        defaultNarrator = try c.decodeIfPresent(String.self, forKey: .defaultNarrator)
        push = try c.value(.push, or: false)
    }
}

// MARK: - Rules reference

/// A spell's SRD entry.
struct SpellInfo: Codable, Hashable {
    var name: String
    /// 0 is a cantrip.
    var level: Int
    var school: String
    var castingTime: String
    var range: String
    var duration: String
    /// "V, S, M".
    var components: String
    var concentration: Bool
    var ritual: Bool
    var description: String
}

extension SpellInfo {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = try c.value(.name, or: "")
        level = try c.whole(.level)
        school = try c.value(.school, or: "")
        castingTime = try c.value(.castingTime, or: "")
        range = try c.value(.range, or: "")
        duration = try c.value(.duration, or: "")
        components = try c.value(.components, or: "")
        concentration = try c.value(.concentration, or: false)
        ritual = try c.value(.ritual, or: false)
        description = try c.value(.description, or: "")
    }
}

/// A named rule and its text: a species trait, a feat, a class feature, a condition.
struct RuleInfo: Codable, Hashable {
    var name: String
    var description: String
}

extension RuleInfo {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = try c.value(.name, or: "")
        description = try c.value(.description, or: "")
    }
}

struct SkillInfo: Codable, Hashable {
    var name: String
    var ability: String
    var description: String
}

extension SkillInfo {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = try c.value(.name, or: "")
        ability = try c.value(.ability, or: "")
        description = try c.value(.description, or: "")
    }
}

/// `GET /api/reference`: the SRD 5.2 text behind the ids on a sheet, keyed by SRD id. Static.
/// Descriptions are plain text, one paragraph per line, with `**bold**` around a rule's name.
struct Reference: Codable, Hashable {
    var spells: [String: SpellInfo] = [:]
    var traits: [String: RuleInfo] = [:]
    var feats: [String: RuleInfo] = [:]
    /// Class and subclass features, by class id and then by the name a sheet lists them under.
    var features: [String: [String: RuleInfo]] = [:]
    var skills: [String: SkillInfo] = [:]
    var conditions: [String: RuleInfo] = [:]
    /// The SRD's CC-BY-4.0 notice. Shown wherever the text above is shown.
    var attribution = ""

    /// `sheet.feat` is a feat's name, not its id: look it up without minding the case.
    func feat(named name: String) -> RuleInfo? {
        feats.values.first { $0.name.compare(name, options: .caseInsensitive) == .orderedSame }
    }

    /// A class feature by the name on the sheet. Subclass features are filed under the class too.
    func feature(named name: String, classId: String) -> RuleInfo? {
        if let exact = features[classId]?[name] { return exact }
        return features[classId]?.first { $0.key.compare(name, options: .caseInsensitive) == .orderedSame }?.value
    }
}

extension Reference {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        spells = try c.value(.spells, or: [:])
        traits = try c.value(.traits, or: [:])
        feats = try c.value(.feats, or: [:])
        features = try c.value(.features, or: [:])
        skills = try c.value(.skills, or: [:])
        conditions = try c.value(.conditions, or: [:])
        attribution = try c.value(.attribution, or: "")
    }
}

// MARK: - Characters

/// One number per ability: scores, or saving-throw bonuses.
struct AbilityScores: Codable, Hashable {
    var str = 10
    var dex = 10
    var con = 10
    var int = 10
    var wis = 10
    var cha = 10

    subscript(ability: String) -> Int {
        switch ability {
        case "str": str
        case "dex": dex
        case "con": con
        case "int": int
        case "wis": wis
        case "cha": cha
        default: 10
        }
    }
}

struct EquipmentItem: Codable, Hashable {
    var id: String
    var name: String
    var count: Int
}

extension EquipmentItem {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let itemId = try c.value(.id, or: "")
        id = itemId
        name = try c.value(.name, or: SRD.name(itemId))
        count = try c.whole(.count, or: 1)
    }
}

struct Spellcasting: Codable, Hashable {
    var ability: String
    var saveDc: Int
    var attackBonus: Int
    /// Slots per spell level, 1st through 9th.
    var slots: [Int]
    /// Slots spent per spell level since they were last regained.
    var expended: [Int]
    var cantrips: [String]
    var prepared: [String]
    /// The spell id the caster is concentrating on, if any.
    var concentratingOn: String?

    /// Slots still to spend, per spell level.
    var slotsLeft: [Int] {
        slots.enumerated().map { index, most in
            max(0, most - (expended.indices.contains(index) ? expended[index] : 0))
        }
    }
}

extension Spellcasting {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        ability = try c.value(.ability, or: "")
        saveDc = try c.whole(.saveDc)
        attackBonus = try c.whole(.attackBonus)
        slots = try c.value(.slots, or: [])
        expended = try c.value(.expended, or: [])
        cantrips = try c.value(.cantrips, or: [])
        prepared = try c.value(.prepared, or: [])
        concentratingOn = try c.decodeIfPresent(String.self, forKey: .concentratingOn)
    }
}

/// Where a background's ability increases go (SRD 5.2): +2 and +1, or +1 to each of its three scores.
struct AbilityBoost: Codable, Hashable {
    var kind: String
    var plusTwo: String?
    var plusOne: String?

    init(kind: String, plusTwo: String? = nil, plusOne: String? = nil) {
        self.kind = kind
        self.plusTwo = plusTwo
        self.plusOne = plusOne
    }

    private enum CodingKeys: String, CodingKey { case kind, plusTwo, plusOne }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        kind = try c.decode(String.self, forKey: .kind)
        plusTwo = try c.decodeIfPresent(String.self, forKey: .plusTwo)
        plusOne = try c.decodeIfPresent(String.self, forKey: .plusOne)
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(kind, forKey: .kind)
        try c.encodeIfPresent(plusTwo, forKey: .plusTwo)
        try c.encodeIfPresent(plusOne, forKey: .plusOne)
    }

    /// A complete placement on this background's abilities.
    func isValid(for abilities: [String]) -> Bool {
        switch kind {
        case "oneOneOne":
            return Set(abilities).count >= 3
        case "twoOne":
            guard let plusTwo, let plusOne, plusTwo != plusOne else { return false }
            return abilities.contains(plusTwo) && abilities.contains(plusOne)
        default:
            return false
        }
    }
}

/// A hero's 5e numbers (SRD 5.2). Built and kept by the server's rules engine; the app only shows it.
struct CharacterSheet: Codable, Hashable {
    var version: Int
    var name: String
    var level: Int
    var xp: Int
    var classId: String
    var speciesId: String
    var backgroundId: String
    var subclassId: String?
    var size: String
    var speed: Int
    var abilityScores: AbilityScores
    /// The player's placement of the background's increases. Nil when the forge placed them.
    var abilityBoost: AbilityBoost? = nil
    var proficiencyBonus: Int
    var maxHp: Int
    var hp: Int
    var armorClass: Int
    /// Hit dice spent, of one per level; all come back on a long rest.
    var hitDiceSpent: Int
    /// 0–6. Each level is −2 to d20 tests and −5 ft of speed; 6 is death.
    var exhaustion: Int
    var savingThrows: [String]
    var saveBonuses: AbilityScores
    var skills: [String]
    var skillBonuses: [String: Int]
    var passivePerception: Int
    var otherProficiencies: [String]
    var equipment: [EquipmentItem]
    var gp: Double
    var pendingChoices: [String]
    /// Species trait ids.
    var traits: [String]
    /// The background's origin feat, by name.
    var feat: String
    /// Feats taken when leveling, by SRD id.
    var feats: [String]
    /// Class and subclass features gained so far, by name, in the order gained.
    var features: [String]
    /// Uses spent of limited class features, by resource id ("rage", "second-wind").
    var resourcesUsed: [String: Int]
    /// The hero died and stays dead until raised: it cannot create or join a game.
    var dead: Bool
    /// Raised from the dead: this much off every d20 roll (0 to 4), one less after each long rest.
    var revivalPenalty: Int
    var spellcasting: Spellcasting?

    private enum CodingKeys: String, CodingKey {
        case version, name, level, xp, classId, speciesId, backgroundId, subclassId, size, speed
        case abilityScores, abilityBoost, proficiencyBonus, maxHp, hp, armorClass, hitDiceSpent, exhaustion
        case savingThrows, saveBonuses, skills, skillBonuses, passivePerception, otherProficiencies
        case equipment, gp, pendingChoices, traits, feat, feats, features, resourcesUsed, dead, revivalPenalty
        case spellcasting
    }

    var hitDiceLeft: Int { max(0, level - hitDiceSpent) }
}

extension CharacterSheet {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let scores = try c.value(.abilityScores, or: AbilityScores())
        let proficiency = try c.whole(.proficiencyBonus, or: 2)
        let saves = try c.value(.savingThrows, or: [String]())
        let most = try c.whole(.maxHp, or: 1)

        version = try c.whole(.version, or: 1)
        name = try c.value(.name, or: "")
        level = try c.whole(.level, or: 1)
        xp = try c.whole(.xp)
        classId = try c.value(.classId, or: "")
        speciesId = try c.value(.speciesId, or: "")
        backgroundId = try c.value(.backgroundId, or: "")
        subclassId = try c.decodeIfPresent(String.self, forKey: .subclassId)
        size = try c.value(.size, or: "")
        speed = try c.whole(.speed, or: 30)
        abilityScores = scores
        abilityBoost = try c.decodeIfPresent(AbilityBoost.self, forKey: .abilityBoost)
        proficiencyBonus = proficiency
        maxHp = most
        hp = try c.whole(.hp, or: most)
        armorClass = try c.whole(.armorClass, or: 10)
        hitDiceSpent = try c.whole(.hitDiceSpent)
        exhaustion = try c.whole(.exhaustion)
        savingThrows = saves
        // When the bonuses aren't sent, work them out the way the rules do.
        func save(_ id: String) -> Int { SRD.modifier(scores[id]) + (saves.contains(id) ? proficiency : 0) }
        let worked = AbilityScores(str: save("str"), dex: save("dex"), con: save("con"),
                                   int: save("int"), wis: save("wis"), cha: save("cha"))
        saveBonuses = try c.value(.saveBonuses, or: worked)
        skills = try c.value(.skills, or: [])
        skillBonuses = try c.value(.skillBonuses, or: [:])
        passivePerception = try c.whole(.passivePerception, or: 10 + SRD.modifier(scores.wis))
        otherProficiencies = try c.value(.otherProficiencies, or: [])
        equipment = try c.value(.equipment, or: [])
        gp = try c.value(.gp, or: 0)
        pendingChoices = try c.value(.pendingChoices, or: [])
        traits = try c.value(.traits, or: [])
        feat = try c.value(.feat, or: "")
        feats = try c.value(.feats, or: [])
        features = try c.value(.features, or: [])
        resourcesUsed = try c.value(.resourcesUsed, or: [:])
        dead = try c.value(.dead, or: false)
        revivalPenalty = try c.whole(.revivalPenalty)
        spellcasting = try c.decodeIfPresent(Spellcasting.self, forKey: .spellcasting)
    }
}

/// Something the hero can attack with: a weapon, or a cantrip or prepared spell that deals damage.
/// Worked out by the server from the sheet.
struct Attack: Codable, Hashable {
    var name: String
    /// Added to the d20 to hit; 0 for a spell the target saves against, and for one that never misses.
    var bonus: Int
    /// "2d6+3 slashing".
    var damage: String
    var ranged: Bool
    /// "weapon" or "spell".
    var kind: String
    /// Spells only: the save the target makes instead ("dex"), against the hero's spell save DC.
    var save: String?
    /// Spells only: no roll to hit and no save, every strike lands (Magic Missile's darts).
    var neverMisses = false

    var isSpell: Bool { kind == "spell" }
}

extension Attack {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = try c.value(.name, or: "")
        bonus = try c.whole(.bonus)
        damage = try c.value(.damage, or: "")
        ranged = try c.value(.ranged, or: false)
        kind = try c.value(.kind, or: "weapon")
        save = try c.decodeIfPresent(String.self, forKey: .save).flatMap { $0.isEmpty ? nil : $0 }
        neverMisses = try c.value(.neverMisses, or: false)
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
    /// Server-built and read-only. Nil only from a server from before the rules engine.
    var sheet: CharacterSheet?
    /// Server-built and read-only, like the sheet.
    var attacks: [Attack]?
    /// The forge placed the background's increases, and the scores are still those, so the player may place them once.
    var bonusesOpen: Bool? = nil
    var createdAt: String
    var updatedAt: String

    static func blank(ownerId: String) -> Character {
        let now = ISO8601DateFormatter().string(from: .now)
        return Character(
            id: UUID().uuidString.lowercased(), ownerId: ownerId, name: "",
            race: "", characterClass: "", gender: "", temperament: "", alignment: "",
            backstory: "", description: "", appearance: nil, portraitUrl: nil,
            sheet: nil, attacks: nil, bonusesOpen: nil, createdAt: now, updatedAt: now)
    }

    var portraitURL: URL? { portraitUrl.flatMap(URL.init(string:)) }

    /// Died on an adventure: stays on the roster, but cannot go through a door again.
    var isFallen: Bool { sheet?.dead == true }

    /// "Level 2 · HP 20 · AC 16", for rosters. Nil until the hero has a sheet.
    var vitalsLine: String? {
        sheet.map { "Level \($0.level) · HP \($0.maxHp) · AC \($0.armorClass)" }
    }

    /// The same, where there is only a tile's width: "Lv 2 · HP 20 · AC 16".
    var shortVitalsLine: String? {
        sheet.map { "Lv \($0.level) · HP \($0.maxHp) · AC \($0.armorClass)" }
    }
}

/// What the app sends to save a hero or to have its portrait painted: who they are, never the
/// sheet. `backgroundId` picks the background of a new (or still level-1) hero; nil leaves it be.
/// `boost` is where the background's ability increases go.
struct CharacterDraft: Encodable {
    let id: String
    let name: String
    let race: String
    let characterClass: String
    let gender: String
    let temperament: String
    let alignment: String
    let backstory: String
    let description: String
    let appearance: String?
    let portraitUrl: String?
    let backgroundId: String?
    let boost: AbilityBoost?

    init(_ hero: Character, backgroundId: String? = nil, boost: AbilityBoost? = nil) {
        id = hero.id
        name = hero.name
        race = hero.race
        characterClass = hero.characterClass
        gender = hero.gender
        temperament = hero.temperament
        alignment = hero.alignment
        backstory = hero.backstory
        description = hero.description
        appearance = hero.appearance
        portraitUrl = hero.portraitUrl
        self.backgroundId = backgroundId
        self.boost = boost
    }
}

/// Someone the player has shared a game with, by the hero they last played beside them.
struct Companion: Codable, Hashable, Identifiable {
    let playerId: String
    let name: String
    var id: String { playerId }
}

/// An invitation to a party still gathering in its lobby.
struct Invitation: Codable, Hashable, Identifiable {
    let code: String
    let fromName: String
    /// The heroes already in the party, by name.
    var party: [String] = []
    var id: String { code }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        code = try c.decode(String.self, forKey: .code)
        fromName = try c.value(.fromName, or: "A companion")
        party = try c.value(.party, or: [])
    }
}

/// What `POST /api/sheet` answers: the level-1 sheet a save would build, and its attacks.
struct SheetPreview: Codable, Hashable {
    let sheet: CharacterSheet
    let attacks: [Attack]
}

extension SheetPreview {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        sheet = try c.decode(CharacterSheet.self, forKey: .sheet)
        attacks = try c.value(.attacks, or: [])
    }
}

// MARK: - Games

enum GameStatus: String, Codable {
    case lobby, preparing, voting, resolving, ended
}

struct GamePlayer: Codable, Hashable, Identifiable {
    let playerId: String
    /// In a rules game, the hero as it stands in this game: live sheet and attacks.
    let character: Character
    let isHost: Bool
    let joinedAt: String
    var id: String { playerId }
}

struct Choice: Codable, Hashable, Identifiable {
    /// "a", "b" or "c". In a fight: Attack, Cast, and a third that fits the moment (Dodge, Break Free, Help).
    let id: String
    let label: String
    let detail: String
    /// What the rules engine will do with it: "Athletics check, DC 12", "Fight: 2 Goblin Warriors",
    /// "Short rest". Nil for a plain story choice, and on a fight's own three.
    var rules: String?
}

extension Choice {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        label = try c.value(.label, or: "")
        detail = try c.value(.detail, or: "")
        rules = try c.decodeIfPresent(String.self, forKey: .rules).flatMap { $0.isEmpty ? nil : $0 }
    }
}

struct Vote: Codable, Hashable {
    let playerId: String
    let choiceId: String
    /// The d20 the server rolled with the vote. In a fight it is the hero's attack roll.
    let roll: Int
    /// In a round of a fight: what that hero is doing, in their own choice's words ("Cast Fire
    /// Bolt", "Break Free", "Help Ilsa"). The same id means different things for different heroes.
    var label: String? = nil
    /// Set when the vote named an action from `scene.actions` rather than a letter.
    var actionId: String? = nil
    /// Ids from that action's targets. Empty when the vote named nobody.
    var targets: [String] = []
    /// A move taken with the vote: a range band, a square, or both.
    var move: VoteMove? = nil

    private enum CodingKeys: String, CodingKey {
        case playerId, choiceId, roll, label, actionId, targets, move
    }
}

extension Vote {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        playerId = try c.decode(String.self, forKey: .playerId)
        choiceId = try c.value(.choiceId, or: "")
        roll = try c.whole(.roll)
        label = try c.decodeIfPresent(String.self, forKey: .label)
        actionId = try c.decodeIfPresent(String.self, forKey: .actionId)
        targets = try c.value(.targets, or: [])
        move = try? c.decode(VoteMove.self, forKey: .move)
    }
}

/// One square of a tactical map. `x` grows east, `y` grows south, both counted from 0.
struct GridPoint: Codable, Hashable, Identifiable {
    let x: Int
    let y: Int
    var id: String { "\(x),\(y)" }

    init(x: Int, y: Int) {
        self.x = x
        self.y = y
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        x = try c.whole(.x)
        y = try c.whole(.y)
    }

    private enum CodingKeys: String, CodingKey { case x, y }
}

/// A move sent with a vote. Older servers use a range band (`to`); a tactical map uses a square (`x`, `y`).
struct VoteMove: Codable, Hashable {
    var to: String? = nil
    var engage: [String]? = nil
    var dash: Bool? = nil
    var disengage: Bool? = nil
    var x: Int? = nil
    var y: Int? = nil

    var square: GridPoint? {
        guard let x, let y else { return nil }
        return GridPoint(x: x, y: y)
    }

    /// False when there is nothing the server can apply.
    var isSendable: Bool { to != nil || square != nil }

    init(to: String? = nil, engage: [String]? = nil, dash: Bool? = nil, disengage: Bool? = nil, x: Int? = nil, y: Int? = nil) {
        self.to = to
        self.engage = engage
        self.dash = dash
        self.disengage = disengage
        self.x = x
        self.y = y
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        to = try c.decodeIfPresent(String.self, forKey: .to)
        engage = try c.decodeIfPresent([String].self, forKey: .engage)
        dash = try c.decodeIfPresent(Bool.self, forKey: .dash)
        disengage = try c.decodeIfPresent(Bool.self, forKey: .disengage)
        x = c.contains(.x) ? try c.whole(.x) : nil
        y = c.contains(.y) ? try c.whole(.y) : nil
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(to, forKey: .to)
        if let engage, !engage.isEmpty { try c.encode(engage, forKey: .engage) }
        if dash == true { try c.encode(true, forKey: .dash) }
        if disengage == true { try c.encode(true, forKey: .disengage) }
        try c.encodeIfPresent(x, forKey: .x)
        try c.encodeIfPresent(y, forKey: .y)
    }

    private enum CodingKeys: String, CodingKey {
        case to, engage, dash, disengage, x, y
    }
}

/// Who or what a legal action may name.
struct LegalTarget: Codable, Hashable, Identifiable {
    let id: String
    let name: String

    init(id: String, name: String) {
        self.id = id
        self.name = name
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.value(.id, or: "")
        name = try c.value(.name, or: id)
    }

    private enum CodingKeys: String, CodingKey { case id, name }
}

/// How far an attack or spell reaches, in feet. `long` is the disadvantage band when the server sends one.
struct ActionRange: Codable, Hashable {
    let normal: Int
    var long: Int? = nil

    init(normal: Int, long: Int? = nil) {
        self.normal = normal
        self.long = long
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        normal = try c.whole(.normal)
        long = try c.optionalWhole(.long)
    }

    private enum CodingKeys: String, CodingKey { case normal, long }
}

/// One action this hero may take this turn (`scene.actions`). A kind the app has not met is still shown.
struct LegalAction: Codable, Hashable, Identifiable {
    let id: String
    let label: String
    /// "attack", "spell", "item", "feature", "common", "choice", "move", or a kind added later.
    let kind: String
    let detail: String
    var targets: [LegalTarget] = []
    /// "none", "one" or "many".
    var picks: String = "none"
    /// For "many": at most this many targets.
    var limit: Int? = nil
    var available: Bool = true
    var reason: String? = nil
    /// Squares a move may end on. Empty until the tactical map sends them.
    var squares: [GridPoint] = []
    /// A ranged attack or spell. Nil on a melee blow and on servers from before range in feet.
    var rangeFeet: ActionRange? = nil
    /// Melee or reach, in feet. Nil when this action has no reach.
    var reachFeet: Int? = nil

    init(id: String, label: String, kind: String, detail: String, targets: [LegalTarget] = [],
         picks: String = "none", limit: Int? = nil, available: Bool = true, reason: String? = nil,
         squares: [GridPoint] = [], rangeFeet: ActionRange? = nil, reachFeet: Int? = nil) {
        self.id = id
        self.label = label
        self.kind = kind
        self.detail = detail
        self.targets = targets
        self.picks = picks
        self.limit = limit
        self.available = available
        self.reason = reason
        self.squares = squares
        self.rangeFeet = rangeFeet
        self.reachFeet = reachFeet
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.value(.id, or: "")
        label = try c.value(.label, or: id)
        kind = try c.value(.kind, or: "choice")
        detail = try c.value(.detail, or: "")
        targets = (try? c.decode([LegalTarget].self, forKey: .targets)) ?? []
        picks = try c.value(.picks, or: "none")
        limit = try c.optionalWhole(.limit)
        available = try c.value(.available, or: true)
        reason = try c.decodeIfPresent(String.self, forKey: .reason).flatMap { $0.isEmpty ? nil : $0 }
        squares = (try? c.decode([GridPoint].self, forKey: .squares)) ?? []
        rangeFeet = try? c.decode(ActionRange.self, forKey: .rangeFeet)
        reachFeet = try c.optionalWhole(.reachFeet)
    }

    private enum CodingKeys: String, CodingKey {
        case id, label, kind, detail, targets, picks, limit, available, reason, squares, rangeFeet, reachFeet
    }

    /// `move:dash`, or a band move whose id carries `:dash`.
    var namesDash: Bool {
        id.localizedCaseInsensitiveContains("dash") || label.localizedCaseInsensitiveContains("dash")
    }

    /// A move that leaves an enemy's reach without an opportunity attack.
    var namesDisengage: Bool {
        id.localizedCaseInsensitiveContains("disengage") || label.localizedCaseInsensitiveContains("disengage")
    }
}

/// A square the battlefield marks as cover.
struct CoverCell: Codable, Hashable, Identifiable {
    let x: Int
    let y: Int
    /// "half", "three-quarters", or whatever the server called it. Nil when it only marked the square.
    var kind: String? = nil
    var id: String { "\(x),\(y)" }
    var point: GridPoint { GridPoint(x: x, y: y) }

    init(x: Int, y: Int, kind: String? = nil) {
        self.x = x
        self.y = y
        self.kind = kind
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        if let square = (try? c.decodeIfPresent(GridPoint.self, forKey: .square)) ?? nil {
            x = square.x
            y = square.y
        } else {
            x = try c.whole(.x)
            y = try c.whole(.y)
        }
        kind = try c.decodeIfPresent(String.self, forKey: .kind)
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(x, forKey: .x)
        try c.encode(y, forKey: .y)
        try c.encodeIfPresent(kind, forKey: .kind)
    }

    private enum CodingKeys: String, CodingKey { case x, y, kind, square }
}

/// The room the fight is happening in. Nil on a server from before the tactical map, and outside a fight.
struct Battlefield: Codable, Hashable {
    /// Room size in squares. A room is 10 by 8; a road fight is 16 by 6. `squareFeet` is how wide one square is.
    let width: Int
    let height: Int
    var squareFeet: Int = 5
    /// Squares a token cannot enter: pillars, walls.
    var walls: [GridPoint] = []
    var cover: [CoverCell] = []

    init(width: Int, height: Int, squareFeet: Int = 5, walls: [GridPoint] = [], cover: [CoverCell] = []) {
        self.width = width
        self.height = height
        self.squareFeet = squareFeet
        self.walls = walls
        self.cover = cover
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        width = try c.whole(.width)
        height = try c.whole(.height)
        squareFeet = max(1, try c.whole(.squareFeet, or: 5))
        walls = Self.wallSquares(from: c)
        cover = (try? c.decode([CoverCell].self, forKey: .cover)) ?? []
    }

    private enum CodingKeys: String, CodingKey {
        case width, height, squareFeet, walls, cover
    }

    /// Columns. `width` is a count of squares: a room is 10 by 8, a road fight 16 by 6.
    var columns: Int { max(width, 1) }
    /// Rows. `height` is a count of squares.
    var rows: Int { max(height, 1) }

    /// Blocked squares. A segment `{from, to}` blocks the squares at each end. A shape the app
    /// does not know is skipped, and the room still draws.
    private static func wallSquares(from c: KeyedDecodingContainer<CodingKeys>) -> [GridPoint] {
        let raw = (try? c.decode([LooseWall].self, forKey: .walls)) ?? []
        var points: [GridPoint] = []
        for wall in raw { points.append(contentsOf: wall.points) }
        return points
    }

    private struct LooseWall: Decodable {
        var x: Int?
        var y: Int?
        var from: GridPoint?
        var to: GridPoint?

        var points: [GridPoint] {
            var list: [GridPoint] = []
            if let x, let y { list.append(GridPoint(x: x, y: y)) }
            if let from { list.append(from) }
            if let to { list.append(to) }
            return list
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            x = c.contains(.x) ? try c.whole(.x) : nil
            y = c.contains(.y) ? try c.whole(.y) : nil
            from = (try? c.decodeIfPresent(GridPoint.self, forKey: .from)) ?? nil
            to = (try? c.decodeIfPresent(GridPoint.self, forKey: .to)) ?? nil
        }

        private enum CodingKeys: String, CodingKey { case x, y, from, to }
    }
}

/// The caller's vote when it named an action (`scene.myAction`).
struct MyAction: Codable, Hashable {
    let id: String
    var targets: [String] = []

    init(id: String, targets: [String] = []) {
        self.id = id
        self.targets = targets
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.value(.id, or: "")
        targets = try c.value(.targets, or: [])
    }

    private enum CodingKeys: String, CodingKey { case id, targets }
}

/// A turn the player wrote in their own words (`scene.myFreeform`, `scene.freeforms`).
struct FreeformTurn: Codable, Hashable {
    var playerId: String? = nil
    let text: String
    let roll: Int

    init(playerId: String? = nil, text: String, roll: Int) {
        self.playerId = playerId
        self.text = text
        self.roll = roll
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        playerId = try c.decodeIfPresent(String.self, forKey: .playerId)
        text = try c.value(.text, or: "")
        roll = try c.whole(.roll)
    }

    private enum CodingKeys: String, CodingKey { case playerId, text, roll }
}

/// A line or a deed a player gave in character. No roll.
struct RoleplayLine: Codable, Hashable {
    let playerId: String
    let characterName: String
    let text: String
}

struct GameScene: Codable, Hashable {
    let index: Int
    let title: String
    let narration: String
    let imageUrl: String?
    /// The readings of this scene made so far, by narrator id: audio files.
    var voices: [String: String] = [:]
    /// The default narrator's reading; all a server from before the voice picker sends.
    var voiceUrl: String? = nil
    /// Three, or none for the epilogue. In a fight they are written for the caller's own hero.
    let choices: [Choice]
    /// A round of a fight: each vote is that player's own hero's action.
    let combat: Bool
    /// False when the caller's hero is down or dead: nothing to choose, and the round doesn't wait.
    let canAct: Bool
    let isFinale: Bool
    let votes: [Vote]
    let myVote: String?
    let outcome: String?
    /// In-character lines this turn, oldest first. Empty on a server from before players could speak so.
    var roleplay: [RoleplayLine] = []
    /// What this hero may do this turn. Empty on a server from before legal actions, and on the epilogue.
    var actions: [LegalAction] = []
    /// The room, when a fight is being played on squares. Nil outside combat and on today's server.
    var battlefield: Battlefield? = nil
    /// Written checks this scene. Empty on a server from before written actions.
    var freeforms: [FreeformTurn] = []
    /// The caller's written check, or nil.
    var myFreeform: FreeformTurn? = nil
    /// The caller's vote as an action. Nil until they vote, and nil for a written check.
    var myAction: MyAction? = nil

    var imageURL: URL? { imageUrl.flatMap(URL.init(string:)) }

    /// This scene's reading by that narrator, if it has been made. Without an id (a server with one
    /// voice) it is the scene's only reading.
    func reading(by narrator: String?) -> URL? {
        (narrator.flatMap { voices[$0] } ?? (narrator == nil ? voiceUrl : nil)).flatMap(URL.init(string:))
    }
}

/// The answer to asking for a scene to be read aloud: the file, or word that it is being made (it
/// then arrives on the scene itself, with the game's next poll).
struct NarrationReply: Decodable {
    let sceneIndex: Int
    /// "ready" or "making".
    let status: String
    let voiceUrl: String?

    var voiceURL: URL? { voiceUrl.flatMap(URL.init(string:)) }
}

extension GameScene {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        index = try c.decode(Int.self, forKey: .index)
        title = try c.value(.title, or: "")
        narration = try c.value(.narration, or: "")
        imageUrl = try c.decodeIfPresent(String.self, forKey: .imageUrl)
        voices = try c.value(.voices, or: [:])
        voiceUrl = try c.decodeIfPresent(String.self, forKey: .voiceUrl)
        choices = try c.value(.choices, or: [])
        combat = try c.value(.combat, or: false)
        canAct = try c.value(.canAct, or: true)
        isFinale = try c.value(.isFinale, or: false)
        votes = try c.value(.votes, or: [])
        myVote = try c.decodeIfPresent(String.self, forKey: .myVote)
        outcome = try c.decodeIfPresent(String.self, forKey: .outcome)
        roleplay = try c.value(.roleplay, or: [])
        // A list the app cannot read is dropped. The rest of the scene still arrives.
        actions = (try? c.decode([LegalAction].self, forKey: .actions)) ?? []
        battlefield = try? c.decode(Battlefield.self, forKey: .battlefield)
        freeforms = (try? c.decode([FreeformTurn].self, forKey: .freeforms)) ?? []
        myFreeform = try? c.decode(FreeformTurn.self, forKey: .myFreeform)
        myAction = try? c.decode(MyAction.self, forKey: .myAction)
    }
}

// MARK: - The rules engine's view of a game

/// A limited class feature and what is left of it: Second Wind 1 of 2.
struct ResourceUse: Codable, Hashable, Identifiable {
    let id: String
    let name: String
    let left: Int
    let max: Int
}

extension ResourceUse {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let resourceId = try c.value(.id, or: "")
        let most = try c.whole(.max)
        id = resourceId
        name = try c.value(.name, or: SRD.name(resourceId))
        max = most
        left = try c.whole(.left, or: most)
    }
}

/// How one hero stands mid-adventure (`rules.party[]`).
struct HeroStanding: Codable, Hashable, Identifiable {
    let playerId: String
    let name: String
    let level: Int
    let xp: Int
    let hp: Int
    let maxHp: Int
    let armorClass: Int
    let exhaustion: Int
    let hitDiceLeft: Int
    /// Spell levels 1–9; all 0 for a hero who casts nothing.
    let slotsLeft: [Int]
    let resources: [ResourceUse]
    /// At 0 hit points.
    let down: Bool
    /// Slain: stays dead after the adventure.
    let dead: Bool
    let passivePerception: Int
    let passiveInsight: Int
    /// Feet the hero moves now: their own speed less exhaustion, 5 at most while dragging. Nil from
    /// a server older than that.
    var speed: Int? = nil
    /// The same speed, under the name the tactical map uses. Nil when the server sent `speed` only.
    var speedFeet: Int? = nil
    let gp: Double
    let inventory: [EquipmentItem]
    /// Pounds. Over `capacity` the hero is dragging (speed 5 ft), up to `dragLimit`.
    let carried: Double
    let capacity: Double
    let dragLimit: Double
    let dragging: Bool
    /// How the hero sees where the party is: "clear", "dim" (Perception rolls twice, worse die) or
    /// "none" (in darkness: checks that need eyes fail, and in a fight the hero is blinded).
    let sight: String
    /// Feet of darkvision from the hero's species; 0 without.
    let darkvision: Int
    /// Damage types the hero takes half of, from species traits: "poison", "fire".
    let resistances: [String]
    /// Conditions the hero carries from scene to scene, each with how it ends.
    let conditions: [CarriedCondition]
    /// The spell the hero holds by concentration, by name ("Bless"); nil for none.
    let concentratingOn: String?

    var id: String { playerId }
    var isUp: Bool { !down && !dead }
    var cannotSee: Bool { sight == "none" }
    var seesDimly: Bool { sight == "dim" }
    /// Feet the hero can move this turn. `speedFeet` wins when the server sent it.
    var movementFeet: Int { speedFeet ?? speed ?? 0 }

    /// "Standing", "Down" or "Fallen".
    var word: String { dead ? "Fallen" : down ? "Down" : "Standing" }
}

extension HeroStanding {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let points = try c.whole(.hp)
        playerId = try c.decode(String.self, forKey: .playerId)
        name = try c.value(.name, or: "")
        level = try c.whole(.level, or: 1)
        xp = try c.whole(.xp)
        hp = points
        maxHp = try c.whole(.maxHp, or: Swift.max(points, 1))
        armorClass = try c.whole(.armorClass, or: 10)
        exhaustion = try c.whole(.exhaustion)
        hitDiceLeft = try c.whole(.hitDiceLeft)
        slotsLeft = try c.value(.slotsLeft, or: [])
        resources = try c.value(.resources, or: [])
        dead = try c.value(.dead, or: false)
        down = try c.value(.down, or: points <= 0)
        passivePerception = try c.whole(.passivePerception, or: 10)
        passiveInsight = try c.whole(.passiveInsight, or: 10)
        speed = (try? c.decodeIfPresent(Double.self, forKey: .speed)).flatMap { $0 }.map { Int($0.rounded()) }
        let named = (try? c.decodeIfPresent(Double.self, forKey: .speedFeet)).flatMap { $0 }.map { Int($0.rounded()) }
        speedFeet = named ?? speed
        gp = try c.value(.gp, or: 0)
        inventory = try c.value(.inventory, or: [])
        carried = try c.value(.carried, or: 0)
        capacity = try c.value(.capacity, or: 0)
        dragLimit = try c.value(.dragLimit, or: 0)
        dragging = try c.value(.dragging, or: false)
        sight = try c.value(.sight, or: "clear")
        darkvision = try c.whole(.darkvision)
        resistances = try c.value(.resistances, or: [])
        conditions = try c.value(.conditions, or: [])
        concentratingOn = try c.decodeIfPresent(String.self, forKey: .concentratingOn)
    }
}

/// A condition a hero carries outside a fight (`rules.party[].conditions`), with how it ends as the
/// server words it: "40 minutes", "until a long rest", "DC 13 Athletics to break free", "DC 12 CON
/// save to end".
struct CarriedCondition: Codable, Hashable {
    /// A condition id: "poisoned", "restrained".
    let condition: String
    /// How it ends, read as written by the server but for one slip: a single hour or minute comes
    /// as "1 hours" and "1 minutes".
    let ends: String

    init(condition: String, ends: String) {
        self.condition = condition
        self.ends = ends
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        condition = try c.value(.condition, or: "")
        let written = try c.value(.ends, or: "")
        ends = written == "1 hours" ? "1 hour" : written == "1 minutes" ? "1 minute" : written
    }

    /// The hero must spend effort to end it: a check to break free.
    var needsEscape: Bool { ends.hasSuffix("to break free") }

    /// "Poisoned for 40 minutes", "Poisoned until a long rest", "Restrained: DC 13 Athletics to break free".
    var line: String {
        let name = SRD.name(condition)
        if ends.isEmpty { return name }
        if ends.hasPrefix("until ") { return "\(name) \(ends)" }
        if ends.hasPrefix("DC ") { return "\(name): \(ends)" }
        return "\(name) for \(ends)"
    }

    /// How it ends, as a sentence for the sheet.
    var ending: String {
        if ends.isEmpty { return "" }
        if ends.hasPrefix("until ") { return "Lasts \(ends)." }
        if needsEscape { return "\(ends). The hero tries each turn; in a fight it takes their action." }
        if ends.hasPrefix("DC ") { return "\(ends). The hero rolls it at the end of each of their turns." }
        return "Wears off in \(ends)."
    }
}

struct Combatant: Codable, Hashable, Identifiable {
    /// A hero's player id, or "foe-1", "foe-2"… for a foe.
    let id: String
    let name: String
    /// "party" or "foes".
    let side: String
    let hp: Int
    let maxHp: Int
    /// "up", "dying", "stable" or "dead".
    let status: String
    /// Condition ids: "unconscious", "prone"…
    let conditions: [String]
    /// "puny", "weak", "even", "strong" or "deadly" for a foe, against this party. Nil for a hero, and from a
    /// server older than toughness ratings.
    var toughness: String? = nil
    /// How hurt a foe looks ("Bleeding", "Bloodied", "Gasping"): its hit points are hidden, so a foe's `hp` and
    /// `maxHp` are not sent. Nil for a hero, and from a server older than wounds.
    var wound: String? = nil
    /// How full a foe's gauge looks, 0 to 1: fuzzy, so its hit points cannot be read off it (it stays inside
    /// the band its wound names). Nil for a hero, and from older servers.
    var fill: Double? = nil
    /// A foe's vigor, 6 (unhurt) down to 0: what servers before the fuzzy gauge sent instead of `fill`.
    var vigor: Int? = nil
    /// Where it stands in the fight: "engaged" (in melee), "near" (about 30 ft) or "far" (about 60 ft).
    /// Nil from a server without range bands.
    var position: String? = nil
    /// The ids it is in melee with; empty unless engaged.
    var engagedWith: [String] = []
    /// The square it stands on. Nil when the server has no tactical map, or this combatant is not placed.
    var square: GridPoint? = nil
    /// Feet this hero can move this turn. Nil for a foe, and from a server from before the grid.
    var speedFeet: Int? = nil

    /// What its health reads: a foe's wound, or hit points ("7/20").
    var healthText: String { wound ?? "\(hp)/\(maxHp)" }
    /// The same, spoken.
    var healthSpoken: String { wound ?? "\(hp) of \(maxHp) hit points" }
    /// The bar's fill, 0 to 1: a foe's fuzzy fill (or, from an older server, its vigor out of 6), or a hero's
    /// hit points.
    var gauge: Double {
        let share = fill ?? vigor.map { Double($0) / Double(Combatant.vigorRungs) } ?? (maxHp > 0 ? Double(hp) / Double(maxHp) : 0)
        return min(1, max(0, share))
    }
    /// A foe's gauge is an impression, not a count: drawn with a soft edge.
    var gaugeIsFuzzy: Bool { isFoe && (fill != nil || vigor != nil) }
    static let vigorRungs = 6

    var isFoe: Bool { side == "foes" }
    var isDead: Bool { status == "dead" }
    /// Able to take a turn.
    var isUp: Bool { status == "up" }
}

extension Combatant {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let combatantId = try c.decode(String.self, forKey: .id)
        let points = try c.whole(.hp)
        id = combatantId
        name = try c.value(.name, or: combatantId)
        side = try c.value(.side, or: "foes")
        hp = points
        maxHp = try c.whole(.maxHp, or: max(points, 1))
        status = try c.value(.status, or: points > 0 ? "up" : "dead")
        conditions = try c.value(.conditions, or: [])
        toughness = try c.decodeIfPresent(String.self, forKey: .toughness)
        wound = try c.decodeIfPresent(String.self, forKey: .wound)
        vigor = c.contains(.vigor) ? try c.whole(.vigor) : nil
        fill = (try? c.decodeIfPresent(Double.self, forKey: .fill)).flatMap { $0 }.flatMap { $0.isFinite ? $0 : nil }
        position = try c.decodeIfPresent(String.self, forKey: .position)
        engagedWith = try c.value(.engagedWith, or: [])
        square = try? c.decode(GridPoint.self, forKey: .square)
        speedFeet = try c.optionalWhole(.speedFeet)
    }
}

/// The fight in progress. A settled fight is gone (`rules.combat` is null); its end is in the results.
struct Combat: Codable, Hashable {
    /// The round the party is choosing actions for (1-based).
    let round: Int
    /// In initiative order.
    let combatants: [Combatant]
    /// "low", "moderate", "high" or "deadly": the fight against this party. Nil from an older server.
    var band: String? = nil

    func combatant(_ id: String?) -> Combatant? { combatants.first { $0.id == id } }
}

extension Combat {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        round = try c.whole(.round, or: 1)
        combatants = try c.value(.combatants, or: [])
        band = try c.decodeIfPresent(String.self, forKey: .band)
    }
}

struct DungeonExit: Codable, Hashable, Identifiable {
    let id: String
    /// "locked-door", "open-passage", "stairs"…
    let connection: String
    /// The area this leads to. Nil, or an area the party hasn't entered: unexplored.
    let to: String?
}

extension DungeonExit {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        to = try c.decodeIfPresent(String.self, forKey: .to)
        connection = try c.value(.connection, or: "open-passage")
        id = try c.value(.id, or: to ?? connection)
    }
}

struct DungeonArea: Codable, Hashable, Identifiable {
    let id: String
    /// What it is: "Grand chamber (50 x 40 ft.)".
    let name: String
    /// What it is for: "Narthex".
    let purpose: String?
    let cleared: Bool
    let exits: [DungeonExit]
}

extension DungeonArea {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.value(.name, or: "")
        purpose = try c.decodeIfPresent(String.self, forKey: .purpose)
        cleared = try c.value(.cleared, or: false)
        exits = try c.value(.exits, or: [])
    }
}

/// One kind of foe the party is facing, rated against them.
struct RatedFoe: Codable, Hashable {
    let name: String
    let count: Int
    /// "puny", "weak", "even", "strong" or "deadly".
    let toughness: String
}

/// Foes the party is facing in this room. Hostile ones bar the way: the choices are Engage, Run, Parley.
struct WaitingFoes: Codable, Hashable {
    /// "Boar ×3", "Goblin Warrior ×2, Bugbear Warrior".
    let foes: String
    /// "hostile", "indifferent" or "friendly".
    let attitude: String
    /// "low", "moderate", "high" or "deadly". Nil from a server older than toughness ratings.
    var band: String? = nil
    var monsters: [RatedFoe] = []

    var isFriendly: Bool { attitude == "friendly" }
    var isHostile: Bool { attitude == "hostile" }

    /// "Each Skeleton is weak. A moderate fight."; for one of a kind, "The Giant Rat is weak."
    var rating: String? {
        guard let band else { return nil }
        let each = monsters.map { "\($0.count > 1 ? "each" : "the") \($0.name) is \($0.toughness)" }.joined(separator: ", ")
        guard !each.isEmpty else { return "A \(band) fight." }
        return "\(each.prefix(1).uppercased())\(each.dropFirst()). A \(band) fight."
    }

    var note: String {
        if isHostile {
            return "Hostile. They have not attacked. The party can engage, run, or parley. Running leaves the room as it stands, with nothing gained."
        }
        if isFriendly {
            return "Friendly. They will not attack. A parley with them is rolled twice and the better die counts; one that fails leaves them indifferent."
        }
        return "Indifferent. They watch and wait. A parley can win the room; one that fails turns them hostile, and the party then chooses to engage, run, or parley."
    }
}

extension WaitingFoes {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        foes = try c.value(.foes, or: "")
        attitude = try c.value(.attitude, or: "indifferent")
        band = try c.decodeIfPresent(String.self, forKey: .band)
        monsters = (try? c.decodeIfPresent([RatedFoe].self, forKey: .monsters)) ?? []
    }
}

/// What the party has seen of the dungeon. There are no coordinates: the app lays the map out
/// from the exits, breadth-first from the first area.
struct DungeonMap: Codable, Hashable {
    /// "fixed" (a whole map built at the start) or "explore" (rooms rolled as doors open).
    let mode: String
    /// "Forgotten temple", "Sunken cellar"…
    let kind: String
    /// The area the party is in.
    let at: String
    /// Only areas the party has entered, in the order they were entered.
    let areas: [DungeonArea]
    /// Foes the party is facing here, with how hard they are. Nil when there are none.
    let waiting: WaitingFoes?
    /// The dungeon level the party has reached: it starts at the party's level, and a new door can
    /// lead a level deeper. Nil from a server older than dungeon levels.
    var level: Int? = nil
    /// Where the way led deeper, oldest first.
    var deepened: [Deepening] = []

    /// The level to name on screen: only once the party has gone deeper than where it began.
    var levelReached: Int? { deepened.isEmpty ? nil : level }

    var here: DungeonArea? { areas.first { $0.id == at } }
    func area(_ id: String?) -> DungeonArea? { areas.first { $0.id == id } }
}

extension DungeonMap {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        mode = try c.value(.mode, or: "fixed")
        kind = try c.value(.kind, or: "Dungeon")
        at = try c.value(.at, or: "")
        areas = try c.value(.areas, or: [])
        waiting = (try? c.decodeIfPresent(WaitingFoes.self, forKey: .waiting)).flatMap { $0 }.flatMap { $0.foes.isEmpty ? nil : $0 }
        level = try? c.decodeIfPresent(Int.self, forKey: .level)
        deepened = (try? c.decodeIfPresent([Deepening].self, forKey: .deepened)) ?? []
    }
}

/// An area where the dungeon went a level deeper (`rules.dungeon.deepened[]`).
struct Deepening: Codable, Hashable {
    let at: String
    let level: Int
}

/// A hero who levelled up at the quest's end (`rules.levelUps[]`).
struct QuestLevelUp: Codable, Hashable {
    let playerId: String
    let from: Int
    let to: Int
}

/// The adventure's clock: it starts at 8 in the morning of day 1, and every choice moves it on.
struct GameClock: Codable, Hashable {
    let seconds: Int
    /// "Day 1, 08:40".
    let label: String
}

extension GameClock {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        seconds = try c.whole(.seconds)
        label = try c.value(.label, or: "")
    }
}

/// What the party sees by where it is.
struct PartyLight: Codable, Hashable {
    /// The light the party carries lit: what it is, who holds it, and the minutes it has left.
    struct Source: Codable, Hashable {
        let name: String
        let holder: String
        let minutesLeft: Int

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            name = try c.value(.name, or: "Light")
            holder = try c.value(.holder, or: "")
            minutesLeft = try c.whole(.minutesLeft)
        }
    }

    /// "bright", "dim" or "dark": bright wherever the party's own light burns.
    let level: String
    let source: Source?
}

extension PartyLight {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        level = try c.value(.level, or: "bright")
        source = try c.decodeIfPresent(Source.self, forKey: .source)
    }
}

/// The rules engine's numbers for a game. Nil on a game from before the engine.
struct RulesView: Codable, Hashable {
    let party: [HeroStanding]
    let combat: Combat?
    let dungeon: DungeonMap?
    /// The engine's dice lines for the last resolved scene.
    let results: [String]
    /// Nil from a server older than the clock.
    let time: GameClock?
    let light: PartyLight?
    /// Who levelled up at the quest's end; empty until then.
    var levelUps: [QuestLevelUp] = []
}

extension RulesView {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        party = try c.value(.party, or: [])
        combat = try c.decodeIfPresent(Combat.self, forKey: .combat)
        dungeon = try c.decodeIfPresent(DungeonMap.self, forKey: .dungeon)
        results = try c.value(.results, or: [])
        time = try c.decodeIfPresent(GameClock.self, forKey: .time)
        light = try c.decodeIfPresent(PartyLight.self, forKey: .light)
        levelUps = (try? c.decodeIfPresent([QuestLevelUp].self, forKey: .levelUps)) ?? []
    }
}

struct ChronicleEntry: Codable, Hashable, Identifiable {
    let index: Int
    let title: String
    let imageUrl: String?
    /// The readings of that scene that were made, by narrator id.
    var voices: [String: String] = [:]
    /// The default narrator's reading; all a server from before the voice picker sends.
    var voiceUrl: String? = nil
    /// The most-voted choice. Empty for a round of a fight, where each hero acts for themselves.
    let choiceLabel: String
    let outcome: String
    /// What the heroes said and did in character that turn.
    var roleplay: [RoleplayLine] = []
    var id: Int { index }
    var imageURL: URL? { imageUrl.flatMap(URL.init(string:)) }

    func reading(by narrator: String?) -> URL? {
        (narrator.flatMap { voices[$0] } ?? (narrator == nil ? voiceUrl : nil)).flatMap(URL.init(string:))
    }
}

extension ChronicleEntry {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        index = try c.decode(Int.self, forKey: .index)
        title = try c.value(.title, or: "")
        imageUrl = try c.decodeIfPresent(String.self, forKey: .imageUrl)
        voices = try c.value(.voices, or: [:])
        voiceUrl = try c.decodeIfPresent(String.self, forKey: .voiceUrl)
        choiceLabel = try c.value(.choiceLabel, or: "")
        outcome = try c.value(.outcome, or: "")
        roleplay = try c.value(.roleplay, or: [])
    }
}

struct Message: Codable, Hashable, Identifiable {
    enum Kind: String, Codable { case chat, system, dm }

    /// The line this one answers, kept on the message so the quote survives a poll.
    struct Quote: Codable, Hashable {
        let id: Int
        let kind: Message.Kind
        let playerId: String?
        let characterName: String?
        let text: String
        var voice: String? = nil
    }

    /// `@Name` is the hero. `@player:Name` is the person who plays them.
    struct Mention: Codable, Hashable {
        let playerId: String
        let name: String
        /// "hero" or "player".
        let target: String
    }

    /// One emoji on a line. `count` matches `playerIds`. Tap again to leave it.
    struct Reaction: Codable, Hashable, Identifiable {
        let emoji: String
        let count: Int
        let playerIds: [String]
        var id: String { emoji }
    }

    let id: Int
    let kind: Kind
    let playerId: String?
    let characterName: String?
    let text: String
    let createdAt: String
    /// "in" the hero speaks, "out" the player does. Nil on system and dm lines, and on a server
    /// from before the flag: those chat lines were the hero.
    var voice: String? = nil
    var replyTo: Int? = nil
    var reply: Quote? = nil
    var mentions: [Mention] = []
    var reactions: [Reaction] = []

    var inCharacter: Bool { kind == .chat && voice != "out" }
}

extension Message {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        kind = try c.decode(Kind.self, forKey: .kind)
        playerId = try c.decodeIfPresent(String.self, forKey: .playerId)
        characterName = try c.decodeIfPresent(String.self, forKey: .characterName)
        text = try c.value(.text, or: "")
        createdAt = try c.value(.createdAt, or: "")
        voice = try c.decodeIfPresent(String.self, forKey: .voice)
        replyTo = try c.decodeIfPresent(Int.self, forKey: .replyTo)
        reply = try c.decodeIfPresent(Quote.self, forKey: .reply)
        mentions = try c.value(.mentions, or: [])
        reactions = try c.value(.reactions, or: [])
    }
}

extension Message.Quote {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        kind = try c.decode(Message.Kind.self, forKey: .kind)
        playerId = try c.decodeIfPresent(String.self, forKey: .playerId)
        characterName = try c.decodeIfPresent(String.self, forKey: .characterName)
        text = try c.value(.text, or: "")
        voice = try c.decodeIfPresent(String.self, forKey: .voice)
    }
}

/// Someone composing a line. The name is their hero's, so the table knows who.
struct TypingNotice: Codable, Hashable, Identifiable {
    let playerId: String
    let name: String
    var id: String { playerId }
}

struct GameState: Codable, Hashable {
    let code: String
    let hostId: String
    let status: GameStatus
    let dungeonMaster: String
    let title: String?
    /// Scenes planned, finale included. Grows by one for each round of a fight.
    let sceneCount: Int
    let players: [GamePlayer]
    let scene: GameScene?
    var chronicle: [ChronicleEntry]?
    let messages: [Message]
    /// Lines already in the log whose reactions changed. Empty on a server from before reactions.
    var messageUpdates: [Message] = []
    /// Heroes whose players are writing, other than the caller.
    var typing: [TypingNotice] = []
    /// The rules engine's numbers; nil for a game from before it, and on a server without one.
    let rules: RulesView?
    let updatedAt: String

    func player(_ id: String?) -> GamePlayer? { players.first { $0.playerId == id } }
    /// How a hero stands in the rules engine's party.
    func standing(_ id: String?) -> HeroStanding? { rules?.party.first { $0.playerId == id } }
}

extension GameState {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        code = try c.decode(String.self, forKey: .code)
        hostId = try c.decode(String.self, forKey: .hostId)
        status = try c.decode(GameStatus.self, forKey: .status)
        dungeonMaster = try c.decode(String.self, forKey: .dungeonMaster)
        title = try c.decodeIfPresent(String.self, forKey: .title)
        sceneCount = try c.whole(.sceneCount)
        players = try c.decode([GamePlayer].self, forKey: .players)
        scene = try c.decodeIfPresent(GameScene.self, forKey: .scene)
        chronicle = try c.decodeIfPresent([ChronicleEntry].self, forKey: .chronicle)
        messages = try c.value(.messages, or: [])
        messageUpdates = try c.value(.messageUpdates, or: [])
        typing = try c.value(.typing, or: [])
        rules = try c.decodeIfPresent(RulesView.self, forKey: .rules)
        updatedAt = try c.value(.updatedAt, or: "")
    }
}

struct PortraitResult: Codable {
    let appearance: String
    let portraitUrl: String
}
