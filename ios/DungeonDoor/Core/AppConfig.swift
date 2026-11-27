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
///   dungeons id), and `-lobbyScenes <2…9>` its length (9 is no set length).
/// - `-sheetTab <abilities|combat|spells|gear|story>` opens every hero sheet on that tab.
/// - `-sheetRule <name>` opens the rules text of the first spell, class feature, feat, species
///   trait or skill on a hero sheet whose name contains that text ("second wind", "burning").
/// - `-openMySheet YES` presents the caller's own hero sheet as soon as a game is open;
///   `-openSheetOf <name>` presents the sheet of the party's hero with that name instead.
/// - `-showChronicle YES` presents the story so far as soon as an open game has one.
/// - `-openQuests YES` (with `-openHeroNamed`) opens that hero's quests from their page, and
///   `-openQuest <CODE|latest>` goes on to open that adventure's record.
/// - `-newGame YES` opens the "A New Adventure" sheet (the hero picker) from the home screen.
/// - `-showHall YES` opens the Hall of Heroes from the home screen.
/// - `-scrollTo <choices|combat|bottom>` scrolls an open scene down to its choices, its fight or
///   its end; on a hero page or the forge's Sheet step, `-scrollTo bottom` scrolls to the end, and
///   a number from 0 to 1 (`-scrollTo 0.3`) opens the page that far down.
/// - `-playTab <story|sheet|map|chat>` opens a game being played on that tab; `-playPane
///   <abilities|saves|attacks|spells|items|features>` opens its Sheet tab on that pane; and
///   `-scrollTo choices` opens Story scrolled to what the table offers.
/// - `-wheel <actions|powers>` opens that quick-action wheel on the Story tab as soon as the scene
///   has actions; `-wheelTurn <n>` shows it turned n slots on; `-wheelAim <text>` shows the targets
///   of the first action whose label contains that text.
/// - `-hudOpen YES` opens a game being played with the party's heads-up display pulled down, so
///   the panel that lists everyone can be seen without a drag.
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

    /// `marketing+build`, for example `0.2+1`. The build is CFBundleVersion, which TestFlight raises
    /// on every upload. The server compares that build with its minimum.
    static var appVersion: String {
        let short = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0"
        return "\(short)+\(build)"
    }

    /// A TestFlight or App Store link. Set `DDUpdateURL` in the app's Info.plist (project.yml `info`)
    /// when there is one. Until then the update screen says so in words.
    static var updateURL: URL? {
        guard let raw = Bundle.main.object(forInfoDictionaryKey: "DDUpdateURL") as? String else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let url = URL(string: trimmed), url.scheme == "https" || url.scheme == "itms-beta" else { return nil }
        return url
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
    static var lobbyScenesArgument: Int? { argument("lobbyScenes").flatMap(Int.init).map { min(max($0, 2), 9) } }
    static var showMapArgument: Bool { UserDefaults.standard.bool(forKey: "showMap") }
    static var sheetTabArgument: String? { argument("sheetTab")?.lowercased() }
    static var sheetRuleArgument: String? { argument("sheetRule") }
    static var openMySheetArgument: Bool { UserDefaults.standard.bool(forKey: "openMySheet") }
    static var openSheetOfArgument: String? { argument("openSheetOf") }
    static var showChronicleArgument: Bool { UserDefaults.standard.bool(forKey: "showChronicle") }
    static var openQuestsArgument: Bool { UserDefaults.standard.bool(forKey: "openQuests") || openQuestArgument != nil }
    static var openQuestArgument: String? { argument("openQuest") }
    static var newGameArgument: Bool { UserDefaults.standard.bool(forKey: "newGame") }
    static var showHallArgument: Bool { UserDefaults.standard.bool(forKey: "showHall") }
    static var scrollToArgument: String? { argument("scrollTo")?.lowercased() }
    static var wheelArgument: WheelKind? { argument("wheel").flatMap { WheelKind(rawValue: $0.lowercased()) } }
    static var wheelTurnArgument: Int? { argument("wheelTurn").flatMap(Int.init) }
    static var wheelAimArgument: String? { argument("wheelAim") }
    static var playTabArgument: PlayTab? { argument("playTab").flatMap { PlayTab(rawValue: $0.lowercased()) } }
    static var playPaneArgument: PlaySheetPane? { argument("playPane").flatMap { PlaySheetPane(rawValue: $0.lowercased()) } }
    static var hudOpenArgument: Bool { UserDefaults.standard.bool(forKey: "hudOpen") }
    static var pushOpenArgument: PushNews? { argument("pushOpen").flatMap(PushNews.init(argument:)) }
    /// Where a page's scroll view starts: the top, unless `-scrollTo bottom` asks for the end.
    static var launchScrollAnchor: UnitPoint {
        // `-scrollTo 0.3` opens a scrolling page that far down it (0 is the top, 1 the bottom).
        if let part = scrollToArgument.flatMap(Double.init), (0...1).contains(part) { return UnitPoint(x: 0.5, y: part) }
        return scrollToArgument == "bottom" ? .bottom : .top
    }

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
