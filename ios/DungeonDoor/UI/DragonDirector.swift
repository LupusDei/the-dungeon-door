import AVFoundation
import Observation
import SwiftUI
import UIKit

/// Runs the dragon on the home screen: what he does when poked, what he says, and what you hear.
///
/// Each poke throws sparks and a thump of haptics. If he's on his perch and not already busy, he
/// takes the next turn in his repertoire: a clip over the loop (`DragonPlayerView`), its sound, and
/// a spoken line shown as a caption, so it still works with the phone on silent. Once in a while the
/// turn is a flight: he leaves, the summit stands empty for a time, and he comes back carrying
/// something he looks over and drops off the cliff. Poke the empty summit and he comes back sooner.
@MainActor @Observable
final class DragonDirector {
    enum Reaction: String, CaseIterable { case speak, ponder, skygaze, fire, roar, yawn, smoke, flight }

    /// What he carries home from a flight.
    enum Trophy: String, CaseIterable {
        case helm, chest, orb

        /// In "dragon-return-<trophy>": when his feet hit the rock, and when the thing has gone
        /// over the edge and he has something to say about it.
        var cues: (lands: TimeInterval, speaks: TimeInterval) {
            switch self {
            case .helm: (4.0, 8.6)
            case .chest: (3.6, 8.8)
            case .orb: (3.4, 8.8)
            }
        }
    }

    struct Burst: Identifiable {
        let id = UUID()
        let origin: CGPoint
        let start: Date
        let seed: Int
    }

    struct Line {
        let file: String
        let text: String
    }

    /// The sets his lines are drawn from. Wisdom is shared by the speak and skygaze clips.
    private enum Bag: Hashable { case speak, wisdom, ask, fire, roar, yawn, smoke, leave }

    /// Where he is in a turn. Only `perched` takes a new one; `away` is the empty summit.
    private enum Phase { case perched, reacting, leaving, away, returning }

    /// Sparks for the ember field to draw.
    private(set) var bursts: [Burst] = []
    /// The line he's speaking right now, for the caption.
    private(set) var caption: String?
    /// Counts up each time the picture should rattle.
    private(set) var shakes = 0
    /// False until he has landed (or straight away when there's no arrival to wait for).
    private(set) var isSettled = true
    /// Whether this player has ever poked him; hides the hint once they have.
    private(set) var hasBeenPoked = UserDefaults.standard.bool(forKey: "dd.dragonPoked")

    var soundOn: Bool = UserDefaults.standard.object(forKey: "dd.soundOn") == nil
        || UserDefaults.standard.bool(forKey: "dd.soundOn") {
        didSet {
            UserDefaults.standard.set(soundOn, forKey: "dd.soundOn")
            sound.enabled = soundOn
            if soundOn, active { sound.startAmbience() } else if !soundOn { sound.silence() }
        }
    }

    @ObservationIgnored private weak var stage: DragonPlayerView?
    @ObservationIgnored private let sound = DragonSound()
    @ObservationIgnored private var active = false
    @ObservationIgnored private var phase = Phase.perched
    /// Counts phases, so a safety net or a timer set in one can't act on a later one.
    @ObservationIgnored private var phaseCount = 0
    @ObservationIgnored private var voicePending = false
    /// Counts spoken lines, so an interrupted line's clean-up can't wipe the caption of its successor.
    @ObservationIgnored private var speech = 0
    @ObservationIgnored private var turn = 0
    @ObservationIgnored private var repertoire = DragonRepertoire()
    @ObservationIgnored private var bags: [Bag: [Line]] = [:]
    /// The speak clip takes its own lines and words of wisdom by turns.
    @ObservationIgnored private var speaksWisdom = false
    @ObservationIgnored private var trophies: [Trophy] = []
    @ObservationIgnored private var trophy = Trophy.helm
    /// Whether a poke has already called him home from this flight.
    @ObservationIgnored private var calledBack = false
    @ObservationIgnored private var autoPoked = false
    @ObservationIgnored private var scheduled: [Task<Void, Never>] = []

    private static let greeting = Line(file: "dragon-voice-greet", text: "So… another seeker, at my door.")

    private static let lines: [Bag: [Line]] = [
        .speak: [
            Line(file: "dragon-voice-speak-1", text: "You dare to wake me, little one?"),
            Line(file: "dragon-voice-speak-2", text: "I have watched a thousand heroes walk through that door. Few walked back."),
            Line(file: "dragon-voice-speak-3", text: "Careful. I am older than the stones beneath your feet."),
            Line(file: "dragon-voice-speak-4", text: "Bring me a tale worth the telling… and I may let you keep your bones."),
            Line(file: "dragon-voice-speak-5", text: "Gather your party. The dark does not wait."),
            Line(file: "dragon-voice-speak-6", text: "Curious, are we? Curiosity has a price."),
            Line(file: "dragon-voice-speak-7", text: "Mmm. I smell courage. Or is it fear? They are so very alike."),
            Line(file: "dragon-voice-speak-8", text: "Go on, then. Open the door. I am watching."),
        ],
        .wisdom: [
            Line(file: "dragon-voice-wisdom-1", text: "A map shows you the road. It does not show you who waits on it."),
            Line(file: "dragon-voice-wisdom-2", text: "Gold is heavy. Ask any hero I have fished out of a river."),
            Line(file: "dragon-voice-wisdom-3", text: "The brave die once. The careless die on the first stair."),
            Line(file: "dragon-voice-wisdom-4", text: "Never split the party. I have dined well on those who did."),
            Line(file: "dragon-voice-wisdom-5", text: "A locked door is a question. A broken one is an answer you may regret."),
            Line(file: "dragon-voice-wisdom-6", text: "Listen to the quiet one in your party. They have been counting the exits."),
            Line(file: "dragon-voice-wisdom-7", text: "Every dungeon was once somebody's home. Wipe your feet."),
            Line(file: "dragon-voice-wisdom-8", text: "Rest when you can. The dark keeps better hours than you do."),
            Line(file: "dragon-voice-wisdom-9", text: "Luck is a fine servant. Do not make it your captain."),
        ],
        .ask: [
            Line(file: "dragon-voice-ask-1", text: "Tell me, little one. What is it you seek behind my door?"),
            Line(file: "dragon-voice-ask-2", text: "Who do you trust at your back, when the torches fail?"),
            Line(file: "dragon-voice-ask-3", text: "What would you give for a second chance? Think carefully. I collect."),
            Line(file: "dragon-voice-ask-4", text: "Are you the hero of this tale… or the warning in someone else's?"),
            Line(file: "dragon-voice-ask-5", text: "What is your name worth, I wonder, when no one is left to speak it?"),
            Line(file: "dragon-voice-ask-6", text: "Would you rather be feared, or remembered? You may not have both."),
            Line(file: "dragon-voice-ask-7", text: "How many doors have you walked past, wishing you had knocked?"),
        ],
        .fire: [
            Line(file: "dragon-voice-fire-1", text: "Mind your fingers."),
            Line(file: "dragon-voice-fire-2", text: "That… was only a breath."),
        ],
        .roar: [
            Line(file: "dragon-voice-roar-1", text: "Now… you have my attention."),
            Line(file: "dragon-voice-roar-2", text: "Do not make me rise again."),
        ],
        .yawn: [
            Line(file: "dragon-voice-yawn-1", text: "Forgive me. Eternity is long, and you poke often."),
            Line(file: "dragon-voice-yawn-2", text: "Wake me when the heroes get interesting."),
        ],
        .smoke: [
            Line(file: "dragon-voice-smoke-1", text: "A trick I learned from a wizard. A generous man. Very filling."),
            Line(file: "dragon-voice-smoke-2", text: "There. Now make a wish. No? Wise."),
        ],
        .leave: [
            Line(file: "dragon-voice-leave-1", text: "Wait here. I smell something… interesting."),
            Line(file: "dragon-voice-leave-2", text: "Do not touch anything. I will know."),
            Line(file: "dragon-voice-leave-3", text: "Something stirs in the valley. Hold my place."),
        ],
    ]

    /// What he says of each thing once it has gone over the cliff.
    private static let verdicts: [Trophy: Line] = [
        .helm: Line(file: "dragon-voice-return-helm", text: "He would not tell me a story. A pity."),
        .chest: Line(file: "dragon-voice-return-chest", text: "Gold. Always gold. As if I had room for more."),
        .orb: Line(file: "dragon-voice-return-orb", text: "A wizard's toy. It tried to tell me my future. Presumptuous."),
    ]

    init() {
        sound.enabled = soundOn
    }

    // MARK: Stage

    func attach(_ stage: DragonPlayerView) {
        self.stage = stage
        enter(.perched)
        isSettled = stage.isSettled
        stage.onArrivalBegan = { [weak self] in self?.arrivalBegan() }
        stage.onArrivalEnded = { [weak self] in
            self?.isSettled = true
            self?.autoPokeIfAsked()
        }
        if stage.isSettled { autoPokeIfAsked() }
    }

    /// Called as the home screen comes and goes (covered by a game, app in the background).
    func setActive(_ nowActive: Bool) {
        guard nowActive != active else { return }
        active = nowActive
        if nowActive {
            sound.startAmbience()
            #if DEBUG
            // With Reduce Motion there's no stage to say he has settled, so the scripted pokes start here.
            after(0.5) { [weak self] in
                if self?.stage == nil { self?.autoPokeIfAsked() }
            }
            #endif
        } else {
            cancelScheduled()
            sound.silence()
            caption = nil
            voicePending = false
            // Whatever he was in the middle of, he's on his perch when the home screen comes back.
            stage?.reset()
            enter(.perched)
        }
    }

    // MARK: Poking

    func poke(at point: CGPoint) {
        throwSparks(at: point)
        UIImpactFeedbackGenerator(style: .heavy).impactOccurred()
        guard active, isSettled else { return }
        if phase == .away {
            callBack()
            return
        }
        guard phase == .perched, !voicePending else { return }

        if !hasBeenPoked {
            hasBeenPoked = true
            UserDefaults.standard.set(true, forKey: "dd.dragonPoked")
        }
        let (reaction, scripted) = nextTurn()
        if reaction == .flight {
            leave(bringing: scripted)
        } else {
            react(reaction)
        }
    }

    /// What he does next, and what he brings back from it when a debug script says.
    private func nextTurn() -> (Reaction, Trophy?) {
        defer { turn += 1 }
        let dealt = repertoire.next(showing: stage != nil)
        #if DEBUG
        if stage != nil, let step = Self.script(at: turn) { return step }
        #endif
        return (dealt, nil)
    }

    private func react(_ reaction: Reaction) {
        let line = nextLine(for: reaction)
        voicePending = true
        let started = stage?.play(
            "dragon-react-\(reaction.rawValue)",
            onStart: { [weak self] in self?.perform(reaction, line: line) },
            onEnd: { [weak self] in self?.land(from: .reacting) }) ?? false
        if started {
            enter(.reacting)
            catchFall(after: 14)
        } else {
            // No video (Reduce Motion): he simply answers.
            speak(line, after: 0.15)
        }
    }

    private func perform(_ reaction: Reaction, line: Line) {
        switch reaction {
        case .speak:
            // His head is down by your face about a second in.
            speak(line, after: 1.2)
        case .ponder, .skygaze:
            // His eye is on you, or on the storm, by two seconds in; he starts as he gets there.
            speak(line, after: 1.6)
        case .fire:
            sound.playEffect("dragon-sfx-fire", volume: 0.9)
            after(1.5) { [weak self] in self?.rumble(pulses: 9) }
            speak(line, after: 4.7)
        case .roar:
            sound.playEffect("dragon-sfx-roar", volume: 0.9)
            after(1.6) { [weak self] in self?.rumble(pulses: 8) }
            speak(line, after: 4.8)
        case .yawn:
            // The yawn and the stretch come first; he excuses himself as his wings fold.
            sound.playEffect("dragon-sfx-yawn", volume: 0.85)
            speak(line, after: 5.6)
        case .smoke:
            // The ring has passed you and his face is clear of it again.
            sound.playEffect("dragon-sfx-smoke", volume: 0.8)
            speak(line, after: 4.6)
        case .flight:
            break
        }
    }

    /// `blocking` lines hold off the next poke until they're done; the greeting doesn't, so an
    /// eager first poke cuts straight in.
    private func speak(_ line: Line, after delay: TimeInterval, blocking: Bool = true) {
        if blocking { voicePending = true }
        after(delay) { [weak self] in
            guard let self else { return }
            self.speech += 1
            let mine = self.speech
            let length = self.sound.speak(line.file)
            withAnimation(.easeInOut(duration: 0.35)) { self.caption = line.text }
            self.after(max(length, 1.8) + 0.5) { [weak self] in
                guard let self, self.speech == mine else { return }
                withAnimation(.easeInOut(duration: 0.5)) { self.caption = nil }
                self.voicePending = false
            }
        }
    }

    private func nextLine(for reaction: Reaction) -> Line {
        switch reaction {
        case .speak:
            defer { speaksWisdom.toggle() }
            return nextLine(from: speaksWisdom ? .wisdom : .speak)
        case .ponder: return nextLine(from: .ask)
        case .skygaze: return nextLine(from: .wisdom)
        case .fire: return nextLine(from: .fire)
        case .roar: return nextLine(from: .roar)
        case .yawn: return nextLine(from: .yawn)
        case .smoke: return nextLine(from: .smoke)
        case .flight: return nextLine(from: .leave)
        }
    }

    /// A shuffled bag per set, so lines don't repeat until he has said them all.
    private func nextLine(from bag: Bag) -> Line {
        if bags[bag, default: []].isEmpty {
            bags[bag] = (Self.lines[bag] ?? []).shuffled()
        }
        return bags[bag]!.removeLast()
    }

    private func arrivalBegan() {
        isSettled = false
        sound.playEffect("dragon-sfx-arrival", volume: 0.8)
        // He turns to look at you just before the arrival clip ends.
        speak(Self.greeting, after: 6.3, blocking: false)
    }

    // MARK: Flights

    /// He takes off ("dragon-depart" ends on the empty summit), is gone for a while, and returns
    /// with the next trophy in the bag.
    private func leave(bringing scripted: Trophy?) {
        if trophies.isEmpty { trophies = Trophy.allCases.shuffled() }
        trophy = scripted ?? trophies.removeLast()
        calledBack = false
        let line = nextLine(from: .leave)
        voicePending = true
        let started = stage?.play(
            "dragon-depart", leavingSummitEmpty: true,
            onStart: { [weak self] in
                guard let self else { return }
                self.sound.playEffect("dragon-sfx-depart", volume: 0.85)
                // He says it before he crouches; the wings open at 1.5 s and he's off the rock at 4.
                self.speak(line, after: 0.3)
                self.after(3.9) { [weak self] in self?.rumble(pulses: 5) }
            },
            onEnd: { [weak self] in self?.left() }) ?? false
        if started {
            enter(.leaving)
            catchFall(after: 14)
        } else {
            // He can't leave without the picture, so he stays and says something worth hearing.
            speak(nextLine(from: .wisdom), after: 0.15)
        }
    }

    /// The departure has played out and the summit is empty: time his return.
    private func left() {
        guard phase == .leaving else { return }
        guard stage?.isAway == true else {
            // The empty summit never loaded, so the stage put him straight back.
            land(from: .leaving)
            return
        }
        enter(.away)
        var wait = TimeInterval.random(in: 6...16)
        #if DEBUG
        wait = AppConfig.dragonAwayArgument ?? wait
        #endif
        whileStillHere(after: wait) { $0.comeBack() }
    }

    /// A poke at the empty summit. He hears it, wherever he is, answers, and turns for home.
    private func callBack() {
        guard !calledBack else { return }
        calledBack = true
        sound.playEffect("dragon-sfx-distant-roar", volume: 0.9)
        whileStillHere(after: 1.8) { $0.comeBack() }
    }

    private func comeBack() {
        guard phase == .away else { return }
        let trophy = self.trophy
        let started = stage?.play(
            "dragon-return-\(trophy.rawValue)",
            onStart: { [weak self] in
                guard let self else { return }
                self.sound.playEffect("dragon-sfx-return-\(trophy.rawValue)", volume: 0.85)
                self.after(trophy.cues.lands) { [weak self] in self?.rumble(pulses: 6) }
                if let verdict = Self.verdicts[trophy] { self.speak(verdict, after: trophy.cues.speaks) }
            },
            onEnd: { [weak self] in self?.land(from: .returning) }) ?? false
        if started {
            enter(.returning)
            catchFall(after: 17)
        } else {
            // The return can't play: better he is simply back than gone for good.
            stage?.reset()
            enter(.perched)
        }
    }

    /// A clip has handed back to the loop.
    private func land(from finished: Phase) {
        if phase == finished { enter(.perched) }
    }

    private func enter(_ next: Phase) {
        phase = next
        phaseCount += 1
    }

    /// Runs `work` later, unless he has moved on to another phase by then.
    private func whileStillHere(after seconds: TimeInterval, _ work: @escaping @MainActor (DragonDirector) -> Void) {
        let here = phaseCount
        after(seconds) { [weak self] in
            guard let self, self.phaseCount == here else { return }
            work(self)
        }
    }

    /// The safety net under each clip. If one ever failed to start or finish, don't leave him deaf
    /// to the next poke, or gone from his summit: put him back on his perch.
    private func catchFall(after seconds: TimeInterval) {
        whileStillHere(after: seconds) { director in
            director.stage?.reset()
            director.voicePending = false
            director.enter(.perched)
        }
    }

    // MARK: Effects

    private func throwSparks(at point: CGPoint) {
        let now = Date()
        bursts.removeAll { now.timeIntervalSince($0.start) > 1.5 }
        bursts.append(Burst(origin: point, start: now, seed: Int.random(in: 0..<1000)))
        after(1.6) { [weak self] in
            let cutoff = Date()
            self?.bursts.removeAll { cutoff.timeIntervalSince($0.start) > 1.5 }
        }
    }

    /// The roar in your hand, and a rattle of the picture.
    private func rumble(pulses: Int) {
        shakes += 1
        let generator = UIImpactFeedbackGenerator(style: .heavy)
        generator.prepare()
        for i in 0..<pulses {
            after(Double(i) * 0.14) {
                generator.impactOccurred(intensity: CGFloat(1 - Double(i) / Double(pulses) * 0.7))
            }
        }
    }

    private func after(_ seconds: TimeInterval, _ work: @escaping @MainActor () -> Void) {
        let task = Task { @MainActor in
            try? await Task.sleep(for: .seconds(seconds))
            guard !Task.isCancelled else { return }
            work()
        }
        scheduled.removeAll { $0.isCancelled }
        scheduled.append(task)
    }

    private func cancelScheduled() {
        scheduled.forEach { $0.cancel() }
        scheduled.removeAll()
    }

    // MARK: Scripted pokes (debug)

    /// Debug builds only: `-dragonAutoPoke 3` pokes him three times once he's settled, so the
    /// reactions can be checked from a script without touching the screen. See `AppConfig` for
    /// the arguments that choose what he does and how long he stays away.
    private func autoPokeIfAsked() {
        #if DEBUG
        let count = AppConfig.dragonAutoPokeArgument
        guard count > 0, !autoPoked else { return }
        autoPoked = true
        let gap = AppConfig.dragonPokeEveryArgument ?? 9
        for i in 0..<count {
            // Not through `after`: these keep their appointments when the home screen is covered
            // and comes back, so that can be scripted too.
            Task { @MainActor [weak self] in
                try? await Task.sleep(for: .seconds(1.5 + Double(i) * gap))
                self?.poke(at: CGPoint(x: 200, y: 420))
            }
        }
        #endif
    }

    #if DEBUG
    /// The turn `-dragonAct` asks for on the nth poke: a reaction's name, or `flight-chest` to
    /// choose what he brings back. The list repeats once it runs out.
    private static func script(at turn: Int) -> (Reaction, Trophy?)? {
        let steps = (AppConfig.dragonActArgument ?? "").split(separator: ",")
        guard !steps.isEmpty else { return nil }
        let parts = steps[turn % steps.count].split(separator: "-").map(String.init)
        guard let name = parts.first, let reaction = Reaction(rawValue: name) else { return nil }
        return (reaction, parts.count > 1 ? Trophy(rawValue: parts[1]) : nil)
    }
    #endif
}

/// The order of his turns. Each hand of ten is six of talk (the speak, ponder and skygaze clips,
/// twice each), three shows of what he is (fire, roar, yawn and smoke take it in turns to sit one
/// out) and one flight, shuffled so that nothing comes twice running. Flights are long, so they're
/// kept apart: never in the first three turns of the first hand or the first four of a later one.
struct DragonRepertoire {
    typealias Reaction = DragonDirector.Reaction

    static let talk: [Reaction] = [.speak, .ponder, .skygaze]
    static let shows: [Reaction] = [.fire, .roar, .yawn, .smoke]

    private var hand: [Reaction] = []
    private var last: Reaction?
    private var dealt = 0
    private let showOrder = DragonRepertoire.shows.shuffled()

    /// His next turn. Without the picture (`showing` false) only his words make sense, so he talks.
    mutating func next(showing: Bool = true) -> Reaction {
        guard showing else {
            let pick = Self.talk.filter { $0 != last }.randomElement() ?? .speak
            last = pick
            return pick
        }
        // A dealt hand never repeats a turn back to back, nor opens on the last turn of the hand
        // before. Skipping a match here also covers turns taken without the picture in between.
        if !hand.contains(where: { $0 != last }) { hand = deal() }
        let pick = hand.remove(at: hand.firstIndex { $0 != last } ?? 0)
        last = pick
        return pick
    }

    private mutating func deal() -> [Reaction] {
        let first = dealt == 0
        let resting = showOrder[dealt % showOrder.count]
        dealt += 1
        // The very first turn is plain talk; the rest of that hand is shuffled behind it.
        let opening: [Reaction] = first ? [.speak] : []
        var rest: [Reaction] = [.speak, .ponder, .ponder, .skygaze, .skygaze, .flight] + Self.shows.filter { $0 != resting }
        if !first { rest.append(.speak) }
        let earliestFlight = first ? 3 : 4
        var cards = opening + rest
        for _ in 0..<1000 {
            cards = opening + rest.shuffled()
            let flightAt = cards.firstIndex(of: .flight) ?? 0
            let repeats = zip(cards, cards.dropFirst()).contains { $0 == $1 } || cards.first == last
            if !repeats, flightAt >= earliestFlight, !first || flightAt <= 6 { break }
        }
        return cards
    }
}

/// The home screen's sound: a quiet ambience loop, one-shot effects and his voice.
/// Uses the ambient audio category, so it obeys the silent switch and never stops the player's music.
@MainActor
final class DragonSound {
    var enabled = true

    private var ambience: AVAudioPlayer?
    private var voice: AVAudioPlayer?
    private var effects: [AVAudioPlayer] = []
    private var sessionReady = false

    private let ambienceLevel: Float = 0.32
    private let duckedLevel: Float = 0.1

    func startAmbience() {
        guard enabled else { return }
        prepareSession()
        if ambience == nil, let url = Bundle.main.url(forResource: "dragon-ambience", withExtension: "caf") {
            ambience = try? AVAudioPlayer(contentsOf: url)
            ambience?.numberOfLoops = -1
        }
        guard let ambience, !ambience.isPlaying else { return }
        ambience.volume = 0
        ambience.play()
        ambience.setVolume(ambienceLevel, fadeDuration: 2.5)
    }

    /// Stops everything. Used when the home screen is covered or sound is switched off.
    func silence() {
        ambience?.setVolume(0, fadeDuration: 0.4)
        let fading = ambience
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(0.45))
            if fading?.volume == 0 { fading?.pause() }
        }
        voice?.stop()
        effects.forEach { $0.stop() }
        effects.removeAll()
    }

    func playEffect(_ file: String, volume: Float) {
        guard enabled, let player = player(for: file) else { return }
        prepareSession()
        effects.removeAll { !$0.isPlaying }
        player.volume = volume
        player.play()
        effects.append(player)
    }

    /// Speaks a line if sound is on. Returns how long the line lasts either way, for the caption.
    @discardableResult
    func speak(_ file: String) -> TimeInterval {
        guard let player = player(for: file) else { return 0 }
        guard enabled else { return player.duration }
        prepareSession()
        voice?.stop()
        voice = player
        player.volume = 1
        player.play()
        // Let him be heard over the wind, then bring it back.
        ambience?.setVolume(duckedLevel, fadeDuration: 0.25)
        let length = player.duration
        Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(length))
            guard let self, self.voice === player, self.ambience?.isPlaying == true else { return }
            self.ambience?.setVolume(self.ambienceLevel, fadeDuration: 0.8)
        }
        return length
    }

    private func player(for file: String) -> AVAudioPlayer? {
        guard let url = Bundle.main.url(forResource: file, withExtension: "m4a") else { return nil }
        let player = try? AVAudioPlayer(contentsOf: url)
        player?.prepareToPlay()
        return player
    }

    private func prepareSession() {
        guard !sessionReady else { return }
        sessionReady = true
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.ambient, mode: .default)
        try? session.setActive(true)
    }
}
