import AVFoundation
import Observation
import SwiftUI
import UIKit

/// Runs the dragon on the home screen: what he does when poked, what he says, and what you hear.
///
/// Each poke throws sparks and a thump of haptics. If he's settled and not already busy, he takes
/// the next reaction in his repertoire: a clip over the loop (`DragonPlayerView`), its sound, and a
/// spoken line shown as a caption, so it still works with the phone on silent.
@MainActor @Observable
final class DragonDirector {
    enum Reaction: String { case speak, fire, roar }

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
    @ObservationIgnored private var clipPlaying = false
    @ObservationIgnored private var voicePending = false
    /// Counts spoken lines, so an interrupted line's clean-up can't wipe the caption of its successor.
    @ObservationIgnored private var speech = 0
    @ObservationIgnored private var turn = 0
    @ObservationIgnored private var bags: [Reaction: [Line]] = [:]
    @ObservationIgnored private var scheduled: [Task<Void, Never>] = []

    /// Mostly he talks; every so often he shows what he is.
    private static let repertoire: [Reaction] = [.speak, .fire, .speak, .roar, .speak]

    private static let greeting = Line(file: "dragon-voice-greet", text: "So… another seeker, at my door.")

    private static let lines: [Reaction: [Line]] = [
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
        .fire: [
            Line(file: "dragon-voice-fire-1", text: "Mind your fingers."),
            Line(file: "dragon-voice-fire-2", text: "That… was only a breath."),
        ],
        .roar: [
            Line(file: "dragon-voice-roar-1", text: "Now… you have my attention."),
            Line(file: "dragon-voice-roar-2", text: "Do not make me rise again."),
        ],
    ]

    init() {
        sound.enabled = soundOn
    }

    // MARK: Stage

    func attach(_ stage: DragonPlayerView) {
        self.stage = stage
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
        } else {
            cancelScheduled()
            sound.silence()
            caption = nil
            voicePending = false
        }
    }

    // MARK: Poking

    func poke(at point: CGPoint) {
        throwSparks(at: point)
        UIImpactFeedbackGenerator(style: .heavy).impactOccurred()
        guard active, isSettled, !clipPlaying, !voicePending else { return }

        if !hasBeenPoked {
            hasBeenPoked = true
            UserDefaults.standard.set(true, forKey: "dd.dragonPoked")
        }
        let reaction = Self.repertoire[turn % Self.repertoire.count]
        turn += 1
        let line = nextLine(for: reaction)
        voicePending = true

        let started = stage?.playReaction(
            reaction.rawValue,
            onStart: { [weak self] in self?.perform(reaction, line: line) },
            onEnd: { [weak self] in self?.clipPlaying = false }) ?? false
        if started {
            clipPlaying = true
            // If a clip ever failed to start or finish, don't leave him deaf to the next poke.
            after(14) { [weak self] in
                self?.clipPlaying = false
                self?.voicePending = false
            }
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
        case .fire:
            sound.playEffect("dragon-sfx-fire", volume: 0.9)
            after(1.5) { [weak self] in self?.rumble(pulses: 9) }
            speak(line, after: 4.7)
        case .roar:
            sound.playEffect("dragon-sfx-roar", volume: 0.9)
            after(1.6) { [weak self] in self?.rumble(pulses: 8) }
            speak(line, after: 4.8)
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

    /// A shuffled bag per reaction, so lines don't repeat until he has said them all.
    private func nextLine(for reaction: Reaction) -> Line {
        if bags[reaction, default: []].isEmpty {
            bags[reaction] = (Self.lines[reaction] ?? []).shuffled()
        }
        return bags[reaction]!.removeLast()
    }

    private func arrivalBegan() {
        isSettled = false
        sound.playEffect("dragon-sfx-arrival", volume: 0.8)
        // He turns to look at you just before the arrival clip ends.
        speak(Self.greeting, after: 6.3, blocking: false)
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

    /// Debug builds only: `-dragonAutoPoke 3` pokes him three times once he's settled, so the
    /// reactions can be checked from a script without touching the screen.
    private func autoPokeIfAsked() {
        #if DEBUG
        let count = UserDefaults.standard.integer(forKey: "dragonAutoPoke")
        guard count > 0 else { return }
        for i in 0..<count {
            after(1.5 + Double(i) * 9) { [weak self] in
                self?.poke(at: CGPoint(x: 200, y: 420))
            }
        }
        #endif
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
