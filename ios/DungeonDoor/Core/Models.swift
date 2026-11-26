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
    /// Added to the d20 to hit; 0 for a spell the target saves against.
    var bonus: Int
    /// "2d6+3 slashing".
    var damage: String
    var ranged: Bool
    /// "weapon" or "spell".
    var kind: String
    /// Spells only: the save the target makes instead ("dex"), against the hero's spell save DC.
    var save: String?

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
    var createdAt: String
    var updatedAt: String

    static func blank(ownerId: String) -> Character {
        let now = ISO8601DateFormatter().string(from: .now)
        return Character(
            id: UUID().uuidString.lowercased(), ownerId: ownerId, name: "",
            race: "", characterClass: "", gender: "", temperament: "", alignment: "",
            backstory: "", description: "", appearance: nil, portraitUrl: nil,
            sheet: nil, attacks: nil, createdAt: now, updatedAt: now)
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

    init(_ hero: Character, backgroundId: String? = nil) {
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
    /// "a", "b" or "c". In a fight: Attack, Cast, Dodge.
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
}

struct GameScene: Codable, Hashable {
    let index: Int
    let title: String
    let narration: String
    let imageUrl: String?
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

    var imageURL: URL? { imageUrl.flatMap(URL.init(string:)) }
}

extension GameScene {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        index = try c.decode(Int.self, forKey: .index)
        title = try c.value(.title, or: "")
        narration = try c.value(.narration, or: "")
        imageUrl = try c.decodeIfPresent(String.self, forKey: .imageUrl)
        choices = try c.value(.choices, or: [])
        combat = try c.value(.combat, or: false)
        canAct = try c.value(.canAct, or: true)
        isFinale = try c.value(.isFinale, or: false)
        votes = try c.value(.votes, or: [])
        myVote = try c.decodeIfPresent(String.self, forKey: .myVote)
        outcome = try c.decodeIfPresent(String.self, forKey: .outcome)
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

    var id: String { playerId }
    var isUp: Bool { !down && !dead }
    var cannotSee: Bool { sight == "none" }
    var seesDimly: Bool { sight == "dim" }

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
        gp = try c.value(.gp, or: 0)
        inventory = try c.value(.inventory, or: [])
        carried = try c.value(.carried, or: 0)
        capacity = try c.value(.capacity, or: 0)
        dragLimit = try c.value(.dragLimit, or: 0)
        dragging = try c.value(.dragging, or: false)
        sight = try c.value(.sight, or: "clear")
        darkvision = try c.whole(.darkvision)
        resistances = try c.value(.resistances, or: [])
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
    }
}

/// The fight in progress. A settled fight is gone (`rules.combat` is null); its end is in the results.
struct Combat: Codable, Hashable {
    /// The round the party is choosing actions for (1-based).
    let round: Int
    /// In initiative order.
    let combatants: [Combatant]

    func combatant(_ id: String?) -> Combatant? { combatants.first { $0.id == id } }
}

extension Combat {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        round = try c.whole(.round, or: 1)
        combatants = try c.value(.combatants, or: [])
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

/// Foes in the party's room who did not attack: a Parley choice talks to them.
struct WaitingFoes: Codable, Hashable {
    /// "Boar ×3", "Goblin Warrior ×2, Bugbear Warrior".
    let foes: String
    /// "indifferent" or "friendly".
    let attitude: String

    var isFriendly: Bool { attitude == "friendly" }
}

extension WaitingFoes {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        foes = try c.value(.foes, or: "")
        attitude = try c.value(.attitude, or: "indifferent")
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
    /// Foes in this area who are watching, not attacking. Nil when there are none.
    let waiting: WaitingFoes?

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
    }
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
    }
}

struct ChronicleEntry: Codable, Hashable, Identifiable {
    let index: Int
    let title: String
    let imageUrl: String?
    /// The most-voted choice. Empty for a round of a fight, where each hero acts for themselves.
    let choiceLabel: String
    let outcome: String
    var id: Int { index }
    var imageURL: URL? { imageUrl.flatMap(URL.init(string:)) }
}

extension ChronicleEntry {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        index = try c.decode(Int.self, forKey: .index)
        title = try c.value(.title, or: "")
        imageUrl = try c.decodeIfPresent(String.self, forKey: .imageUrl)
        choiceLabel = try c.value(.choiceLabel, or: "")
        outcome = try c.value(.outcome, or: "")
    }
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
    /// Scenes planned, finale included. Grows by one for each round of a fight.
    let sceneCount: Int
    let players: [GamePlayer]
    let scene: GameScene?
    var chronicle: [ChronicleEntry]?
    let messages: [Message]
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
        rules = try c.decodeIfPresent(RulesView.self, forKey: .rules)
        updatedAt = try c.value(.updatedAt, or: "")
    }
}

struct PortraitResult: Codable {
    let appearance: String
    let portraitUrl: String
}
