#if DEBUG
import SwiftUI

/// Local-only screenshot harness. Driven by `-ddDemo <screen>`. Do not push this work.
enum DemoLaunch {
    enum Screen: String {
        case story
        case storyCombat = "story-combat"
        case storyOffers = "story-offers"
        case storyCombatOffers = "story-combat-offers"
        case sheetAbilities = "sheet-abilities"
        case sheetSaves = "sheet-saves"
        case sheetAttacks = "sheet-attacks"
        case sheetSpells = "sheet-spells"
        case sheetItems = "sheet-items"
        case sheetFeatures = "sheet-features"
        case map
        case mapTarget = "map-target"
        case chat

        var tab: ProtoTab {
            switch self {
            case .story, .storyCombat, .storyOffers, .storyCombatOffers: .story
            case .map, .mapTarget: .map
            case .chat: .chat
            default: .sheet
            }
        }

        var sheetPane: ProtoSheetPane {
            switch self {
            case .sheetSaves: .saves
            case .sheetAttacks: .attacks
            case .sheetSpells: .spells
            case .sheetItems: .items
            case .sheetFeatures: .features
            default: .abilities
            }
        }

        var usesCombat: Bool {
            switch self {
            case .storyCombat, .storyCombatOffers, .map, .mapTarget, .sheetAttacks: true
            default: false
            }
        }
    }

    static var screen: Screen? {
        UserDefaults.standard.string(forKey: "ddDemo").flatMap(Screen.init(rawValue:))
    }
}

@MainActor
struct DemoRoot: View {
    @Bindable var model: AppModel
    @State private var session: GameSession

    init(model: AppModel) {
        self.model = model
        let screen = DemoLaunch.screen ?? .story
        model.freezeForDemo(catalog: DemoData.catalog, characters: DemoData.roster)
        let session = DemoData.session(for: screen, api: model.api)
        _session = State(initialValue: session)
    }

    var body: some View {
        let screen = DemoLaunch.screen ?? .story
        ProtoPlayShell(session: session,
                       tab: screen.tab,
                       sheetPane: screen.sheetPane,
                       preselectedTarget: screen == .mapTarget ? "foe-2" : nil)
            .environment(model)
    }
}


@MainActor
enum DemoData {
    static let miraId = "player-mira"
    static let brynId = "player-bryn"
    static let pipId = "player-pip"
    static let now = "2026-11-26T18:05:00Z"

    static var sceneImageURL: URL? { Bundle.main.url(forResource: "demo-scene", withExtension: "jpg") }
    static var miraPortrait: String? { Bundle.main.url(forResource: "demo-mira", withExtension: "jpg")?.absoluteString }
    static var brynPortrait: String? { Bundle.main.url(forResource: "demo-bryn", withExtension: "jpg")?.absoluteString }
    static var pipPortrait: String? { Bundle.main.url(forResource: "demo-pip", withExtension: "jpg")?.absoluteString }
    static var sceneImage: String? { sceneImageURL?.absoluteString }

    static var catalog: Catalog {
        Catalog(
            races: opts([
                ("human", "Human", "Short-lived and restless, found in every tavern and royal court."),
                ("elf", "Elf", "Graceful and long-remembering, slow to trust and slower to forget."),
                ("dwarf", "Dwarf", "Stone-stubborn, ale-proud and as tough as the mountains they carve."),
                ("halfling", "Halfling", "Small, quick and uncannily lucky — and somehow they survive both."),
                ("gnome", "Gnome", "Bright-eyed tinkerers who treat the world as a fascinating puzzle."),
                ("goliath", "Goliath", "Towering mountain-born wanderers who never back down from a climb."),
                ("orc", "Orc", "Big-hearted, hard-hitting and hard to put down."),
                ("tiefling", "Tiefling", "Horned and marked by a bargain they never made."),
                ("dragonborn", "Dragonborn", "Proud, scaled descendants of dragons, honour-bound."),
            ]),
            classes: classOpts([
                ("barbarian", "Barbarian", "bolt.fill", "A storm of muscle and fury."),
                ("bard", "Bard", "music.note", "A silver-tongued performer whose songs bend hearts."),
                ("cleric", "Cleric", "sun.max.fill", "A chosen servant of the gods."),
                ("druid", "Druid", "leaf.fill", "A keeper of the wild who wears the shapes of animals."),
                ("fighter", "Fighter", "figure.fencing", "A master of arms, always first into the breach."),
                ("monk", "Monk", "figure.martial.arts", "Fists, feet and inner calm, faster than any blade."),
                ("paladin", "Paladin", "checkmark.shield.fill", "A holy knight bound by a sacred oath."),
                ("ranger", "Ranger", "scope", "A tracker of the borderlands, deadly with a bow."),
                ("rogue", "Rogue", "eye.slash.fill", "A shadow with quick fingers and a quicker knife."),
                ("sorcerer", "Sorcerer", "sparkles", "Magic runs wild in their blood."),
                ("warlock", "Warlock", "flame.fill", "Power bought from something old and hungry."),
                ("wizard", "Wizard", "wand.and.stars", "A scholar whose spellbook holds fire, time and minds."),
            ]),
            temperaments: opts([
                ("brave", "Brave", "Steps forward when everyone else steps back."),
                ("cunning", "Cunning", "Always three moves ahead."),
                ("kind", "Kind", "Leads with an open hand, even when it costs."),
                ("brooding", "Brooding", "Carries a dark past and a darker cloak."),
                ("reckless", "Reckless", "Acts first, plans never, regrets occasionally."),
                ("scholarly", "Scholarly", "Has read about this. Has written footnotes about this."),
                ("jovial", "Jovial", "The loudest laugh in the tavern."),
                ("stoic", "Stoic", "Says little, endures much, and never flinches."),
            ]),
            genders: [
                CatalogOption(id: "female", name: "Female"),
                CatalogOption(id: "male", name: "Male"),
                CatalogOption(id: "nonbinary", name: "Nonbinary"),
            ],
            alignments: [
                CatalogOption(id: "lawful-good", name: "Lawful Good"),
                CatalogOption(id: "neutral-good", name: "Neutral Good"),
                CatalogOption(id: "chaotic-good", name: "Chaotic Good"),
                CatalogOption(id: "lawful-neutral", name: "Lawful Neutral"),
                CatalogOption(id: "true-neutral", name: "True Neutral"),
                CatalogOption(id: "chaotic-neutral", name: "Chaotic Neutral"),
            ],
            backgrounds: [
                CatalogOption(id: "acolyte", name: "Acolyte", blurb: "Raised in a temple among rites and old books.", abilities: ["int", "wis", "cha"]),
                CatalogOption(id: "criminal", name: "Criminal", blurb: "You know the streets, the locks, and when to vanish.", abilities: ["dex", "con", "int"]),
                CatalogOption(id: "sage", name: "Sage", blurb: "You have spent a life among stacks of books and half-forgotten languages.", abilities: ["con", "int", "wis"]),
                CatalogOption(id: "soldier", name: "Soldier", blurb: "Trained for war and tested in it.", abilities: ["str", "dex", "con"]),
            ],
            dungeons: [
                CatalogOption(id: "none", name: "A tale told", blurb: "The dungeon master spins a short adventure, scene by scene.", symbol: "book.pages.fill"),
                CatalogOption(id: "fixed", name: "Delve a dungeon", blurb: "A mapped dungeon of rooms and doors, with monsters, traps and treasure behind them.", symbol: "map.fill"),
                CatalogOption(id: "explore", name: "Explore the deep", blurb: "A dungeon that grows where you go: each door opens on a room nobody has seen.", symbol: "flashlight.on.fill"),
            ],
            dungeonMasters: [
                DungeonMasterInfo(id: "chronicler", name: "The Chronicler", tagline: "A classic tale of heroes, told true.", description: "An old keeper of histories who runs a fair, sweeping high-fantasy adventure.", symbol: "book.closed", accent: "#C9A227"),
                DungeonMasterInfo(id: "trickster", name: "The Trickster", tagline: "Nothing is what it seems. Especially the door.", description: "A grinning fey spirit who thinks the rules are more of a suggestion.", symbol: "wand.and.rays", accent: "#7BC96F"),
                DungeonMasterInfo(id: "grim-warden", name: "The Grim Warden", tagline: "Few return. Fewer return unchanged.", description: "A stern warden of the deep, who never softens a blow the dice have earned.", symbol: "moon.stars", accent: "#8B1E2D"),
                DungeonMasterInfo(id: "bard", name: "The Bard", tagline: "Swords, songs and spectacular entrances!", description: "A flamboyant storyteller who wants every scene to end with a flourish.", symbol: "theatermasks.fill", accent: "#E0662F"),
            ],
            narrators: [
                NarratorInfo(id: "hearth", name: "Hearth", description: "A warm, unhurried baritone, like a tale by the fire."),
                NarratorInfo(id: "night", name: "Night Watch", description: "Low and close, as if spoken just over your shoulder."),
            ],
            defaultNarrator: "hearth",
            push: false
        )
    }

    /// Heroes on the player's home roster (Mira, plus a second unused sheet).
    static var roster: [Character] { [mira, rowan] }

    static var forgeDraft: Character {
        var hero = Character.blank(ownerId: miraId)
        hero.name = "Mira Thal"
        hero.gender = "female"
        hero.race = "elf"
        hero.characterClass = "wizard"
        hero.temperament = "scholarly"
        hero.alignment = "neutral-good"
        return hero
    }

    static func session(for screen: DemoLaunch.Screen, api: APIClient) -> GameSession {
        let chosen: GameState = {
            switch screen {
            case .story: return playState
            case .storyCombat, .storyCombatOffers, .map, .mapTarget, .sheetAttacks: return combatState
            default: return playState
            }
        }()
        let session = GameSession(api: api, playerId: miraId, initial: chosen)
        if screen == .chat {
            session.chatOpen = true
            session.speakingInCharacter = true
        }
        return session
    }

    // MARK: Heroes

    static var mira: Character {
        hero(id: "char-mira", owner: miraId, name: "Mira Thal", race: "elf", classId: "wizard",
             gender: "female", temperament: "scholarly", alignment: "neutral-good",
             backstory: "A junior archivist from the river college, chasing a footnote that should not exist.",
             description: "Quiet until the subject is old magic, then impossible to stop.",
             appearance: "An elf in travel-worn indigo, ink on her fingers and a staff that hiccups when it is nervous.",
             portrait: miraPortrait, sheet: miraSheet, attacks: miraAttacks)
    }

    static var bryn: Character {
        hero(id: "char-bryn", owner: brynId, name: "Bryn Stonehand", race: "dwarf", classId: "fighter",
             gender: "male", temperament: "stoic", alignment: "lawful-good",
             backstory: "A shield-bearer who took a contract he now intends to finish properly.",
             description: "Says little, stands in doorways, and keeps count of every ration.",
             appearance: "A broad dwarf in scored mail, with a braided beard the colour of rusted iron.",
             portrait: brynPortrait, sheet: brynSheet, attacks: brynAttacks)
    }

    static var pip: Character {
        hero(id: "char-pip", owner: pipId, name: "Pip Underbough", race: "halfling", classId: "rogue",
             gender: "nonbinary", temperament: "jovial", alignment: "chaotic-good",
             backstory: "A lockpicker who swears this is the last temple job. It is not.",
             description: "Grins at danger and talks to doors as if they might answer.",
             appearance: "A small figure in a green cloak, with a feather in their cap and very quiet boots.",
             portrait: pipPortrait, sheet: pipSheet, attacks: pipAttacks)
    }

    static var rowan: Character {
        hero(id: "char-rowan", owner: miraId, name: "Rowan Keel", race: "human", classId: "ranger",
             gender: "male", temperament: "kind", alignment: "neutral-good",
             backstory: "A river guide between jobs, waiting for the next door to open.",
             description: "Easy company, better in the woods than in a city.",
             appearance: "Weathered cloak, a well-kept bow, and a patient face.",
             portrait: nil, sheet: rowanSheet, attacks: [
                Attack(name: "Longbow", bonus: 5, damage: "1d8+3 piercing", ranged: true, kind: "weapon"),
                Attack(name: "Shortsword", bonus: 5, damage: "1d6+3 piercing", ranged: false, kind: "weapon"),
             ])
    }

    static var miraSheet: CharacterSheet {
        sheet(name: "Mira Thal", level: 2, xp: 450, classId: "wizard", species: "elf", background: "sage",
              speed: 30, scores: AbilityScores(str: 8, dex: 14, con: 13, int: 17, wis: 12, cha: 10),
              proficiency: 2, maxHp: 12, hp: 12, ac: 12, saves: ["int", "wis"],
              skills: ["arcana", "history", "investigation", "insight"],
              perception: 13,
              equipment: [
                EquipmentItem(id: "quarterstaff", name: "Quarterstaff", count: 1),
                EquipmentItem(id: "component-pouch", name: "Component Pouch", count: 1),
                EquipmentItem(id: "spellbook", name: "Spellbook", count: 1),
                EquipmentItem(id: "torch", name: "Torch", count: 3),
              ],
              gp: 18, traits: ["darkvision", "keen-senses"], feat: "Magic Initiate",
              features: ["Spellcasting", "Ritual Adept", "Arcane Recovery"],
              spells: Spellcasting(ability: "int", saveDc: 13, attackBonus: 5,
                                   slots: [3, 0, 0, 0, 0, 0, 0, 0, 0], expended: [1, 0, 0, 0, 0, 0, 0, 0, 0],
                                   cantrips: ["Fire Bolt", "Mage Hand", "Light"],
                                   prepared: ["Magic Missile", "Shield", "Detect Magic", "Mage Armor"],
                                   concentratingOn: nil))
    }

    static var brynSheet: CharacterSheet {
        sheet(name: "Bryn Stonehand", level: 2, xp: 450, classId: "fighter", species: "dwarf", background: "soldier",
              speed: 30, scores: AbilityScores(str: 16, dex: 12, con: 15, int: 8, wis: 13, cha: 10),
              proficiency: 2, maxHp: 20, hp: 16, ac: 16, saves: ["str", "con"],
              skills: ["athletics", "intimidation", "perception", "survival"],
              perception: 13,
              equipment: [
                EquipmentItem(id: "longsword", name: "Longsword", count: 1),
                EquipmentItem(id: "shield", name: "Shield", count: 1),
                EquipmentItem(id: "chain-mail", name: "Chain Mail", count: 1),
                EquipmentItem(id: "healers-kit", name: "Healer's Kit", count: 1),
              ],
              gp: 12, traits: ["darkvision", "dwarven-resilience"], feat: "Savage Attacker",
              features: ["Fighting Style: Defense", "Second Wind", "Action Surge"],
              spells: nil)
    }

    static var pipSheet: CharacterSheet {
        sheet(name: "Pip Underbough", level: 2, xp: 450, classId: "rogue", species: "halfling", background: "criminal",
              speed: 30, scores: AbilityScores(str: 8, dex: 17, con: 12, int: 13, wis: 10, cha: 14),
              proficiency: 2, maxHp: 15, hp: 15, ac: 14, saves: ["dex", "int"],
              skills: ["stealth", "sleight-of-hand", "acrobatics", "persuasion", "investigation"],
              perception: 10,
              equipment: [
                EquipmentItem(id: "shortsword", name: "Shortsword", count: 1),
                EquipmentItem(id: "shortbow", name: "Shortbow", count: 1),
                EquipmentItem(id: "thieves-tools", name: "Thieves' Tools", count: 1),
                EquipmentItem(id: "potion-of-healing", name: "Potion of Healing", count: 1),
              ],
              gp: 24, traits: ["lucky", "brave", "nimble"], feat: "Alert",
              features: ["Expertise", "Sneak Attack", "Cunning Action"],
              spells: nil)
    }

    static var rowanSheet: CharacterSheet {
        sheet(name: "Rowan Keel", level: 1, xp: 0, classId: "ranger", species: "human", background: "soldier",
              speed: 30, scores: AbilityScores(str: 12, dex: 15, con: 13, int: 10, wis: 14, cha: 11),
              proficiency: 2, maxHp: 11, hp: 11, ac: 14, saves: ["str", "dex"],
              skills: ["animal-handling", "perception", "survival", "athletics"],
              perception: 14,
              equipment: [
                EquipmentItem(id: "longbow", name: "Longbow", count: 1),
                EquipmentItem(id: "shortsword", name: "Shortsword", count: 1),
              ],
              gp: 8, traits: [], feat: "Savage Attacker",
              features: ["Spellcasting", "Favored Enemy"],
              spells: nil)
    }

    static var miraAttacks: [Attack] {
        [
            Attack(name: "Fire Bolt", bonus: 5, damage: "1d10 fire", ranged: true, kind: "spell"),
            Attack(name: "Quarterstaff", bonus: 1, damage: "1d6-1 bludgeoning", ranged: false, kind: "weapon"),
        ]
    }

    static var brynAttacks: [Attack] {
        [Attack(name: "Longsword", bonus: 5, damage: "1d8+3 slashing", ranged: false, kind: "weapon")]
    }

    static var pipAttacks: [Attack] {
        [
            Attack(name: "Shortbow", bonus: 5, damage: "1d6+3 piercing", ranged: true, kind: "weapon"),
            Attack(name: "Shortsword", bonus: 5, damage: "1d6+3 piercing", ranged: false, kind: "weapon"),
        ]
    }

    // MARK: Game states

    static var players: [GamePlayer] {
        [
            GamePlayer(playerId: miraId, character: mira, isHost: true, joinedAt: "2026-11-26T17:40:00Z"),
            GamePlayer(playerId: brynId, character: bryn, isHost: false, joinedAt: "2026-11-26T17:41:00Z"),
            GamePlayer(playerId: pipId, character: pip, isHost: false, joinedAt: "2026-11-26T17:42:00Z"),
        ]
    }

    static var lobbyState: GameState {
        GameState(
            code: "DEMO01", hostId: miraId, status: .lobby, dungeonMaster: "chronicler",
            title: "Door DEMO01", sceneCount: 0, players: players, scene: nil, chronicle: nil,
            messages: Array(chatLog.prefix(3)), typing: [], rules: nil, updatedAt: now)
    }

    static var playState: GameState {
        GameState(
            code: "DEMO01", hostId: miraId, status: .voting, dungeonMaster: "chronicler",
            title: "The Forgotten Temple", sceneCount: 6, players: players,
            scene: explorationScene, chronicle: chronicle, messages: chatLog,
            typing: [TypingNotice(playerId: brynId, name: "Bryn Stonehand")],
            rules: RulesView(party: party(miraHp: 12, brynHp: 16, pipHp: 15), combat: nil, dungeon: dungeon(waiting: true),
                             results: ["Mira, Investigation 14 vs DC 13: success.",
                                       "The altar's dust hides a hairline seam."],
                             time: GameClock(seconds: 4800, label: "Day 1, 09:20"),
                             light: PartyLight(level: "bright", source: .init(name: "Torch", holder: "Bryn Stonehand", minutesLeft: 38))),
            updatedAt: now)
    }

    static var combatState: GameState {
        GameState(
            code: "DEMO01", hostId: miraId, status: .voting, dungeonMaster: "chronicler",
            title: "The Forgotten Temple", sceneCount: 7, players: players,
            scene: combatScene, chronicle: chronicle, messages: chatLog, typing: [],
            rules: RulesView(party: party(miraHp: 9, brynHp: 14, pipHp: 15), combat: combat, dungeon: dungeon(waiting: false),
                             results: ["Round 1.",
                                       "Bryn hits Goblin Warrior for 8 slashing.",
                                       "Mira's Fire Bolt misses Goblin Archer.",
                                       "Pip hides behind the pillar.",
                                       "Goblin Warrior hits Bryn for 4 piercing.",
                                       "Goblin Archer hits Mira for 3 piercing."],
                             time: GameClock(seconds: 4860, label: "Day 1, 09:21"),
                             light: PartyLight(level: "bright", source: .init(name: "Torch", holder: "Bryn Stonehand", minutesLeft: 37))),
            updatedAt: now)
    }

    static var explorationScene: GameScene {
        GameScene(
            index: 2, title: "The Grand Chamber Holds Its Breath",
            narration: "The inner doors open on a hall of cracked pillars and a floor of dull mosaic. Two goblin sentries freeze at the far end, blades half-drawn. A third shape waits on a gallery above, a shortbow already in hand. The air smells of wet stone and old incense. Nobody has moved. Yet.",
            imageUrl: sceneImage,
            choices: [
                Choice(id: "a", label: "Engage", detail: "Draw steel and close the distance before they set themselves.", rules: "Fight: 2 Goblin Warriors, 1 Goblin Archer"),
                Choice(id: "b", label: "Parley", detail: "Step forward with empty hands and try a careful word.", rules: "Persuasion check, DC 13"),
                Choice(id: "c", label: "Run", detail: "Fall back through the doors and bar them if you can.", rules: "Leave the room as it stands"),
            ],
            combat: false, canAct: true, isFinale: false,
            votes: [
                Vote(playerId: brynId, choiceId: "a", roll: 11, label: "Engage"),
            ],
            myVote: nil, outcome: nil,
            roleplay: [
                RoleplayLine(playerId: pipId, characterName: "Pip Underbough", text: "I'll check the door."),
            ])
    }

    static var combatScene: GameScene {
        GameScene(
            index: 3, title: "Steel in the Grand Chamber",
            narration: "The goblins do not wait to be asked. One rushes Bryn with a rusty scimitar; another looses an arrow from the gallery that glances off Mira's sleeve and burns. Pip has already slipped behind a pillar. It is your turn to answer.",
            imageUrl: sceneImage,
            choices: [
                Choice(id: "a", label: "Attack", detail: "Fire Bolt or a staff against a foe you can reach."),
                Choice(id: "b", label: "Cast Fire Bolt", detail: "A mote of flame, 120 feet, 1d10 fire."),
                Choice(id: "c", label: "Dodge", detail: "Focus on not being hit until the others close in."),
            ],
            combat: true, canAct: true, isFinale: false,
            votes: [
                Vote(playerId: brynId, choiceId: "a", roll: 17, label: "Attack"),
                Vote(playerId: pipId, choiceId: "c", roll: 8, label: "Dodge"),
            ],
            myVote: nil, outcome: nil)
    }

    static var combat: Combat {
        Combat(round: 2, combatants: [
            Combatant(id: "foe-1", name: "Goblin Warrior", side: "foes", hp: 0, maxHp: 0, status: "up",
                      conditions: [], toughness: "weak", wound: "Bloodied", vigor: 3,
                      position: "engaged", engagedWith: [brynId]),
            Combatant(id: miraId, name: "Mira Thal", side: "party", hp: 9, maxHp: 12, status: "up", conditions: [],
                      position: "near"),
            Combatant(id: "foe-2", name: "Goblin Archer", side: "foes", hp: 0, maxHp: 0, status: "up",
                      conditions: [], toughness: "even", wound: "Barely hurt", vigor: 5,
                      position: "far"),
            Combatant(id: brynId, name: "Bryn Stonehand", side: "party", hp: 14, maxHp: 20, status: "up", conditions: [],
                      position: "engaged", engagedWith: ["foe-1"]),
            Combatant(id: "foe-3", name: "Goblin Warrior", side: "foes", hp: 0, maxHp: 0, status: "up",
                      conditions: [], toughness: "weak", wound: "Unhurt", vigor: 6,
                      position: "near"),
            Combatant(id: pipId, name: "Pip Underbough", side: "party", hp: 15, maxHp: 15, status: "up", conditions: [],
                      position: "near"),
        ], band: "moderate")
    }

    static func dungeon(waiting: Bool) -> DungeonMap {
        let foes = WaitingFoes(foes: "Goblin Warrior ×2, Goblin Archer", attitude: "hostile", band: "moderate",
                               monsters: [
                                RatedFoe(name: "Goblin Warrior", count: 2, toughness: "weak"),
                                RatedFoe(name: "Goblin Archer", count: 1, toughness: "even"),
                               ])
        return DungeonMap(
            mode: "fixed", kind: "Forgotten temple", at: "a2",
            areas: [
                DungeonArea(id: "a1", name: "Long hall (40 x 20 ft.)", purpose: "Narthex", cleared: true, exits: [
                    DungeonExit(id: "a1-e", connection: "open-door", to: "a2"),
                    DungeonExit(id: "a1-s", connection: "open-passage", to: "a3"),
                ]),
                DungeonArea(id: "a2", name: "Grand chamber (50 x 40 ft.)", purpose: "Sanctum", cleared: false, exits: [
                    DungeonExit(id: "a2-w", connection: "open-door", to: "a1"),
                    DungeonExit(id: "a2-n", connection: "locked-door", to: nil),
                    DungeonExit(id: "a2-e", connection: "stairs", to: "a4"),
                ]),
                DungeonArea(id: "a3", name: "Side chapel (20 x 20 ft.)", purpose: "Vestry", cleared: true, exits: [
                    DungeonExit(id: "a3-n", connection: "open-passage", to: "a1"),
                ]),
                DungeonArea(id: "a4", name: "Descending stair (10 x 20 ft.)", purpose: "Crypt stair", cleared: false, exits: [
                    DungeonExit(id: "a4-w", connection: "stairs", to: "a2"),
                    DungeonExit(id: "a4-d", connection: "open-passage", to: nil),
                ]),
            ],
            waiting: waiting ? foes : nil,
            level: 2,
            deepened: [Deepening(at: "a4", level: 2)])
    }

    static func party(miraHp: Int, brynHp: Int, pipHp: Int) -> [HeroStanding] {
        [
            standing(miraId, "Mira Thal", 2, 450, miraHp, 12, 12, 0, slots: [2, 0, 0, 0, 0, 0, 0, 0, 0],
                     resources: [ResourceUse(id: "arcane-recovery", name: "Arcane Recovery", left: 1, max: 1)],
                     inventory: miraSheet.equipment, carried: 18, capacity: 40, drag: 80, sight: "clear", darkvision: 60,
                     resistances: [], conditions: [], concentrating: nil, gp: 18),
            standing(brynId, "Bryn Stonehand", 2, 450, brynHp, 20, 16, 0, slots: [],
                     resources: [ResourceUse(id: "second-wind", name: "Second Wind", left: 1, max: 1),
                                 ResourceUse(id: "action-surge", name: "Action Surge", left: 1, max: 1)],
                     inventory: brynSheet.equipment, carried: 62, capacity: 80, drag: 160, sight: "clear", darkvision: 60,
                     resistances: ["poison"], conditions: [], concentrating: nil, gp: 12),
            standing(pipId, "Pip Underbough", 2, 450, pipHp, 15, 14, 2, slots: [],
                     resources: [],
                     inventory: pipSheet.equipment, carried: 22, capacity: 40, drag: 80, sight: "clear", darkvision: 0,
                     resistances: [], conditions: [], concentrating: nil, gp: 24),
        ]
    }

    static var chronicle: [ChronicleEntry] {
        [
            ChronicleEntry(index: 0, title: "The Door in the Hill", imageUrl: nil,
                           choiceLabel: "Knock and wait",
                           outcome: "A dry wind answered, and the door swung inward of its own accord."),
            ChronicleEntry(index: 1, title: "The Narthex", imageUrl: sceneImage,
                           choiceLabel: "Search the altar",
                           outcome: "Mira found a hairline seam under the dust — a catch, not a decoration."),
        ]
    }

    static var chatLog: [Message] {
        [
            Message(id: 1, kind: .system, playerId: nil, characterName: nil,
                    text: "Mira opened the door. Bryn and Pip stepped through.", createdAt: "2026-11-26T17:44:00Z"),
            Message(id: 10, kind: .chat, playerId: pipId, characterName: "Pip Underbough",
                    text: "Did anyone else hear that? Like a cough, but made of stone.", createdAt: "2026-11-26T17:50:00Z",
                    voice: "in",
                    reactions: [
                        Message.Reaction(emoji: "👀", count: 2, playerIds: [miraId, brynId]),
                    ]),
            Message(id: 11, kind: .chat, playerId: brynId, characterName: "Bryn Stonehand",
                    text: "Hang on — school pickup in ten. I'll be right back.", createdAt: "2026-11-26T17:51:00Z",
                    voice: "out",
                    reactions: [
                        Message.Reaction(emoji: "👍", count: 2, playerIds: [miraId, pipId]),
                    ]),
            Message(id: 12, kind: .chat, playerId: miraId, characterName: "Mira Thal",
                    text: "The stone is humming, @Pip. Stay close.", createdAt: "2026-11-26T17:52:00Z",
                    voice: "in",
                    replyTo: 10,
                    reply: Message.Quote(id: 10, kind: .chat, playerId: pipId, characterName: "Pip Underbough",
                                         text: "Did anyone else hear that? Like a cough, but made of stone.", voice: "in"),
                    mentions: [Message.Mention(playerId: pipId, name: "Pip", target: "hero")],
                    reactions: [
                        Message.Reaction(emoji: "🔥", count: 1, playerIds: [pipId]),
                    ]),
            Message(id: 13, kind: .dm, playerId: nil, characterName: nil,
                    text: "A dry rattle answers from the dark ahead, then goes still.", createdAt: "2026-11-26T17:53:00Z"),
            Message(id: 14, kind: .chat, playerId: pipId, characterName: "Pip Underbough",
                    text: "I'll check the door. If it bites me I'm blaming Mira's footnotes.", createdAt: "2026-11-26T17:54:00Z",
                    voice: "in",
                    replyTo: 12,
                    reply: Message.Quote(id: 12, kind: .chat, playerId: miraId, characterName: "Mira Thal",
                                         text: "The stone is humming, @Pip. Stay close.", voice: "in")),
            Message(id: 15, kind: .chat, playerId: miraId, characterName: "Mira Thal",
                    text: "draws her sword", createdAt: "2026-11-26T17:55:00Z",
                    voice: "in", emote: true),
            Message(id: 16, kind: .chat, playerId: brynId, characterName: "Bryn Stonehand",
                    text: "The left passage is trapped.", createdAt: "2026-11-26T17:56:00Z",
                    voice: "in",
                    whisperTo: [Message.Mention(playerId: miraId, name: "Mira Thal", target: "hero")]),
        ]
    }

    // MARK: Builders

    private static func opts(_ rows: [(String, String, String)]) -> [CatalogOption] {
        rows.map { CatalogOption(id: $0.0, name: $0.1, blurb: $0.2) }
    }

    private static func classOpts(_ rows: [(String, String, String, String)]) -> [CatalogOption] {
        rows.map { CatalogOption(id: $0.0, name: $0.1, blurb: $0.3, symbol: $0.2) }
    }

    private static func hero(id: String, owner: String, name: String, race: String, classId: String,
                             gender: String, temperament: String, alignment: String,
                             backstory: String, description: String, appearance: String?,
                             portrait: String?, sheet: CharacterSheet, attacks: [Attack]) -> Character {
        Character(id: id, ownerId: owner, name: name, race: race, characterClass: classId,
                  gender: gender, temperament: temperament, alignment: alignment,
                  backstory: backstory, description: description, appearance: appearance,
                  portraitUrl: portrait, sheet: sheet, attacks: attacks, bonusesOpen: nil,
                  createdAt: now, updatedAt: now)
    }

    private static func sheet(name: String, level: Int, xp: Int, classId: String, species: String, background: String,
                              speed: Int, scores: AbilityScores, proficiency: Int, maxHp: Int, hp: Int, ac: Int,
                              saves: [String], skills: [String], perception: Int, equipment: [EquipmentItem],
                              gp: Double, traits: [String], feat: String, features: [String],
                              spells: Spellcasting?) -> CharacterSheet {
        func save(_ id: String) -> Int { SRD.modifier(scores[id]) + (saves.contains(id) ? proficiency : 0) }
        return CharacterSheet(
            version: 1, name: name, level: level, xp: xp, classId: classId, speciesId: species,
            backgroundId: background, subclassId: nil, size: "medium", speed: speed,
            abilityScores: scores, abilityBoost: nil, proficiencyBonus: proficiency, maxHp: maxHp, hp: hp, armorClass: ac,
            hitDiceSpent: 0, exhaustion: 0, savingThrows: saves,
            saveBonuses: AbilityScores(str: save("str"), dex: save("dex"), con: save("con"),
                                       int: save("int"), wis: save("wis"), cha: save("cha")),
            skills: skills, skillBonuses: Self.bonuses(scores: scores, proficiency: proficiency, trained: skills),
            passivePerception: perception, otherProficiencies: [],
            equipment: equipment, gp: gp, pendingChoices: [], traits: traits, feat: feat, feats: [],
            features: features, resourcesUsed: [:], dead: false, revivalPenalty: 0, spellcasting: spells)
    }


    private static func bonuses(scores: AbilityScores, proficiency: Int, trained: [String]) -> [String: Int] {
        let skills = [
            "acrobatics", "animal-handling", "arcana", "athletics", "deception", "history",
            "insight", "intimidation", "investigation", "medicine", "nature", "perception",
            "performance", "persuasion", "religion", "sleight-of-hand", "stealth", "survival",
        ]
        var result: [String: Int] = [:]
        for id in skills {
            let ability = SRD.ability(forSkill: id) ?? "int"
            result[id] = SRD.modifier(scores[ability]) + (trained.contains(id) ? proficiency : 0)
        }
        return result
    }

    private static func standing(_ playerId: String, _ name: String, _ level: Int, _ xp: Int,
                                 _ hp: Int, _ maxHp: Int, _ ac: Int, _ hitDice: Int, slots: [Int],
                                 resources: [ResourceUse], inventory: [EquipmentItem],
                                 carried: Double, capacity: Double, drag: Double,
                                 sight: String, darkvision: Int, resistances: [String],
                                 conditions: [CarriedCondition], concentrating: String?, gp: Double) -> HeroStanding {
        HeroStanding(playerId: playerId, name: name, level: level, xp: xp, hp: hp, maxHp: maxHp,
                     armorClass: ac, exhaustion: 0, hitDiceLeft: hitDice, slotsLeft: slots, resources: resources,
                     down: hp <= 0, dead: false, passivePerception: 13, passiveInsight: 11, speed: 30,
                     gp: gp, inventory: inventory, carried: carried, capacity: capacity, dragLimit: drag,
                     dragging: carried > capacity, sight: sight, darkvision: darkvision, resistances: resistances,
                     conditions: conditions, concentratingOn: concentrating)
    }
}

extension PartyLight.Source {
    init(name: String, holder: String, minutesLeft: Int) {
        self.name = name
        self.holder = holder
        self.minutesLeft = minutesLeft
    }
}
#endif
