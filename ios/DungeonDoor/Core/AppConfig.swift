import SwiftUI

/// Where the server is and who this device plays as.
///
/// Launch arguments (handy from run.sh): `-apiBase http://localhost:3000` points at a local dev
/// server, `-openGame ABCDEF` drops straight into a game (an ended one too, to see its finale),
/// `-playerId <uuid>` plays as someone else.
///
/// For screenshot checks, all inert unless passed:
/// - `-openHeroNamed <name>` opens the hero page of the first hero with that name.
/// - `-forgeStep <identity|calling|sheet|story|portrait>` opens the forge at that step, on a new
///   hero, or with `-forgeHeroNamed <name>` reforging that one.
/// - `-forgeNew <name:race:class>` (catalog ids, e.g. `Pip:halfling:rogue`) starts that new hero
///   with those three filled in, so `-forgeStep sheet` shows the step as a new player reaches it.
/// - `-forgeBackground <id>` picks that background as the forge opens (a catalog backgrounds id),
///   so the Sheet step shows the preview the server draws up for it.
/// - `-showMap YES` presents the dungeon map as soon as an open game has one.
/// - `-lobbyAdventure <none|fixed|explore>` preselects that kind of game in the lobby (a catalog
///   dungeons id).
/// - `-sheetTab <abilities|combat|spells|gear|story>` opens every hero sheet on that tab.
/// - `-sheetRule <name>` opens the rules text of the first spell, class feature, feat, species
///   trait or skill on a hero sheet whose name contains that text ("second wind", "burning").
/// - `-openMySheet YES` presents the caller's own hero sheet as soon as a game is open;
///   `-openSheetOf <name>` presents the sheet of the party's hero with that name instead.
/// - `-showChronicle YES` presents the story so far as soon as an open game has one.
/// - `-newGame YES` opens the "A New Adventure" sheet (the hero picker) from the home screen.
/// - `-scrollTo <choices|combat|bottom>` scrolls an open scene down to its choices, its fight or
///   its end; on a hero page or the forge's Sheet step, `-scrollTo bottom` scrolls to the end.
/// - `-dd.pushOn NO` starts with the player's notification switch off, so iOS is not asked for leave.
/// - `-pushOpen <kind>:<CODE>` acts as if a notification of that kind ("turn", "combat", "chat",
///   "invite") about that game had been tapped.
/// - `-dd.narrateScenes YES` has the narrator read each scene as it arrives (the "Every scene"
///   switch on a scene), without a tap.
///
/// For the home-screen dragon, in debug builds only:
/// - `-dragonAutoPoke <n>` pokes him n times once he has landed, `-dragonPokeEvery <seconds>` apart
///   (9 unless given).
/// - `-dragonAct <list>` scripts what he does on each poke in turn, comma-separated and repeating:
///   `speak`, `ponder`, `skygaze`, `fire`, `roar`, `yawn`, `smoke`, `flight`, or `flight-helm`,
///   `flight-chest`, `flight-orb` to choose what he brings back. Without it he follows his own
///   rotation.
/// - `-dragonAway <seconds>` fixes how long he stays away on a flight (otherwise 6 to 16 s).
enum AppConfig {
    static var apiBase: URL {
        let defaults = UserDefaults.standard
        if let override = defaults.string(forKey: "apiBase"), let url = URL(string: override) { return url }
        let plist = Bundle.main.object(forInfoDictionaryKey: "DDAPIBase") as? String
        return URL(string: plist ?? "") ?? URL(string: "https://the-dungeon-door.vercel.app")!
    }

    static var appKey: String? {
        (Bundle.main.object(forInfoDictionaryKey: "DDAppKey") as? String).flatMap { $0.isEmpty ? nil : $0 }
    }

    /// A random id made on first launch. There's no sign-in in the MVP.
    static var playerId: String {
        let defaults = UserDefaults.standard
        if let forced = defaults.string(forKey: "playerId"), !forced.isEmpty { return forced }
        if let saved = defaults.string(forKey: "dd.playerId") { return saved }
        let fresh = UUID().uuidString.lowercased()
        defaults.set(fresh, forKey: "dd.playerId")
        return fresh
    }

    static var openGameArgument: String? {
        UserDefaults.standard.string(forKey: "openGame")?.uppercased()
    }

    // MARK: Debug launch arguments

    static var openHeroArgument: String? { argument("openHeroNamed") }
    static var forgeStepArgument: String? { argument("forgeStep")?.lowercased() }
    static var forgeHeroArgument: String? { argument("forgeHeroNamed") }
    static var forgeBackgroundArgument: String? { argument("forgeBackground")?.lowercased() }

    /// The new hero `-forgeNew name:race:class` describes, if it was passed.
    static var forgeNewArgument: Character? {
        guard let parts = argument("forgeNew")?.split(separator: ":").map(String.init), parts.count == 3 else { return nil }
        var hero = Character.blank(ownerId: playerId)
        hero.name = parts[0]
        hero.race = parts[1].lowercased()
        hero.characterClass = parts[2].lowercased()
        return hero
    }
    static var lobbyAdventureArgument: String? { argument("lobbyAdventure") }
    static var showMapArgument: Bool { UserDefaults.standard.bool(forKey: "showMap") }
    static var sheetTabArgument: String? { argument("sheetTab")?.lowercased() }
    static var sheetRuleArgument: String? { argument("sheetRule") }
    static var openMySheetArgument: Bool { UserDefaults.standard.bool(forKey: "openMySheet") }
    static var openSheetOfArgument: String? { argument("openSheetOf") }
    static var showChronicleArgument: Bool { UserDefaults.standard.bool(forKey: "showChronicle") }
    static var newGameArgument: Bool { UserDefaults.standard.bool(forKey: "newGame") }
    static var scrollToArgument: String? { argument("scrollTo")?.lowercased() }
    static var pushOpenArgument: PushNews? { argument("pushOpen").flatMap(PushNews.init(argument:)) }
    /// Where a page's scroll view starts: the top, unless `-scrollTo bottom` asks for the end.
    static var launchScrollAnchor: UnitPoint { scrollToArgument == "bottom" ? .bottom : .top }

    static var dragonAutoPokeArgument: Int { UserDefaults.standard.integer(forKey: "dragonAutoPoke") }
    static var dragonPokeEveryArgument: Double? { seconds("dragonPokeEvery") }
    static var dragonActArgument: String? { argument("dragonAct")?.lowercased() }
    static var dragonAwayArgument: Double? { seconds("dragonAway") }

    private static func argument(_ key: String) -> String? {
        let value = UserDefaults.standard.string(forKey: key)?.trimmingCharacters(in: .whitespaces)
        return value.flatMap { $0.isEmpty ? nil : $0 }
    }

    private static func seconds(_ key: String) -> Double? {
        let value = UserDefaults.standard.double(forKey: key)
        return value > 0 ? value : nil
    }
}
