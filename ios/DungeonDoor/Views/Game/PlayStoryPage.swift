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
    /// Puts the result of the turn just played back on the table.
    var showLastTurn: () -> Void = {}

    @State private var freeform = ""
    @State private var spoken = ""
    /// A streamlined game folds the in-character box away; this is it opened.
    @State private var speaking = false
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
                    if brief { streamlinedStory } else { fullStory }
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

    /// A streamlined game (docs/app-tabs.md, "A streamlined game"): the page is cut down to what
    /// happened, what stands before the party, and the turn's choices.
    private var brief: Bool { state.isStreamlined }

    /// The full game's page, top to bottom.
    @ViewBuilder private var fullStory: some View {
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
        if !inCombat, let waiting = state.rules?.dungeon?.waiting {
            WaitingFoesNotice(waiting: waiting)
        }
        // Where the Act bar's Choose and Change bring the player: the die to throw when
        // one is waiting, the turn's choices, and under them the box to say it their way.
        if scene?.isFinale != true {
            VStack(alignment: .leading, spacing: 16) {
                declaredDie
                choicesList
                quickActions
                freeformBox
            }
            .id("offers")
            speakBox
        }
        if let scene {
            ChoiceWaitPanel(session: session, scene: scene)
        }
        if scene?.isFinale == true { finale }
        lastTurn
        dice
    }

    /// A streamlined game's page. It leads with what just happened, says what stands before the
    /// party in the scene's line or two, and goes straight to the choices. Nothing is explained
    /// under a heading and the dice are not listed twice. The painting is a band over the choices
    /// (a tap opens it whole). Under the turn come the narrator, who still reads on request, the
    /// clock and the light, speaking in character (folded away) and the quest.
    @ViewBuilder private var streamlinedStory: some View {
        header
        if let last = turnJustPlayed {
            TurnBrief(turn: last.result, outcome: last.outcome, me: session.playerId, showAll: showLastTurn)
        }
        sceneLine
        IllustrationView(url: scene?.imageURL, aspect: 3)
        if !inCombat, let waiting = state.rules?.dungeon?.waiting {
            WaitingFoesNotice(waiting: waiting)
        }
        if scene?.isFinale != true {
            VStack(alignment: .leading, spacing: 14) {
                declaredDie
                choicesList
                quickActions
                freeformBox
            }
            .id("offers")
        }
        if let scene {
            ChoiceWaitPanel(session: session, scene: scene)
        }
        if scene?.isFinale == true { finale }
        // Under the turn: the narrator, the clock and the light, a word in character, the quest.
        if let scene {
            NarratorBar(scene: scene, session: session, narrator: narrator)
        }
        if state.rules?.time != nil || state.rules?.light != nil {
            TimeAndLight(clock: state.rules?.time, light: state.rules?.light,
                         mine: state.standing(session.playerId))
        }
        if scene?.isFinale != true { speakFolded }
        questFoot
    }

    /// The turn before this scene, when the chronicle's last entry is it.
    private var turnJustPlayed: ChronicleEntry? {
        guard let scene, scene.index > 0, let last = state.chronicle?.last, last.index == scene.index - 1 else { return nil }
        return last
    }

    /// What stands before the party now: the scene's line or two, and what the heroes have said.
    private var sceneLine: some View {
        let text = (scene?.narration ?? "").components(separatedBy: "\n")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
            .joined(separator: " ")
        return VStack(alignment: .leading, spacing: 8) {
            Text(text.isEmpty ? "The dungeon master is still writing…" : text)
                .font(text.isEmpty ? .proseSmall.italic() : .system(size: 17, design: .serif))
                .foregroundStyle(text.isEmpty ? Palette.muted : Palette.parchment)
                .lineSpacing(4)
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
                .accessibilityIdentifier("scene-line")
            if let lines = scene?.roleplay, !lines.isEmpty {
                ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                    Text("\(line.characterName): \(line.text)")
                        .font(.proseSmall.italic())
                        .foregroundStyle(Palette.gold)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    /// Speaking in character, folded away until wanted: a streamlined game is about the turn.
    private var speakFolded: some View {
        DisclosureGroup(isExpanded: $speaking) {
            speakField.padding(.top, 8)
        } label: {
            SectionLabel("In character")
        }
        .tint(Palette.gold)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            SectionLabel(eyebrow)
            Text(scene?.title ?? state.title ?? "The door")
                .font(.display(brief ? 22 : 26, weight: .bold))
                .fixedSize(horizontal: false, vertical: true)
            // A streamlined game keeps the quest and the count of scenes at the foot of the page.
            if !brief {
                if let quest = state.rules?.quest { questLine(quest) }
                ScenesToGo(session: session)
            }
        }
    }

    /// The quest and how far there is to go, at the foot of a streamlined game's page: there every
    /// turn, and out of the way of what happened.
    private var questFoot: some View {
        VStack(alignment: .leading, spacing: 4) {
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
            speakField
        }
    }

    /// The field for a line in character, and its button.
    private var speakField: some View {
        HStack(alignment: .bottom, spacing: 10) {
            TextField("Say or do…", text: $spoken, axis: .vertical)
                .font(.prose)
                .lineLimit(1...3)
                .returnIsDone($spoken, label: .send, action: speak)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .card()
            Button(action: speak) {
                Image(systemName: "quote.bubble.fill").font(.system(size: 28))
            }
            .disabled(!canSpeak)
            .accessibilityLabel("Speak in character")
        }
    }

    /// The turn's choices. In a fight a hero with no spell is offered the same blow twice (as
    /// Attack and as Cast): it is listed once.
    private var offers: [TableOffer] {
        var seen = Set<String>()
        return (scene.map { TableOffer.list(in: $0) } ?? []).filter { seen.insert("\($0.label)|\($0.detail)").inserted }
    }

    /// What the table offers this turn: the plot's choices outside a fight, the hero's plain moves
    /// in one. A tap picks; another tap changes the pick until the turn resolves.
    @ViewBuilder private var choicesList: some View {
        let rows = offers
        if !rows.isEmpty, scene?.canAct == true {
            VStack(alignment: .leading, spacing: 8) {
                SectionLabel("What do you do?")
                if !brief {
                    Text(inCombat
                         ? "Your action this round. For a particular weapon, spell or item, use the wheels under these."
                         : "Pick one. The party goes with the choice most heroes pick, and where it calls for a roll, those who picked it make it.")
                        .font(.serif(.caption))
                        .foregroundStyle(Palette.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                ForEach(Array(rows.enumerated()), id: \.element.id) { index, offer in
                    choiceButton(offer, index: index)
                }
            }
        }
    }

    /// The player's own words, when they were counted as a pick of one of the cards.
    private var counted: (offer: String, words: String)? {
        scene.flatMap { PlayTurn.wordsCounted(in: $0, playerId: session.playerId) }
    }

    private func choiceButton(_ offer: TableOffer, index: Int) -> some View {
        let picked = scene.map { offer.isChosen(in: $0, playerId: session.playerId) } ?? false
        let words = picked ? counted.flatMap { $0.offer == offer.id ? $0.words : nil } : nil
        return Button {
            guard let choice = offer.choice else { return }
            Task { await session.vote(choice) }
        } label: {
            HStack(alignment: .top, spacing: 10) {
                Text(ChoiceLetter.at(index))
                    .font(.serif(.headline, weight: .bold))
                    .foregroundStyle(picked ? Palette.ink : Palette.gold)
                    .frame(width: 30, height: 30)
                    .background(picked ? Palette.gold : Palette.raised, in: Circle())
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 3) {
                    Text(offer.label)
                        .font(.serif(.body, weight: .semibold))
                        .foregroundStyle(Palette.parchment)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                    if !offer.detail.isEmpty {
                        Text(offer.detail)
                            .font(.serif(.footnote))
                            .foregroundStyle(Palette.muted)
                            .multilineTextAlignment(.leading)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if let note = offer.note, !note.isEmpty {
                        Label(note, systemImage: Self.rolls(note) ? "dice" : "arrow.turn.down.right")
                            .font(.serif(.caption, weight: .semibold))
                            .foregroundStyle(Palette.gold.opacity(0.9))
                            .multilineTextAlignment(.leading)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if picked {
                        Label("Your pick", systemImage: "checkmark.circle.fill")
                            .font(.serif(.caption, weight: .bold))
                            .foregroundStyle(Palette.verdigris)
                    }
                    if let words {
                        Text("From your words: “\(words)”")
                            .font(.serif(.caption).italic())
                            .foregroundStyle(Palette.muted)
                            .multilineTextAlignment(.leading)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(12)
            .background(Palette.surface, in: .rect(cornerRadius: 12))
            .overlay {
                RoundedRectangle(cornerRadius: 12)
                    .strokeBorder(picked ? Palette.gold : Palette.gold.opacity(0.25), lineWidth: picked ? 1.5 : 1)
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .disabled(!canSend)
        .opacity(canSend || picked ? 1 : 0.6)
        .accessibilityLabel([offer.label, offer.detail, offer.note ?? "", picked ? "your pick" : "",
                             words.map { "from your words: \($0)" } ?? ""]
            .filter { !$0.isEmpty }.joined(separator: ". "))
        .accessibilityHint(picked ? "" : "Picks this")
        .accessibilityIdentifier("choice-\(offer.choice?.id ?? offer.id)")
    }

    /// A choice's rules line names a roll ("Stealth check, DC 10", "DEX save") or just says what
    /// happens ("Fight: Wolf", "Go on").
    private static func rolls(_ note: String) -> Bool {
        let words = note.lowercased()
        return words.contains("check") || words.contains("save") || words.contains("parley")
    }

    /// The way back to the result of the turn just played, for whoever sent it away too soon.
    @ViewBuilder private var lastTurn: some View {
        if let last = state.chronicle?.last, last.result != nil, state.status != .resolving {
            Button(action: showLastTurn) {
                Label("How the last turn went", systemImage: "dice")
                    .font(.serif(.footnote, weight: .semibold))
            }
            .buttonStyle(.gildedOutline)
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
    /// They show when a wheel holds something the hero can do, which is to say in a fight.
    @ViewBuilder private var quickActions: some View {
        if let scene, !scene.isFinale, scene.canAct, QuickActions.worthShowing(in: scene) {
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

    private var canSpeak: Bool {
        !spoken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !session.busy && state.status == .voting
    }

    private func speak() {
        guard canSpeak else { return }
        let text = spoken
        spoken = ""
        Task { await session.speakInCharacter(text) }
    }

    private var canSendFreeform: Bool { canSend && !freeform.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    private func sendFreeform() {
        guard canSendFreeform else { return }
        let text = freeform
        freeform = ""
        Task { await session.act(inOwnWords: text) }
    }

    private var freeformBox: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(offers.isEmpty ? "What do you do?" : "Or in your own words")
            if !brief {
                Text(inCombat
                     ? "Say what you do instead, and name a skill if you are using one. The dungeon master judges it and you roll for it."
                     : "Say it your way: the dungeon master judges it and you roll for it. It is your own action beside the party's pick, unless it matches a choice above: then it counts as picking that choice, and an attack counts as picking the fight.")
                    .font(.serif(.caption))
                    .foregroundStyle(Palette.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            TextField("Say what you do…", text: $freeform, axis: .vertical)
                .font(.prose)
                .lineLimit(2...4)
                .returnIsDone($freeform, label: .send, action: sendFreeform)
                .padding(12)
                .card()
            Button("Send this action", action: sendFreeform)
            .buttonStyle(.gilded)
            .disabled(!canSendFreeform)
            if let counted, let offer = offers.first(where: { $0.id == counted.offer }) {
                Text("Your words count as picking: \(offer.label)")
                    .font(.serif(.footnote).italic())
                    .foregroundStyle(Palette.gold)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("words-counted")
            }
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
