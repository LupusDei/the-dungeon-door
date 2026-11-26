import AVFoundation
import Observation

/// The narrator: reads a scene aloud in the storyteller's voice.
///
/// A reading is made on the server the first time anyone in the party asks for it, and kept, so
/// the narrator asks, waits for the file to arrive on the scene (the game's own poll brings it),
/// downloads it and plays it. One reading at a time; a new scene ends the one before.
@MainActor @Observable
final class Narrator {
    enum Phase: Equatable {
        case idle
        /// Asked for: the reading is being made, or its file is on the way.
        case preparing(scene: Int)
        case playing(scene: Int)
        /// It could not be made or fetched; tapping again retries.
        case failed(scene: Int)

        var scene: Int? {
            switch self {
            case .idle: nil
            case .preparing(let scene), .playing(let scene), .failed(let scene): scene
            }
        }
    }

    private(set) var phase: Phase = .idle

    /// Read each scene as it arrives, without a tap. Kept between launches; `-dd.narrateScenes YES`
    /// turns it on for a launch.
    var readsEveryScene: Bool = UserDefaults.standard.bool(forKey: Narrator.everySceneKey) {
        didSet { UserDefaults.standard.set(readsEveryScene, forKey: Narrator.everySceneKey) }
    }

    private static let everySceneKey = "dd.narrateScenes"
    /// How long to watch for a reading someone else started before asking the server again, and
    /// how many times to ask in all. A full scene takes about ten seconds to make.
    private static let patience: Duration = .seconds(15)
    private static let asks = 4

    private var player: AVAudioPlayer?
    private var work: Task<Void, Never>?
    /// The last readings fetched, so hearing a scene again costs nothing.
    private var fetched: [(url: URL, audio: Data)] = []
    /// Scenes already begun without a tap, so coming back to a scene doesn't start it over.
    private var begunUnasked: Set<Int> = []

    func isBusy(with scene: GameScene) -> Bool {
        switch phase {
        case .preparing(let index), .playing(let index): index == scene.index
        default: false
        }
    }

    /// The Listen button: starts this scene's reading, or stops it if it is under way.
    func toggle(_ scene: GameScene, in session: GameSession) {
        if isBusy(with: scene) { stop() } else { read(scene, in: session) }
    }

    /// A scene came on screen. Whatever was being read belonged to the scene before; with "every
    /// scene" on, this one starts by itself, once.
    func arrived(at scene: GameScene?, in session: GameSession) {
        guard let scene else { stop(); return }
        if let current = phase.scene, current != scene.index { stop() }
        guard readsEveryScene, !begunUnasked.contains(scene.index), !isBusy(with: scene) else { return }
        begunUnasked.insert(scene.index)
        read(scene, in: session)
    }

    func stop() {
        work?.cancel()
        work = nil
        if player != nil { quiet() }
        phase = .idle
    }

    private func read(_ scene: GameScene, in session: GameSession) {
        stop()
        let index = scene.index
        phase = .preparing(scene: index)
        work = Task { [weak self] in
            do {
                let url = try await Self.reading(of: scene, in: session)
                guard let self, !Task.isCancelled else { return }
                let audio = try await self.audio(at: url, from: session.api)
                guard !Task.isCancelled else { return }
                try await self.play(audio, scene: index)
            } catch is CancellationError {
                // Stopped, or the scene moved on.
            } catch {
                guard let self, !Task.isCancelled else { return }
                self.quiet()
                self.phase = .failed(scene: index)
                #if DEBUG
                print("[DungeonDoor] narration of scene \(index) failed: \(error.localizedDescription)")
                #endif
            }
        }
    }

    /// Where this scene's reading is: on the scene already, or asked for. The request that starts a
    /// reading is answered with it, or with its failure. Anyone else is told it is being made: they
    /// watch the scene for it, and ask again now and then in case the one making it failed.
    private static func reading(of scene: GameScene, in session: GameSession) async throws -> URL {
        if let url = session.reading(ofScene: scene.index) ?? scene.voiceURL { return url }
        for _ in 0..<asks {
            let reply = try await session.api.narration(session.code, sceneIndex: scene.index)
            if let url = reply.voiceURL { return url }
            let deadline = ContinuousClock.now + patience
            while ContinuousClock.now < deadline {
                try await Task.sleep(for: .milliseconds(500))
                if let url = session.reading(ofScene: scene.index) { return url }
            }
        }
        throw URLError(.timedOut)
    }

    private func audio(at url: URL, from api: APIClient) async throws -> Data {
        if let kept = fetched.first(where: { $0.url == url }) { return kept.audio }
        let audio = try await api.audio(at: url)
        fetched.append((url, audio))
        if fetched.count > 3 { fetched.removeFirst() }
        return audio
    }

    private func play(_ audio: Data, scene: Int) async throws {
        // A reading the player asked for is heard even with the ringer off; other audio dips under it.
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
        try? session.setActive(true)
        let player = try AVAudioPlayer(data: audio)
        self.player = player
        guard player.play() else { throw URLError(.cannotDecodeContentData) }
        phase = .playing(scene: scene)
        while player.isPlaying {
            try await Task.sleep(for: .milliseconds(250))
        }
        quiet()
        phase = .idle
    }

    /// Stops the sound and hands the audio session back as the rest of the app expects it (the
    /// home screen's dragon plays as ambient sound).
    private func quiet() {
        player?.stop()
        player = nil
        let session = AVAudioSession.sharedInstance()
        try? session.setActive(false, options: .notifyOthersOnDeactivation)
        try? session.setCategory(.ambient, mode: .default)
        try? session.setActive(true)
    }
}

extension GameSession {
    /// The narrator's reading of a scene of this game, if it has been made: on the scene on show, or
    /// in the chronicle once the story has moved on.
    func reading(ofScene index: Int) -> URL? {
        if let scene = state.scene, scene.index == index { return scene.voiceURL }
        return state.chronicle?.first { $0.index == index }?.voiceURL
    }
}
