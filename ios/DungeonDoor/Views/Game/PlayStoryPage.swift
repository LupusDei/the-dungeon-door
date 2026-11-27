import SwiftUI

/// The narrative pane: the scene, what the table offers, a freeform action, and the last dice.
struct PlayStoryPage: View {
    @Environment(AppModel.self) private var model
    @Bindable var session: GameSession
    var narrator: Narrator
    var focusOffers: Int
    var onOffer: (TableOffer) -> Void

    @State private var freeform = ""
    @State private var spoken = ""

    private var state: GameState { session.state }
    private var scene: GameScene? { state.scene }
    private var inCombat: Bool { scene?.combat == true }
    private var canSend: Bool { PlayTurn.canSend(status: state.status, scene: scene, busy: session.busy) }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    header
                    if let party = state.rules?.party, !party.isEmpty {
                        PartyStrip(party: party, players: state.players, me: session.playerId)
                    }
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
                    offers
                    freeformBox
                    votes
                    if scene?.isFinale == true { finale }
                    dice
                    ErrorLine(text: session.error)
                    Color.clear.frame(height: 28)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .frame(maxWidth: 720)
                .frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboard(.interactively)
            .task(id: focusOffers) {
                guard focusOffers > 0 else { return }
                try? await Task.sleep(for: .milliseconds(80))
                guard !Task.isCancelled else { return }
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
        }
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
        return state.sceneCount > 0 ? "Scene \(scene.index + 1) of \(state.sceneCount)" : "Scene \(scene.index + 1)"
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

    private var offers: some View {
        let rows = scene.map { TableOffer.list(in: $0) } ?? []
        return VStack(alignment: .leading, spacing: 8) {
            SectionLabel(inCombat ? "Your action this round" : "The table offers")
            Text(inCombat
                 ? "A blow, a spell, a move, or another action. You can change it until the round resolves."
                 : "What the party does together. You can also write your own, below.")
                .font(.serif(.caption))
                .foregroundStyle(Palette.muted)
                .fixedSize(horizontal: false, vertical: true)
            if rows.isEmpty {
                Text("Nothing is on offer yet.")
                    .font(.serif(.footnote).italic())
                    .foregroundStyle(Palette.muted)
            }
            ForEach(Array(rows.enumerated()), id: \.element.id) { index, offer in
                offerButton(offer, index: index)
            }
        }
        .id("offers")
    }

    private func offerButton(_ offer: TableOffer, index: Int) -> some View {
        let selected = scene.map { offer.isChosen(in: $0, playerId: session.playerId) } ?? false
        let enabled = offer.available && canSend
        let opensMap = offer.kind == "move" && offer.action?.squares.isEmpty == false
        return Button { onOffer(offer) } label: {
            HStack(alignment: .top, spacing: 10) {
                Text(ChoiceLetter.at(index))
                    .font(.serif(.headline, weight: .bold))
                    .foregroundStyle(selected ? Palette.ink : Palette.gold)
                    .frame(width: 28, height: 28)
                    .background(selected ? Palette.gold : Palette.raised, in: Circle())
                VStack(alignment: .leading, spacing: 3) {
                    Text(offer.label)
                        .font(.serif(.body, weight: .semibold))
                        .foregroundStyle(enabled || selected ? Palette.parchment : Palette.muted)
                        .fixedSize(horizontal: false, vertical: true)
                    if !offer.detail.isEmpty {
                        Text(offer.detail)
                            .font(.serif(.footnote))
                            .foregroundStyle(Palette.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if offer.kind == "move", let action = offer.action, !action.squares.isEmpty {
                        Text("Pick a gold square on the map.")
                            .font(.serif(.caption, weight: .semibold))
                            .foregroundStyle(Palette.gold.opacity(0.85))
                    }
                    if let note = offer.note, !note.isEmpty {
                        Text(note)
                            .font(.serif(.caption, weight: .semibold))
                            .foregroundStyle(Palette.gold.opacity(0.85))
                    }
                    if let reason = offer.reason, !offer.available, !reason.isEmpty {
                        Text(reason)
                            .font(.serif(.caption))
                            .foregroundStyle(Palette.ember)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(12)
            .card(highlighted: selected)
        }
        .buttonStyle(.plain)
        .disabled(!offer.available || (!canSend && !opensMap))
        .opacity(enabled || selected || opensMap ? 1 : 0.55)
        .accessibilityLabel(offer.label)
    }

    private var freeformBox: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel("In your own words")
            Text("Say what you do. If it matches something on your sheet, it becomes that action.")
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
            if let written = scene?.myFreeform, !written.text.isEmpty {
                Text("Written: \(written.text)")
                    .font(.serif(.footnote).italic())
                    .foregroundStyle(Palette.gold)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    @ViewBuilder private var votes: some View {
        if let scene {
            VStack(alignment: .leading, spacing: 8) {
                SectionLabel("Votes")
                let others = scene.votes.filter { $0.playerId != session.playerId }
                if others.isEmpty && scene.freeforms.filter({ $0.playerId != session.playerId }).isEmpty {
                    Text(state.status == .voting ? "No one else has acted yet." : "No votes yet.")
                        .font(.serif(.footnote).italic())
                        .foregroundStyle(Palette.muted)
                }
                ForEach(others, id: \.playerId) { vote in
                    otherVote(vote, scene: scene)
                }
                let written = scene.freeforms.enumerated().filter { item in
                    item.element.playerId != nil && item.element.playerId != session.playerId
                }
                ForEach(written, id: \.offset) { item in
                    if let playerId = item.element.playerId {
                        HStack(spacing: 8) {
                            Text(state.player(playerId)?.character.name ?? "A hero")
                                .font(.caption.weight(.semibold))
                                .fixedSize(horizontal: false, vertical: true)
                            Text(item.element.text)
                                .font(.caption)
                                .foregroundStyle(Palette.muted)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
                waiting(scene)
            }
        }
    }

    private func otherVote(_ vote: Vote, scene: GameScene) -> some View {
        let hero = state.player(vote.playerId)?.character
        return HStack(spacing: 8) {
            PortraitView(url: hero?.portraitURL, size: 26, circular: true)
            Text(hero?.name ?? "A hero")
                .font(.caption.weight(.semibold))
                .fixedSize(horizontal: false, vertical: true)
            Text(voteWords(vote, scene: scene))
                .font(.caption)
                .foregroundStyle(Palette.muted)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            D20Badge(roll: vote.roll, size: 28)
        }
    }

    private func voteWords(_ vote: Vote, scene: GameScene) -> String {
        if let label = vote.label, !label.isEmpty { return label }
        if let actionId = vote.actionId, let action = scene.actions.first(where: { $0.id == actionId }) { return action.label }
        if let choice = scene.choices.first(where: { $0.id == vote.choiceId }), !choice.label.isEmpty { return choice.label }
        return "Voted"
    }

    @ViewBuilder private func waiting(_ scene: GameScene) -> some View {
        if state.status == .voting {
            let names = waitingNames(scene)
            if names.isEmpty {
                Text(scene.combat ? "Every action is in." : "All votes are in.")
                    .font(.proseSmall.italic())
                    .foregroundStyle(Palette.muted)
            } else {
                HStack(spacing: 8) {
                    ProgressView().tint(Palette.gold)
                    Text("Waiting on \(ListFormatter.localizedString(byJoining: names))…")
                        .font(.proseSmall.italic())
                        .foregroundStyle(Palette.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if session.isHost, scene.combat || !scene.votes.isEmpty || !scene.freeforms.isEmpty {
                    Button(scene.combat ? "Resolve the round now" : "Proceed without them") {
                        Task { await session.advance() }
                    }
                    .buttonStyle(.gildedOutline)
                    .disabled(session.busy)
                }
            }
        }
    }

    private func waitingNames(_ scene: GameScene) -> [String] {
        var acted = Set(scene.votes.map(\.playerId))
        for turn in scene.freeforms {
            if let playerId = turn.playerId { acted.insert(playerId) }
        }
        if scene.myVote != nil || scene.myAction != nil || scene.myFreeform != nil {
            acted.insert(session.playerId)
        }
        if scene.combat, let combat = state.rules?.combat {
            return combat.combatants.filter { !$0.isFoe && $0.isUp && !acted.contains($0.id) }
                .map { $0.id == session.playerId ? "you" : $0.name }
        }
        return state.players.filter { !acted.contains($0.playerId) }
            .map { $0.playerId == session.playerId ? "you" : $0.character.name }
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
