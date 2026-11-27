import SwiftUI

/// One scene as it was drawn before the play dashboard: the art, the narration, and the choices.
/// `GameView` now plays on `PlayShell`. This screen stays because the play tabs still use the
/// narrator bar, the time and light line, the waiting-foes notice, and the resolving and level-up
/// covers that live here.
struct SceneView: View {
    @Environment(AppModel.self) private var model
    @Bindable var session: GameSession
    /// Reads scenes aloud; it belongs to the game screen, so it outlives a scene.
    var narrator: Narrator
    /// Opens the sheet of the hero with this player id (the party strip's taps).
    var openHero: (String) -> Void = { _ in }
    @State private var revealedRoll: Int?
    @State private var inCharacterDraft = ""

    private var state: GameState { session.state }
    private var rules: RulesView? { state.rules }
    private var heroNames: [String] { rules?.party.map(\.name) ?? state.players.map(\.character.name) }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                if let scene = state.scene {
                    VStack(alignment: .leading, spacing: 20) {
                        header(scene)
                        if let combat = fight(in: scene) {
                            // A round of a fight: who stands where and what to do come first, so
                            // nobody scrolls past the picture every round. The telling follows.
                            CombatView(session: session, scene: scene, combat: combat, openHero: openHero).id("combat")
                            NarratorBar(scene: scene, session: session, narrator: narrator)
                            narration(scene)
                            inCharacter(scene)
                            IllustrationView(url: scene.imageURL)
                        } else {
                            if let party = rules?.party, !party.isEmpty {
                                PartyStrip(party: party, players: state.players, me: session.playerId, open: openHero)
                            }
                            IllustrationView(url: scene.imageURL)
                            // The narrator reads what came of the last scene, then this one's telling.
                            NarratorBar(scene: scene, session: session, narrator: narrator)
                            whatCameOfIt(scene)
                            narration(scene)
                            inCharacter(scene)
                            if scene.isFinale {
                                finale
                            } else {
                                if !scene.combat, let waiting = rules?.dungeon?.waiting {
                                    WaitingFoesNotice(waiting: waiting)
                                }
                                choices(scene).id("choices")
                                status(scene)
                            }
                        }
                        ErrorLine(text: session.error)
                        Color.clear.frame(height: 1).id("bottom")
                    }
                    .padding(20)
                    .frame(maxWidth: 720)
                    .frame(maxWidth: .infinity)
                    .id(scene.index)
                }
            }
            .onChange(of: state.scene?.index) { _, _ in
                revealedRoll = nil
                inCharacterDraft = ""
                withAnimation { proxy.scrollTo(state.scene?.index, anchor: .top) }
            }
            .task(id: state.scene?.index) {
                // A new scene ends the reading of the one before, and may start its own.
                narrator.offer(model.catalog)
                narrator.arrived(at: state.scene, in: session)
            }
            .onChange(of: model.catalog?.narrators) { _, _ in narrator.offer(model.catalog) }
            .task {
                // Screenshot checks: `-scrollTo choices`, `combat` or `bottom` jumps below the fold.
                guard let anchor = AppConfig.scrollToArgument else { return }
                try? await Task.sleep(for: .seconds(1.5))
                proxy.scrollTo(anchor, anchor: anchor == "bottom" ? .bottom : .top)
            }
        }
        .overlay {
            if state.status == .resolving, let scene = state.scene {
                ResolvingOverlay(scene: scene, players: state.players)
            }
        }
        .overlay {
            if let notice = session.levelUp {
                LevelUpOverlay(notice: notice) {
                    withAnimation(.easeOut(duration: 0.25)) { session.levelUp = nil }
                } showSheet: {
                    session.levelUp = nil
                    openHero(session.playerId)
                }
            }
        }
        .animation(.easeInOut, value: state.status)
        .animation(.spring(duration: 0.5, bounce: 0.3), value: session.levelUp)
    }

    /// The fight this scene is a round of, if it is one.
    private func fight(in scene: GameScene) -> Combat? {
        scene.combat && !scene.isFinale ? rules?.combat : nil
    }

    private func header(_ scene: GameScene) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            SectionLabel(eyebrow(scene))
            Text(scene.title).font(.display(28, weight: .bold))
            if !scene.isFinale, let rules, rules.time != nil || rules.light != nil {
                TimeAndLight(clock: rules.time, light: rules.light,
                             mine: rules.party.first { $0.playerId == session.playerId })
                    .padding(.top, 6)
            }
        }
    }

    /// The line above the title: where the party is in the story, the dungeon or the fight.
    private func eyebrow(_ scene: GameScene) -> String {
        if scene.isFinale { return "Finale" }
        if let combat = fight(in: scene) { return "Battle · Round \(combat.round)" }
        if let dungeon = rules?.dungeon, let here = dungeon.here {
            // The level is named once the party has gone deeper than where it began.
            let level = dungeon.levelReached.map { " · Level \($0)" } ?? ""
            return "\(dungeon.kind)\(level) · \(DungeonNames.label(here))"
        }
        return state.sceneCount > 0 ? "Scene \(scene.index + 1) of \(state.sceneCount)" : "Scene \(scene.index + 1)"
    }

    /// What the last scene came to: the choice, the dungeon master's word on it, and the engine's
    /// dice, right above the new scene's telling.
    @ViewBuilder private func whatCameOfIt(_ scene: GameScene) -> some View {
        let last = state.chronicle?.last.flatMap { $0.index == scene.index - 1 ? $0 : nil }
        let dice = scene.index > 0 ? rules?.results ?? [] : []
        if last != nil || !dice.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                if let last {
                    VStack(alignment: .leading, spacing: 6) {
                        SectionLabel("What came of it")
                        if let deed = session.deed(of: last) {
                            Text(deed).font(.proseSmall.weight(.semibold)).foregroundStyle(Palette.gold)
                        }
                        Text(last.outcome).font(.proseSmall.italic()).foregroundStyle(Palette.parchment.opacity(0.85))
                        roleplayLines(last.roleplay)
                    }
                    .padding(.leading, 14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(alignment: .leading) { Rectangle().fill(Palette.gold.opacity(0.6)).frame(width: 2) }
                }
                DiceLog(lines: dice, heroes: heroNames)
            }
        }
    }

    /// What the players said and did in character, then a box to add to this turn. No roll.
    @ViewBuilder private func inCharacter(_ scene: GameScene) -> some View {
        if !scene.isFinale {
            VStack(alignment: .leading, spacing: 8) {
                SectionLabel("In character")
                if scene.roleplay.isEmpty && state.status == .voting {
                    Text("Say what your hero says or does. No roll.")
                        .font(.proseSmall.italic())
                        .foregroundStyle(Palette.muted)
                }
                roleplayLines(scene.roleplay)
                if state.status == .voting {
                    HStack(alignment: .bottom, spacing: 10) {
                        TextField("Say or do…", text: $inCharacterDraft, axis: .vertical)
                            .font(.prose)
                            .lineLimit(1...3)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 10)
                            .card()
                        Button {
                            let text = inCharacterDraft
                            inCharacterDraft = ""
                            Task { await session.speakInCharacter(text) }
                        } label: {
                            Image(systemName: "quote.bubble.fill").font(.system(size: 28))
                        }
                        .disabled(inCharacterDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || session.busy)
                        .accessibilityLabel("Speak in character")
                    }
                }
            }
        }
    }

    @ViewBuilder private func roleplayLines(_ lines: [RoleplayLine]) -> some View {
        ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
            (Text(line.characterName + ": ").fontWeight(.semibold) + Text(line.text))
                .font(.proseSmall)
                .foregroundStyle(Palette.parchment)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func narration(_ scene: GameScene) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            ForEach(Array(scene.narration.components(separatedBy: "\n").filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }.enumerated()), id: \.offset) { _, paragraph in
                Text(paragraph)
                    .font(.system(size: 18, design: .serif))
                    .lineSpacing(5)
            }
        }
        .textSelection(.enabled)
    }

    // MARK: Choices

    @ViewBuilder private func choices(_ scene: GameScene) -> some View {
        if !scene.choices.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                SectionLabel("What will you do?")
                ForEach(Array(scene.choices.enumerated()), id: \.element.id) { index, choice in
                    ChoiceCard(
                        choice: choice,
                        letter: ChoiceLetter.at(index),
                        rule: RuleTag(label: choice.rules, dungeon: rules?.dungeon),
                        voters: scene.votes.filter { $0.choiceId == choice.id }.compactMap { state.player($0.playerId) },
                        mine: scene.myVote == choice.id,
                        enabled: state.status == .voting && !session.busy
                    ) {
                        Task {
                            let firstVote = scene.myVote == nil
                            await session.vote(choice)
                            if firstVote, let roll = session.myVote?.roll {
                                withAnimation(.spring(duration: 0.6, bounce: 0.5)) { revealedRoll = roll }
                            }
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder private func status(_ scene: GameScene) -> some View {
        let waiting = state.players.filter { player in !scene.votes.contains { $0.playerId == player.playerId } }
        VStack(spacing: 14) {
            if let vote = session.myVote {
                let rule = scene.choices.first { $0.id == vote.choiceId }?.rules
                HStack(spacing: 14) {
                    D20Badge(roll: vote.roll, size: 52)
                        .rotationEffect(.degrees(revealedRoll == nil ? 0 : 360))
                        .scaleEffect(revealedRoll == nil ? 1 : 1.08)
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Your d20").font(.display(16))
                        Text(rollNote(vote.roll, rule: rule))
                            .font(.footnote.italic())
                            .foregroundStyle(Palette.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 0)
                }
                .padding(14)
                .card()
            }
            if state.status == .voting {
                if waiting.isEmpty {
                    Text("All votes are in.").font(.proseSmall.italic()).foregroundStyle(Palette.muted)
                } else {
                    HStack(spacing: 8) {
                        ProgressView().tint(Palette.gold)
                        Text("Waiting on \(ListFormatter.localizedString(byJoining: waiting.map { $0.playerId == session.playerId ? "you" : $0.character.name }))…")
                            .font(.proseSmall.italic()).foregroundStyle(Palette.muted)
                    }
                    if session.isHost && !scene.votes.isEmpty {
                        Button("Proceed without them") { Task { await session.advance() } }
                            .buttonStyle(.gildedOutline)
                            .disabled(session.busy)
                    }
                }
            } else if state.status == .preparing {
                HStack(spacing: 8) {
                    ProgressView().tint(Palette.gold)
                    Text("The dungeon master is still writing…").font(.proseSmall.italic()).foregroundStyle(Palette.muted)
                }
            }
        }
        .frame(maxWidth: .infinity)
    }

    /// What the roll is for. Where the rules call for a check or a save, the hero rolls it with
    /// this d20 and their own bonus; the result arrives with the dice of the next scene.
    private func rollNote(_ roll: Int, rule: String?) -> String {
        if let rule, RuleTag.isRoll(rule) {
            return "Your roll for the \(rule.prefix(1).lowercased() + rule.dropFirst()), plus your hero's own bonus."
        }
        switch roll {
        case 20: return "A natural 20! Fortune bends toward you."
        case 1: return "A natural 1. Something will go wrong."
        case 15...19: return "A strong roll."
        case 8...14: return "A fair roll. Fate is undecided."
        default: return "A poor roll. Tread carefully."
        }
    }

    // MARK: Finale

    private var finale: some View {
        VStack(spacing: 16) {
            Image(systemName: "laurel.leading")
                .font(.system(size: 34))
                .foregroundStyle(Palette.gold)
                .overlay(alignment: .trailing) {
                    Image(systemName: "laurel.trailing").font(.system(size: 34)).foregroundStyle(Palette.gold).offset(x: 40)
                }
                .offset(x: -20)
            Text("The End").font(.display(26, weight: .bold))
            Text(rules == nil ? "Your tale is written in the chronicle."
                              : "Your tale is written in the chronicle, and what your heroes won goes home on their sheets.")
                .font(.proseSmall.italic())
                .foregroundStyle(Palette.muted)
                .multilineTextAlignment(.center)
            if let party = rules?.party, !party.isEmpty { homecoming(party) }
            Button("Return to the tavern") { model.closeGame() }
                .buttonStyle(.gilded)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 10)
    }
}

extension SceneView {
    /// How each hero leaves the adventure: the level and experience that go home with them, or
    /// that they did not come back.
    fileprivate func homecoming(_ party: [HeroStanding]) -> some View {
        VStack(spacing: 0) {
            ForEach(Array(party.enumerated()), id: \.element.id) { index, hero in
                if index > 0 {
                    Rectangle().fill(Palette.gold.opacity(0.14)).frame(height: 1).padding(.leading, 14)
                }
                Button { openHero(hero.playerId) } label: {
                    HStack(spacing: 10) {
                        PortraitView(url: session.state.player(hero.playerId)?.character.portraitURL, size: 34, circular: true)
                            .saturation(hero.dead ? 0 : 1)
                            .opacity(hero.dead ? 0.6 : 1)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(hero.name)
                                .font(.system(size: 15, weight: .semibold, design: .serif))
                                .foregroundStyle(hero.dead ? Palette.muted : hero.playerId == session.playerId ? Palette.gold : Palette.parchment)
                            Text(hero.dead ? "Fell on this adventure" : rise(of: hero) ?? next(hero))
                                .font(.caption)
                                .foregroundStyle(hero.dead ? Palette.ember : rise(of: hero) != nil ? Palette.gold : Palette.muted)
                        }
                        Spacer(minLength: 8)
                        VStack(alignment: .trailing, spacing: 1) {
                            Text("Level \(hero.level)").font(.system(size: 15, weight: .semibold, design: .serif))
                            Text("\(hero.xp) XP").font(.caption).monospacedDigit().foregroundStyle(Palette.muted)
                        }
                        Image(systemName: "chevron.right")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(Palette.muted.opacity(0.7))
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 9)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityElement(children: .combine)
                .accessibilityHint("Opens their character sheet")
            }
        }
        .card()
    }

    /// "Rose from level 1 to level 2" for a hero the quest's end levelled up.
    private func rise(of hero: HeroStanding) -> String? {
        guard let up = rules?.levelUps.first(where: { $0.playerId == hero.playerId }), up.to > up.from else { return nil }
        return "Rose from level \(up.from) to level \(up.to)"
    }

    private func next(_ hero: HeroStanding) -> String {
        guard let goal = SRD.xpForNextLevel(after: hero.level) else { return "At the highest level" }
        return hero.xp >= goal ? "Ready for level \(hero.level + 1)" : "\(goal - hero.xp) XP to level \(hero.level + 1)"
    }
}

extension GameSession {
    /// The labels a round of a fight is stored under. The chronicle has no flag for a round, and a
    /// server may report the most-voted of these as the round's `choiceLabel`.
    private static let roundLabels: Set<String> = ["Attack", "Cast", "Dodge"]

    /// What the party did in a resolved scene, as a line: "The party chose: Open the door". Nil
    /// for a round of a fight, where each hero acted for themselves: an entry with no choice
    /// label, one this session saw as a round, or one labelled with a bare combat action.
    func deed(of entry: ChronicleEntry) -> String? {
        if entry.choiceLabel.isEmpty || combatScenes.contains(entry.index) { return nil }
        if state.rules != nil && Self.roundLabels.contains(entry.choiceLabel) { return nil }
        return "The party chose: \(entry.choiceLabel)"
    }
}

/// Choices are lettered by where they stand in the list; their ids are the server's business.
enum ChoiceLetter {
    static func at(_ index: Int) -> String {
        String(UnicodeScalar(UInt8(65 + max(0, index) % 26)))
    }
}

/// The hour and what the party sees by: "Day 1, 08:40", "Torch, 40 min left (Bryn)" or "Dark, and
/// no light". Under it, what the caller's own hero can make out when that is less than everything.
struct TimeAndLight: View {
    let clock: GameClock?
    let light: PartyLight?
    let mine: HeroStanding?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 14) {
                if let clock, !clock.label.isEmpty {
                    Label(clock.label, systemImage: "clock")
                }
                if let light {
                    Label(lightText(light), systemImage: lightSymbol(light))
                        .foregroundStyle(light.source != nil ? Palette.gold : Palette.muted)
                }
            }
            .font(.system(.caption, design: .serif, weight: .semibold))
            .foregroundStyle(Palette.muted)
            .labelStyle(.titleAndIcon)
            if let mine, mine.isUp, let warning = sightWarning(mine) {
                Label(warning, systemImage: mine.cannotSee ? "eye.slash.fill" : "eye.trianglebadge.exclamationmark")
                    .font(.footnote)
                    .foregroundStyle(mine.cannotSee ? Palette.ember : Palette.parchment.opacity(0.85))
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let mine, mine.isUp {
                // What the caller's hero carries from scene to scene, and how each ends.
                ForEach(mine.conditions, id: \.self) { held in
                    Label("\(mine.name) is \(held.line).", systemImage: "exclamationmark.triangle.fill")
                        .font(.footnote)
                        .foregroundStyle(Palette.ember)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let spell = mine.concentratingOn, !spell.isEmpty {
                    Label("\(mine.name) is concentrating on \(spell).", systemImage: "sparkles")
                        .font(.footnote)
                        .foregroundStyle(Palette.gold)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func lightText(_ light: PartyLight) -> String {
        if let source = light.source {
            let left = source.minutesLeft >= 120 ? "\(source.minutesLeft / 60) h left" : "\(source.minutesLeft) min left"
            return source.holder.isEmpty ? "\(source.name), \(left)" : "\(source.name), \(left) (\(source.holder))"
        }
        switch light.level {
        case "dark": return "Dark, and no light"
        case "dim": return "Dim light"
        default: return "Well lit"
        }
    }

    private func lightSymbol(_ light: PartyLight) -> String {
        if light.source != nil { return "flame.fill" }
        switch light.level {
        case "dark": return "moon.fill"
        case "dim": return "cloud.sun.fill"
        default: return "sun.max.fill"
        }
    }

    private func sightWarning(_ hero: HeroStanding) -> String? {
        if hero.cannotSee {
            return "\(hero.name) cannot see here. Perception and Investigation fail, traps go unseen, and in a fight \(hero.name) is blinded."
        }
        if hero.seesDimly {
            return hero.darkvision > 0
                ? "\(hero.name) sees dimly by darkvision: Perception is rolled twice and the worse die counts."
                : "\(hero.name) sees only dimly: Perception is rolled twice and the worse die counts."
        }
        return nil
    }
}

/// The narrator's controls above a scene's telling: hear it read, and whether every scene is read
/// as it arrives.
struct NarratorBar: View {
    let scene: GameScene
    let session: GameSession
    @Bindable var narrator: Narrator

    /// What the narrator is doing about this scene (a reading of another scene is not this one's).
    private var phase: Narrator.Phase { narrator.phase.scene == scene.index ? narrator.phase : .idle }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 10) {
                Button { narrator.toggle(scene, in: session) } label: { listen }
                    .buttonStyle(.plain)
                    .accessibilityHint("The narrator reads this scene aloud")
                Spacer(minLength: 8)
                Button { narrator.readsEveryScene.toggle() } label: {
                    Label("Every scene", systemImage: narrator.readsEveryScene ? "checkmark.circle.fill" : "circle")
                        .font(.system(.caption, design: .serif, weight: .semibold))
                        .foregroundStyle(narrator.readsEveryScene ? Palette.gold : Palette.muted)
                        .padding(.vertical, 8)
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Read every scene aloud")
                .accessibilityAddTraits(narrator.readsEveryScene ? .isSelected : [])
            }
            if case .failed = phase {
                Text("The narrator lost the page. Tap Listen to try again.")
                    .font(.footnote)
                    .foregroundStyle(Palette.ember)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if narrator.offered.count > 1, let name = narrator.voiceName { voices(reading: name) }
        }
    }

    /// Who reads: the voice in use, and a menu of the others. Picking one while a reading is under way
    /// starts it over in the new voice.
    private func voices(reading name: String) -> some View {
        Menu {
            ForEach(narrator.offered) { voice in
                Button { narrator.choose(voice.id, hearing: scene, in: session) } label: {
                    if voice.id == narrator.voice { Image(systemName: "checkmark") }
                    Text(voice.name)
                    if !voice.description.isEmpty { Text(voice.description) }
                }
            }
        } label: {
            HStack(spacing: 5) {
                Text("Read by \(name)")
                Image(systemName: "chevron.up.chevron.down").font(.system(size: 9, weight: .semibold))
            }
            .font(.system(.caption, design: .serif))
            .foregroundStyle(Palette.muted)
            .padding(.vertical, 4)
            .contentShape(.rect)
        }
        .accessibilityLabel("Narrator voice: \(name)")
        .accessibilityHint("Chooses who reads the scenes aloud")
    }

    private var listen: some View {
        HStack(spacing: 8) {
            switch phase {
            case .preparing:
                ProgressView().controlSize(.small).tint(Palette.gold)
                Text("The narrator draws breath…")
            case .playing:
                Image(systemName: "stop.fill")
                Text("Stop")
                Image(systemName: "waveform").symbolEffect(.variableColor.iterative, options: .repeating)
            case .idle, .failed:
                Image(systemName: "speaker.wave.2.fill")
                Text("Listen")
            }
        }
        .font(.system(.subheadline, design: .serif, weight: .semibold))
        .foregroundStyle(Palette.gold)
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(Palette.raised, in: .capsule)
        .overlay { Capsule().strokeBorder(Palette.gold.opacity(0.45), lineWidth: 1) }
        .contentShape(.capsule)
        .animation(.easeInOut(duration: 0.2), value: phase)
    }
}

/// Foes the party is facing: who they are, how hard they are, how they take to the party.
struct WaitingFoesNotice: View {
    let waiting: WaitingFoes

    private var tint: Color { waiting.isHostile ? Palette.ember : Palette.verdigris }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: waiting.isHostile ? "flame.fill" : waiting.isFriendly ? "hand.wave.fill" : "eye.fill")
                .font(.system(size: 17))
                .foregroundStyle(tint)
                .frame(width: 26)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text("Here: \(waiting.foes)")
                    .font(.display(16))
                    .fixedSize(horizontal: false, vertical: true)
                if let rating = waiting.rating {
                    Text(rating)
                        .font(.serif(.subheadline, weight: .semibold))
                        .foregroundStyle(Danger.tint(waiting.band))
                        .fixedSize(horizontal: false, vertical: true)
                }
                Text(waiting.note)
                    .font(.footnote)
                    .foregroundStyle(Palette.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(tint.opacity(0.10), in: .rect(cornerRadius: 12))
        .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(tint.opacity(0.45), lineWidth: 1) }
        .accessibilityElement(children: .combine)
    }
}

/// The rules label of a choice ("Athletics check, DC 12", "Fight: 2 Goblin Warriors", "Short
/// rest", "Parley"), with a symbol and a tint for the kind of thing it is.
struct RuleTag: Equatable {
    let text: String
    let symbol: String
    let tint: Color

    /// Nil when the choice has no rules to it.
    init?(label: String?, dungeon: DungeonMap? = nil) {
        guard let label = label?.trimmingCharacters(in: .whitespaces), !label.isEmpty else { return nil }
        let lower = label.lowercased()
        if lower.hasPrefix("go on") || lower.hasPrefix("back to ") {
            // A way on, named by the server: "Go on (locked door)", "Back to Narthex (open passage)".
            text = Self.wayOn(label, in: dungeon)
            symbol = lower.hasPrefix("back to ") ? "arrow.uturn.backward" : "door.left.hand.open"
            tint = Palette.gold
        } else if lower.hasPrefix("fight") {
            (text, symbol, tint) = (label, "flame.fill", Palette.ember)
        } else if lower == "run" {
            (text, symbol, tint) = (label, "arrow.uturn.backward", Palette.gold)
        } else if lower.hasSuffix("rest") {
            (text, symbol, tint) = (label, "moon.zzz.fill", Palette.verdigris)
        } else if lower.hasPrefix("buy") || lower.hasPrefix("sell") {
            (text, symbol, tint) = (label, "bag.fill", Palette.gold)
        } else if lower.hasPrefix("drink") {
            (text, symbol, tint) = (label, "cross.vial.fill", Palette.verdigris)
        } else if lower.hasPrefix("parley") {
            (text, symbol, tint) = (label, "bubble.left.and.bubble.right.fill", Palette.verdigris)
        } else if lower.hasPrefix("raise the dead") {
            (text, symbol, tint) = (label, "sparkles", Palette.gold)
        } else if lower.hasPrefix("risk") || lower.hasPrefix("hazard") {
            (text, symbol, tint) = (label, "exclamationmark.triangle.fill", Palette.ember)
        } else {
            (text, symbol, tint) = (label, "dice.fill", Palette.verdigris)
        }
    }

    /// A check or a saving throw: something the hero's d20 is rolled for.
    static func isRoll(_ label: String) -> Bool {
        let lower = label.lowercased()
        return lower.contains(" check") || lower.contains(" save")
    }

    /// The way as the server names it. An older server named the exit by its id instead
    /// ("Go on (r2)"): that one is told from the map, "Way on · Stairs, unexplored".
    private static func wayOn(_ label: String, in dungeon: DungeonMap?) -> String {
        guard let open = label.firstIndex(of: "("), let close = label.lastIndex(of: ")"), open < close else { return label }
        let named = String(label[label.index(after: open)..<close])
        guard let dungeon, let exit = dungeon.here?.exits.first(where: { $0.id == named }) else { return label }
        let way = SRD.phrase(exit.connection)
        if let known = dungeon.area(exit.to) { return "Way back · \(way) to \(DungeonNames.label(known))" }
        return "Way on · \(way), unexplored"
    }
}

private struct ChoiceCard: View {
    let choice: Choice
    let letter: String
    let rule: RuleTag?
    let voters: [GamePlayer]
    let mine: Bool
    let enabled: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: 14) {
                Text(letter)
                    .font(.display(18, weight: .bold))
                    .foregroundStyle(mine ? Palette.ink : Palette.gold)
                    .frame(width: 34, height: 34)
                    .background(mine ? Palette.gold : Palette.raised, in: .circle)
                VStack(alignment: .leading, spacing: 6) {
                    Text(choice.label).font(.display(17)).multilineTextAlignment(.leading)
                    if !choice.detail.isEmpty {
                        Text(choice.detail).font(.footnote).foregroundStyle(Palette.muted).multilineTextAlignment(.leading)
                    }
                    if let rule {
                        Label(rule.text, systemImage: rule.symbol)
                            .font(.system(.caption, design: .serif, weight: .semibold))
                            .foregroundStyle(rule.tint)
                            .multilineTextAlignment(.leading)
                            .padding(.horizontal, 9)
                            .padding(.vertical, 5)
                            .background(rule.tint.opacity(0.13), in: .rect(cornerRadius: 8))
                            .overlay { RoundedRectangle(cornerRadius: 8).strokeBorder(rule.tint.opacity(0.4), lineWidth: 0.75) }
                            .accessibilityLabel("Rules: \(rule.text)")
                    }
                    if !voters.isEmpty {
                        HStack(spacing: -8) {
                            ForEach(voters) { voter in
                                PortraitView(url: voter.character.portraitURL, size: 26, circular: true)
                            }
                            Text(voters.count == 1 ? voters[0].character.name : "\(voters.count) votes")
                                .font(.caption)
                                .foregroundStyle(Palette.muted)
                                .padding(.leading, 14)
                        }
                        .transition(.opacity)
                    }
                }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .card(highlighted: mine)
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .animation(.snappy, value: voters.map(\.playerId))
        .accessibilityAddTraits(mine ? .isSelected : [])
    }
}

/// While the dungeon master weighs the votes (or tells the round of a fight): everyone's d20, laid
/// out on the table.
struct ResolvingOverlay: View {
    let scene: GameScene
    let players: [GamePlayer]

    var body: some View {
        ZStack {
            Palette.ink.opacity(0.82).ignoresSafeArea()
            VStack(spacing: 22) {
                Text(scene.combat ? "Steel rings. The round plays out…" : "The dungeon master weighs your fates…")
                    .font(.display(22, weight: .bold))
                    .multilineTextAlignment(.center)
                if scene.votes.count <= 4 {
                    HStack(alignment: .top, spacing: 18) {
                        ForEach(scene.votes, id: \.playerId) { fate($0) }
                    }
                } else {
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: 3), spacing: 16) {
                        ForEach(scene.votes, id: \.playerId) { fate($0) }
                    }
                }
                ProgressView().tint(Palette.gold)
            }
            .padding(28)
            .background(Palette.ink, in: .rect(cornerRadius: 18))
            .overlay { RoundedRectangle(cornerRadius: 18).strokeBorder(Palette.gold.opacity(0.5)) }
            .shadow(color: .black.opacity(0.6), radius: 24)
            .padding(24)
        }
        .transition(.opacity)
    }

    private func fate(_ vote: Vote) -> some View {
        VStack(spacing: 8) {
            PortraitView(url: players.first { $0.playerId == vote.playerId }?.character.portraitURL,
                         size: 52, circular: true)
            D20Badge(roll: vote.roll, size: 40)
            if scene.combat {
                // In a fight each vote is that hero's own action: the third depends on their moment.
                Text(vote.action.verb).font(.caption.bold()).foregroundStyle(Palette.muted)
                    .lineLimit(1).minimumScaleFactor(0.7)
            } else if let index = scene.choices.firstIndex(where: { $0.id == vote.choiceId }) {
                Text(ChoiceLetter.at(index)).font(.caption.bold()).foregroundStyle(Palette.muted)
            }
        }
    }
}

/// The moment the caller's hero gains a level: stays up until they send it away.
struct LevelUpOverlay: View {
    let notice: LevelUp
    let dismiss: () -> Void
    /// Opens a sheet from a screen that has no Sheet tab. The tabbed play screen omits it.
    var showSheet: (() -> Void)? = nil
    @State private var lit = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            Palette.ink.opacity(0.86).ignoresSafeArea()
                .onTapGesture(perform: dismiss)
            VStack(spacing: 14) {
                Image(systemName: "star.fill")
                    .font(.system(size: 44))
                    .foregroundStyle(LinearGradient(colors: [Color(hex: "#F0C66B"), Palette.gold], startPoint: .top, endPoint: .bottom))
                    .shadow(color: Palette.gold.opacity(0.8), radius: lit ? 22 : 6)
                    .scaleEffect(lit ? 1 : 0.4)
                    .rotationEffect(.degrees(lit ? 0 : -90))
                SectionLabel("Level up")
                Text("Level \(notice.level)")
                    .font(.display(44, weight: .bold))
                    .foregroundStyle(Palette.gold)
                Text("\(notice.heroName) grows stronger.")
                    .font(.prose.italic())
                    .multilineTextAlignment(.center)
                if !gains.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(gains, id: \.self) { gain in
                            Label(gain, systemImage: "plus.circle.fill")
                                .font(.proseSmall.weight(.semibold))
                                .foregroundStyle(Palette.parchment)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(14)
                    .card()
                }
                if let showSheet {
                    Button("See the sheet", action: showSheet).buttonStyle(.gilded)
                }
                Button("Onward", action: dismiss).buttonStyle(.gildedOutline)
            }
            .padding(26)
            .frame(maxWidth: 420)
            .background(Palette.ink, in: .rect(cornerRadius: 20))
            .overlay { RoundedRectangle(cornerRadius: 20).strokeBorder(Palette.gold.opacity(0.8), lineWidth: 1.5) }
            .shadow(color: Palette.gold.opacity(0.35), radius: 30)
            .padding(24)
            .scaleEffect(lit ? 1 : 0.85)
        }
        .foregroundStyle(Palette.parchment)
        .transition(.opacity)
        .onAppear {
            withAnimation(reduceMotion ? nil : .spring(duration: 0.7, bounce: 0.45)) { lit = true }
        }
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isModal)
    }

    private var gains: [String] {
        var lines: [String] = []
        if let hp = notice.hpGained, hp > 0 { lines.append("\(hp) more hit points") }
        lines += notice.newFeatures
        return lines
    }
}
