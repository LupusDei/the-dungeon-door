import SwiftUI

/// What makes a new turn on the story page: the scene, the round of a fight, and the narration.
/// A poll that only brings votes, chat, typing, or a finished picture does not change it.
private struct StoryTurn: Equatable {
    let index: Int
    let round: Int
    let narration: String
}

/// The narrative pane: the scene, what the table offers, a freeform action, and the last dice.
struct PlayStoryPage: View {
    @Environment(AppModel.self) private var model
    @Bindable var session: GameSession
    var narrator: Narrator
    var focusOffers: Int
    /// Offer-focuses the shell has already scrolled to. A later visit must not jump down again.
    @Binding var offersSeen: Int
    /// A move that is made on the map: the shell shows it.
    var openMap: () -> Void = {}

    @State private var freeform = ""
    @State private var spoken = ""
    /// The quick-action wheel that is open, and where the button that opened it sits.
    @State private var wheel: WheelKind?
    @State private var wheelOrigin = CGPoint.zero
    @State private var wheelLaunched = false

    private var state: GameState { session.state }
    private var scene: GameScene? { state.scene }
    private var inCombat: Bool { scene?.combat == true }
    private var canSend: Bool { PlayTurn.canSend(status: state.status, scene: scene, busy: session.busy) }
    /// The table is choosing and this hero has a say: a wheel may be open. (Not `canSend`: a request
    /// of the player's own in flight must not shut it.)
    private var choosing: Bool { PlayTurn.canSend(status: state.status, scene: scene, busy: false) }

    /// Scene, combat round, and narration. Votes, chat, typing, and a picture finishing leave it
    /// the same, so the story scrolls home once per turn and not on every poll.
    private var storyTurn: StoryTurn {
        StoryTurn(index: scene?.index ?? -1,
                  round: state.rules?.combat?.round ?? 0,
                  narration: scene?.narration ?? "")
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    header
                    if state.rules?.time != nil || state.rules?.light != nil {
                        TimeAndLight(clock: state.rules?.time, light: state.rules?.light,
                                     mine: state.standing(session.playerId))
                    }
                    IllustrationView(url: scene?.imageURL, aspect: 16 / 10)
                    if let scene {
                        NarratorBar(scene: scene, session: session, narrator: narrator)
                    }
                    narration
                    speakBox
                    if inCombat, let combat = state.rules?.combat {
                        initiative(combat)
                    }
                    if !inCombat, let waiting = state.rules?.dungeon?.waiting {
                        WaitingFoesNotice(waiting: waiting)
                    }
                    // Where the Act bar's Choose and Change bring the player: the die to throw when one is
                    // waiting, and the box to say what they do. (The mark sat on the die alone, so before a
                    // turn was declared Choose had nowhere to scroll to.)
                    VStack(alignment: .leading, spacing: 16) {
                        declaredDie
                        quickActions
                        freeformBox
                    }
                    .id("offers")
                    if let scene {
                        ChoiceWaitPanel(session: session, scene: scene)
                    }
                    if scene?.isFinale == true { finale }
                    dice
                    ErrorLine(text: session.error)
                    Color.clear.frame(height: 28)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .frame(maxWidth: 720)
                .frame(maxWidth: .infinity)
                .id("storyTop")
            }
            .scrollDismissesKeyboard(.interactively)
            .overlay {
                if state.status == .resolving, let scene = state.scene {
                    ResolvingOverlay(scene: scene, players: state.players, coversChrome: false)
                }
            }
            // The quick-action wheel lays over the page, in the space its buttons report their places in.
            .overlay { wheelOverlay }
            .coordinateSpace(.named(ActionWheel.space))
            .animation(.easeOut(duration: 0.18), value: wheel)
            // A wheel belongs to the turn it was opened in.
            .onChange(of: storyTurn) { wheel = nil }
            .onChange(of: choosing) { _, still in if !still { wheel = nil } }
            .task(id: storyTurn) {
                // Runs when the page appears and whenever the turn changes. Appearance covers a
                // turn that arrived while another tab was showing: this page is built then, already
                // meant to open on the narration. Choose still wins when it asked for the offers.
                guard focusOffers <= offersSeen else { return }
                try? await Task.sleep(for: .milliseconds(50))
                guard !Task.isCancelled, focusOffers <= offersSeen else { return }
                withAnimation(.easeInOut(duration: 0.45)) {
                    proxy.scrollTo("storyTop", anchor: .top)
                }
            }
            .task(id: focusOffers) {
                guard focusOffers > offersSeen else { return }
                let turn = storyTurn
                offersSeen = focusOffers
                try? await Task.sleep(for: .milliseconds(80))
                guard !Task.isCancelled, storyTurn == turn else { return }
                withAnimation(.easeInOut(duration: 0.25)) { proxy.scrollTo("offers", anchor: .top) }
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            SectionLabel(eyebrow)
            Text(scene?.title ?? state.title ?? "The door")
                .font(.display(26, weight: .bold))
                .fixedSize(horizontal: false, vertical: true)
            if let quest = state.rules?.quest { questLine(quest) }
            ScenesToGo(session: session)
        }
    }

    /// The quest's goal, and where it lies, or that it is done.
    private func questLine(_ quest: QuestGoal) -> some View {
        let place = quest.where.map { " — \($0)" } ?? ""
        return Label(quest.reached ? "Quest done: \(quest.goal)" : "Quest: \(quest.goal)\(place)",
                     systemImage: quest.reached ? "checkmark.seal" : "scope")
            .font(.serif(.footnote, weight: .semibold))
            .foregroundStyle(quest.reached ? Palette.gold : Palette.parchment)
            .multilineTextAlignment(.leading)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.top, 2)
    }

    private var eyebrow: String {
        guard let scene else { return "Between scenes" }
        if scene.isFinale { return "Finale" }
        if scene.combat, let combat = state.rules?.combat {
            let band = combat.band.map { " · a \($0) fight" } ?? ""
            return "Battle · Round \(combat.round)\(band)"
        }
        if let dungeon = state.rules?.dungeon, let here = dungeon.here {
            let level = dungeon.levelReached.map { " · Level \($0)" } ?? ""
            return "\(dungeon.kind)\(level) · \(DungeonNames.label(here))"
        }
        return state.sceneCounter(scene)
    }

    private var narration: some View {
        let text = scene?.narration ?? ""
        let paragraphs = text.components(separatedBy: "\n")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
        return VStack(alignment: .leading, spacing: 10) {
            if let scene, scene.index > 0, let last = state.chronicle?.last, last.index == scene.index - 1 {
                if let deed = session.deed(of: last) {
                    Text(deed).font(.proseSmall.weight(.semibold)).foregroundStyle(Palette.gold)
                }
                if !last.outcome.isEmpty {
                    Text(last.outcome).font(.proseSmall.italic()).foregroundStyle(Palette.parchment.opacity(0.85))
                }
            }
            if paragraphs.isEmpty {
                Text("The dungeon master is still writing…")
                    .font(.proseSmall.italic())
                    .foregroundStyle(Palette.muted)
            }
            ForEach(Array(paragraphs.enumerated()), id: \.offset) { _, paragraph in
                Text(paragraph)
                    .font(.system(size: 17, design: .serif))
                    .lineSpacing(4)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
            }
            if let lines = scene?.roleplay, !lines.isEmpty {
                ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                    Text("\(line.characterName): \(line.text)")
                        .font(.proseSmall.italic())
                        .foregroundStyle(Palette.gold)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .accessibilityLabel("The dungeon master's narration")
    }

    /// A line or a deed in character. No roll. Distinct from the action written below.
    private var speakBox: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel("In character")
            Text("What your hero says or does, with no roll. The narrator answers it.")
                .font(.serif(.caption))
                .foregroundStyle(Palette.muted)
            HStack(alignment: .bottom, spacing: 10) {
                TextField("Say or do…", text: $spoken, axis: .vertical)
                    .font(.prose)
                    .lineLimit(1...3)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .card()
                Button {
                    let text = spoken
                    spoken = ""
                    Task { await session.speakInCharacter(text) }
                } label: {
                    Image(systemName: "quote.bubble.fill").font(.system(size: 28))
                }
                .disabled(spoken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || session.busy || state.status != .voting)
                .accessibilityLabel("Speak in character")
            }
        }
    }

    private func initiative(_ combat: Combat) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                SectionLabel("Initiative")
                Spacer()
                if let band = combat.band {
                    Text("\(band) fight")
                        .font(.system(size: 11, weight: .semibold, design: .serif))
                        .foregroundStyle(Palette.ember)
                }
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(Array(combat.combatants.enumerated()), id: \.element.id) { index, combatant in
                        chip(combatant, place: index + 1)
                    }
                }
            }
            .scrollClipDisabled()
        }
    }

    private func chip(_ combatant: Combatant, place: Int) -> some View {
        let out = !combatant.isUp
        let tint = combatant.isFoe ? Palette.ember : Palette.verdigris
        let row = HStack(spacing: 5) {
            Text("\(place)")
                .font(.system(size: 10, weight: .bold, design: .serif))
                .foregroundStyle(Palette.muted)
            Text(combatant.name)
                .font(.system(size: 12, weight: .semibold, design: .serif))
                .fixedSize(horizontal: false, vertical: true)
                .foregroundStyle(out ? Palette.muted : combatant.id == session.playerId ? Palette.gold : Palette.parchment)
            if let position = combatant.position, !out {
                Text(position)
                    .font(.system(size: 10, design: .serif))
                    .foregroundStyle(position == "engaged" ? Palette.parchment.opacity(0.9) : Palette.muted)
            }
            Text(out ? statusWord(combatant) : combatant.wound ?? "\(combatant.hp)")
                .font(.system(size: 11, design: .serif))
                .monospacedDigit()
                .foregroundStyle(out ? Palette.ember : Palette.muted)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .background(Palette.surface, in: Capsule(style: .circular))
        .overlay { Capsule(style: .circular).strokeBorder(tint.opacity(out ? 0.25 : 0.7), lineWidth: 1) }
        return row
    }

    private func statusWord(_ combatant: Combatant) -> String {
        switch combatant.status {
        case "dead": combatant.isFoe ? "Slain" : "Dead"
        case "dying": "Dying"
        case "stable": "Stable"
        default: SRD.name(combatant.status)
        }
    }

    /// The d20 the server is holding. A tap or a flick throws it; the face is the server's.
    @ViewBuilder private var declaredDie: some View {
        if let die = scene?.myDie, canSend {
            ThrowDie(die: die) {
                Task { await session.throwDie() }
            }
        }
    }

    /// The two wheels of quick actions, right above the box: the same turn, without the typing.
    @ViewBuilder private var quickActions: some View {
        if let scene, !scene.isFinale, scene.canAct, !scene.actions.isEmpty {
            QuickActionBar(scene: scene, enabled: canSend) { kind, frame in
                wheelOrigin = CGPoint(x: frame.midX, y: frame.midY)
                wheel = kind
            }
            .onGeometryChange(for: CGPoint.self) { proxy in
                let frame = proxy.frame(in: .named(ActionWheel.space))
                return CGPoint(x: frame.midX, y: frame.midY)
            } action: { middle in
                // `-wheel <kind>`: open it without a tap, once the bar has a place on the page.
                guard !wheelLaunched, let asked = AppConfig.wheelArgument, canSend else { return }
                wheelLaunched = true
                wheelOrigin = CGPoint(x: asked == .actions ? middle.x * 0.5 : middle.x * 1.5, y: middle.y)
                wheel = asked
            }
        }
    }

    /// The wheel, over the page. Declaring from it sends the words in the box with the action.
    @ViewBuilder private var wheelOverlay: some View {
        if let kind = wheel, let scene, choosing {
            ActionWheel(kind: kind, title: QuickActions.name(kind, in: scene), actions: QuickActions.list(kind, in: scene),
                        origin: wheelOrigin) { action, targets in
                let words = freeform
                freeform = ""
                wheel = nil
                Task { await session.vote(actionId: action.id, targets: targets, intent: words) }
            } openMap: { _ in
                wheel = nil
                openMap()
            } close: {
                wheel = nil
            }
            .transition(.opacity)
        }
    }

    private var freeformBox: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel("What do you do?")
            Text("Say it in your own words. Name a skill if you are using one. Or pick an attack, spell, item, skill, or ability on your sheet and add how you use it.")
                .font(.serif(.caption))
                .foregroundStyle(Palette.muted)
                .fixedSize(horizontal: false, vertical: true)
            TextField("Say what you do…", text: $freeform, axis: .vertical)
                .font(.prose)
                .lineLimit(2...4)
                .padding(12)
                .card()
            Button("Send this action") {
                let text = freeform
                freeform = ""
                Task { await session.act(inOwnWords: text) }
            }
            .buttonStyle(.gilded)
            .disabled(!canSend || freeform.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            if scene?.myAction == nil, let written = scene?.myFreeform, !written.text.isEmpty {
                Text("Written: \(written.text)")
                    .font(.serif(.footnote).italic())
                    .foregroundStyle(Palette.gold)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var finale: some View {
        VStack(spacing: 12) {
            Text("The End").font(.display(24, weight: .bold))
            Text("Your tale is written in the chronicle.")
                .font(.proseSmall.italic())
                .foregroundStyle(Palette.muted)
                .multilineTextAlignment(.center)
            Button("Return to the tavern") { model.closeGame() }
                .buttonStyle(.gilded)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 4)
    }

    @ViewBuilder private var dice: some View {
        let lines = state.rules?.results ?? []
        if !lines.isEmpty {
            let heroes = state.rules?.party.map(\.name) ?? state.players.map(\.character.name)
            let round = state.rules?.combat?.round
            let title = inCombat ? (round.map { $0 > 1 ? "Round \($0 - 1)" : "How it began" } ?? "The dice") : "The dice"
            DiceLog(lines: lines, heroes: heroes, title: title)
        }
    }
}

/// A d20 the player throws. The tumble is local; the number is the one the server rolled when they declared.
struct ThrowDie: View {
    let die: PlayerDie
    var throwIt: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var tumbling = false
    @State private var drag = CGSize.zero

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel("Your die")
            Text("\(die.purpose). \(die.formula). Tap or flick it.")
                .font(.serif(.caption))
                .foregroundStyle(Palette.muted)
            HStack {
                Spacer()
                TumblingD20(size: 88)
                    .rotationEffect(.degrees(tumbling && !reduceMotion ? 360 : Double(drag.width)))
                    .offset(drag)
                    .gesture(flick)
                    .onTapGesture { launch() }
                    .accessibilityLabel("Throw \(die.formula) for \(die.purpose)")
                    .accessibilityAddTraits(.isButton)
                Spacer()
            }
        }
        .id("die")
    }

    private var flick: some Gesture {
        DragGesture(minimumDistance: 12)
            .onChanged { drag = $0.translation }
            .onEnded { value in
                drag = .zero
                let flick = hypot(value.predictedEndTranslation.width, value.predictedEndTranslation.height)
                if flick > 48 { launch() }
            }
    }

    private func launch() {
        guard !tumbling else { return }
        tumbling = true
        throwIt()
    }
}
