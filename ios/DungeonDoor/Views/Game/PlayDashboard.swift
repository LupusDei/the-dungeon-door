import SwiftUI

/// The game, played from the hero's sheet.
///
/// Vitals stay pinned at the top and the eight common actions stay pinned at the bottom. Between
/// them, in an order that does not change, are the scene, the map and the freeform box, then
/// attacks, spells, items and features. A control the table is not offering greys out. It does not
/// move, and it does not disappear.
///
/// A tap votes an existing scene choice (`PlayBoard` decides which). Narrative choices that are
/// not a sheet action — a check, a rest, Engage, Run, Parley — are the three offers in the scene.
struct PlayDashboard: View {
    @Environment(AppModel.self) private var model
    @Bindable var session: GameSession
    var narrator: Narrator
    var openMap: () -> Void
    var openHero: (String) -> Void

    @State private var revealedRoll: Int?

    private var state: GameState { session.state }
    private var scene: GameScene? { state.scene }
    private var character: Character? { session.me?.character }
    private var sheet: CharacterSheet? { character?.sheet }
    private var live: LiveHero? { state.live(of: session.playerId) }
    private var book: RuleBook { RuleBook(reference: model.reference) }

    private var board: PlayBoard {
        PlayBoard(status: state.status, scene: scene, busy: session.busy,
                  attacks: character?.attacks ?? [], spellList: spellRefs, itemList: playItems,
                  featureNames: featureNames, resources: live?.standing.resources ?? [],
                  conditionList: playConditions, dungeon: state.rules?.dungeon)
    }

    var body: some View {
        ScrollViewReader { proxy in
            VStack(spacing: 0) {
                DashboardVitals(name: character?.name ?? "Hero", calling: calling,
                                portrait: character?.portraitURL, sheet: sheet, live: live,
                                combatant: state.rules?.combat?.combatant(session.playerId),
                                conditions: board.conditions,
                                showDown: scene?.combat == true && scene?.canAct == false,
                                selected: { selected($0) }, act: { act($0) })
                    .padding(.horizontal, 16)
                    .padding(.top, 6)
                    .padding(.bottom, 8)
                    .frame(maxWidth: 720)
                    .frame(maxWidth: .infinity)
                    .background(Palette.ink)
                    .overlay(alignment: .bottom) { Rectangle().fill(Palette.gold.opacity(0.2)).frame(height: 1) }
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        DashboardScenePanel(session: session, narrator: narrator, board: board,
                                            revealedRoll: revealedRoll, openHero: openHero, act: { act($0) })
                        mapAndFreeform
                        DashboardSheet(board: board, casting: sheet?.spellcasting,
                                       slotsLeft: live?.standing.slotsLeft, gold: gold,
                                       resources: live?.standing.resources ?? [],
                                       selected: { selected($0) }, act: { act($0) })
                        Color.clear.frame(height: 1).id("bottom")
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .frame(maxWidth: 720)
                    .frame(maxWidth: .infinity)
                }
                DashboardActionBar(controls: board.common, status: actionStatus,
                                    selected: { selected($0) }, act: { act($0) })
                    .frame(maxWidth: 720)
                    .frame(maxWidth: .infinity)
                    .background(Palette.ink)
            }
            .onChange(of: scene?.index) { _, _ in
                revealedRoll = nil
                withAnimation { proxy.scrollTo("scene", anchor: .top) }
            }
            .task(id: scene?.index) {
                narrator.offer(model.catalog)
                narrator.arrived(at: scene, in: session)
            }
            .onChange(of: model.catalog?.narrators) { _, _ in narrator.offer(model.catalog) }
            .task {
                guard let anchor = AppConfig.scrollToArgument else { return }
                try? await Task.sleep(for: .seconds(1.5))
                guard !Task.isCancelled else { return }
                proxy.scrollTo(anchor, anchor: anchor == "bottom" ? .bottom : .top)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .overlay {
            if state.status == .resolving, let scene {
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

    /// Map beside the freeform box when the phone is wide enough; one under the other when it is not.
    private var mapAndFreeform: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: 10) {
                DashboardMapPlaceholder(hasDungeon: state.rules?.dungeon != nil, openMap: openMap)
                    .frame(minWidth: 150)
                DashboardFreeform()
                    .frame(minWidth: 150)
            }
            VStack(spacing: 10) {
                DashboardMapPlaceholder(hasDungeon: state.rules?.dungeon != nil, openMap: openMap)
                DashboardFreeform()
            }
        }
    }

    private var actionStatus: String {
        if let vote = session.myVote, let scene {
            let label = scene.choices.first { $0.id == vote.choiceId }?.label ?? ""
            return label.isEmpty ? "Voted." : "Voted · \(label)"
        }
        if let hold = board.hold { return hold }
        return "Tap an action, or one of the scene's offers. You can change it until the table resolves."
    }

    private var gold: Double { live?.standing.gp ?? sheet?.gp ?? 0 }

    private func selected(_ control: PlayControl) -> Bool {
        guard control.affirmsVote, let id = control.choice?.id, let mine = scene?.myVote else { return false }
        return mine == id
    }

    private func act(_ control: PlayControl) {
        guard let choice = control.choice, control.enabled else { return }
        let first = scene?.myVote == nil
        Task {
            await session.vote(choice)
            if first, let roll = session.myVote?.roll {
                withAnimation(.spring(duration: 0.6, bounce: 0.5)) { revealedRoll = roll }
            }
        }
    }

    // MARK: Sheet facts the board matches against

    private var calling: String {
        guard let character else { return "" }
        let className = model.catalog?.name(character.characterClass, in: \.classes) ?? SRD.name(character.characterClass)
        guard !className.isEmpty else { return sheet.map { "Level \($0.level)" } ?? "" }
        return sheet.map { "Level \($0.level) \(className)" } ?? className
    }

    /// What the hero carries now, or the sheet's pack when the game has no live inventory.
    private var playItems: [EquipmentItem] {
        live?.standing.inventory ?? sheet?.equipment ?? []
    }

    private var spellRefs: [PlaySpellRef] {
        guard let casting = sheet?.spellcasting else { return [] }
        var seen = Set<String>()
        var refs: [PlaySpellRef] = []
        for id in casting.cantrips + casting.prepared where seen.insert(id).inserted {
            let name = book.spellName(id)
            let kind = casting.cantrips.contains(id) ? "Cantrip" : "Prepared"
            var bits = [book.spellLine(id) ?? "", kind].filter { !$0.isEmpty }
            let held = casting.concentratingOn == id
                || live?.standing.concentratingOn?.localizedCaseInsensitiveCompare(name) == .orderedSame
            if held { bits.insert("Active", at: 0) }
            refs.append(PlaySpellRef(id: id, name: name, line: bits.filter { !$0.isEmpty }.joined(separator: " · ")))
        }
        return refs
    }

    /// Class features, feats and the origin feat, skipping any name a resource already shows.
    private var featureNames: [String] {
        guard let sheet else { return [] }
        let taken = Set((live?.standing.resources ?? []).map { $0.name.lowercased() })
        var names: [String] = []
        var seen = Set<String>()
        func add(_ name: String) {
            let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
            let key = trimmed.lowercased()
            guard !trimmed.isEmpty, !taken.contains(key), seen.insert(key).inserted else { return }
            names.append(trimmed)
        }
        for feature in sheet.features { add(feature) }
        for id in sheet.feats { add(book.featName(id)) }
        add(sheet.feat)
        return names
    }

    private var playConditions: [PlayCondition] {
        var list: [PlayCondition] = []
        var seen = Set<String>()
        func add(_ condition: PlayCondition) {
            guard !condition.id.isEmpty, seen.insert(condition.id).inserted else { return }
            list.append(condition)
        }
        if let standing = live?.standing {
            if standing.isUp, standing.cannotSee {
                add(PlayCondition(id: "sight", name: "Cannot see", detail: "No light and no darkvision."))
            } else if standing.isUp, standing.seesDimly {
                add(PlayCondition(id: "sight", name: "Sees dimly",
                                  detail: "Perception is rolled twice and the worse die counts."))
            }
            for held in standing.conditions {
                add(PlayCondition(id: held.condition, name: book.conditionName(held.condition),
                                  detail: held.ending, needsEscape: held.needsEscape))
            }
            if let spell = standing.concentratingOn, !spell.isEmpty {
                add(PlayCondition(id: "concentration", name: "Concentrating on \(spell)",
                                  detail: "A hit forces a Constitution save to keep it."))
            }
        }
        if let combatant = state.rules?.combat?.combatant(session.playerId) {
            for id in combatant.conditions {
                add(PlayCondition(id: id, name: book.conditionName(id), detail: ""))
            }
        }
        if let penalty = sheet?.revivalPenalty, penalty > 0 {
            add(PlayCondition(id: "revival", name: "Weakened \u{2212}\(penalty)",
                              detail: "Raised from the dead. \u{2212}\(penalty) on every d20 roll."))
        }
        return list
    }
}

// MARK: - Scene

/// Narration, the party's votes, the dice, and the scene's own offers. The offers are how a
/// check, a rest, or Engage / Run / Parley is voted; in a fight they are the same three votes the
/// sheet casts.
private struct DashboardScenePanel: View {
    @Environment(AppModel.self) private var model
    @Bindable var session: GameSession
    var narrator: Narrator
    let board: PlayBoard
    var revealedRoll: Int?
    var openHero: (String) -> Void
    var act: (PlayControl) -> Void

    private var state: GameState { session.state }
    private var scene: GameScene? { state.scene }
    private var heroNames: [String] { state.rules?.party.map(\.name) ?? state.players.map(\.character.name) }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            header
            if let party = state.rules?.party, !party.isEmpty {
                PartyStrip(party: party, players: state.players, me: session.playerId, open: openHero)
            }
            if state.rules?.time != nil || state.rules?.light != nil {
                TimeAndLight(clock: state.rules?.time, light: state.rules?.light,
                             mine: state.standing(session.playerId))
            }
            IllustrationView(url: scene?.imageURL, aspect: 2.4)
            if let scene = scene {
                NarratorBar(scene: scene, session: session, narrator: narrator)
            }
            narration
            initiative
            if scene?.combat != true, let waiting = state.rules?.dungeon?.waiting {
                WaitingFoesNotice(waiting: waiting)
            }
            offers
            votes
            if scene?.isFinale == true { finale }
            dice
            ErrorLine(text: session.error)
        }
        .id("scene")
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
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                if let scene, scene.index > 0, let last = state.chronicle?.last, last.index == scene.index - 1 {
                    if let deed = session.deed(of: last) {
                        Text(deed).font(.proseSmall.weight(.semibold)).foregroundStyle(Palette.gold)
                    }
                    if !last.outcome.isEmpty {
                        Text(last.outcome).font(.proseSmall.italic()).foregroundStyle(Palette.parchment.opacity(0.85))
                    }
                }
                if let text = scene?.narration, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    ForEach(Array(paragraphs(text).enumerated()), id: \.offset) { _, paragraph in
                        Text(paragraph)
                            .font(.system(size: 17, design: .serif))
                            .lineSpacing(4)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .textSelection(.enabled)
                    }
                } else {
                    Text("The dungeon master is still writing…")
                        .font(.proseSmall.italic())
                        .foregroundStyle(Palette.muted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
        .frame(height: 132)
        .accessibilityLabel("The dungeon master's narration")
    }

    private func paragraphs(_ text: String) -> [String] {
        text.components(separatedBy: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    }

    /// Who is in the fight, or the same strip saying there is no fight, so the scene does not jump.
    private var initiative: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                SectionLabel("Initiative")
                Spacer()
                if let combat = state.rules?.combat, scene?.combat == true, let band = combat.band {
                    TagLabel("\(band) fight", tint: Danger.tint(band))
                }
            }
            if let combat = state.rules?.combat, scene?.combat == true, !combat.combatants.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(Array(combat.combatants.enumerated()), id: \.element.id) { index, combatant in
                            initiativeChip(combatant, place: index + 1)
                        }
                    }
                }
                .scrollClipDisabled()
                .fixedSize(horizontal: false, vertical: true)
            } else {
                Text("No one is in initiative order.")
                    .font(.serif(.footnote).italic())
                    .foregroundStyle(Palette.muted)
                    .frame(maxWidth: .infinity, minHeight: 36, alignment: .leading)
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, minHeight: 72, alignment: .topLeading)
        .card()
        .id("combat")
    }

    private func initiativeChip(_ combatant: Combatant, place: Int) -> some View {
        let out = !combatant.isUp
        let tint = combatant.isFoe ? Palette.ember : Palette.verdigris
        let chip = HStack(spacing: 5) {
            Text("\(place)")
                .font(.system(size: 10, weight: .bold, design: .serif))
                .foregroundStyle(Palette.muted)
            Text(combatant.name)
                .font(.system(size: 12, weight: .semibold, design: .serif))
                .lineLimit(1)
                .foregroundStyle(out ? Palette.muted : combatant.id == session.playerId ? Palette.gold : Palette.parchment)
            if let toughness = combatant.toughness {
                Text(toughness)
                    .font(.system(size: 10, weight: .semibold, design: .serif))
                    .foregroundStyle(out ? Palette.muted : Danger.tint(toughness))
            }
            Text(out ? statusWord(combatant) : combatant.wound ?? "\(combatant.hp)")
                .font(.system(size: 11, design: .serif))
                .monospacedDigit()
                .foregroundStyle(out ? Palette.ember : Palette.muted)
            if !out, let position = combatant.position {
                // The range band: in melee, about 30 feet off, or about 60.
                Text("\u{00B7} \(position)")
                    .font(.system(size: 10, design: .serif))
                    .foregroundStyle(position == "engaged" ? Palette.parchment.opacity(0.85) : Palette.muted)
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .background(Palette.surface, in: Capsule(style: .circular))
        .overlay { Capsule(style: .circular).strokeBorder(tint.opacity(out ? 0.25 : 0.7), lineWidth: 1) }
        .opacity(combatant.isDead ? 0.5 : 1)

        return Group {
            if combatant.isFoe {
                chip.accessibilityElement(children: .combine)
            } else {
                Button { openHero(combatant.id) } label: { chip }
                    .buttonStyle(.plain)
                    .accessibilityHint("Opens their character sheet")
            }
        }
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
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel("The table offers")
            Text(scene?.combat == true
                 ? "The same votes as the sheet: a weapon, a spell, and the third action."
                 : "What the party does, when it is not an action on the sheet.")
                .font(.serif(.caption))
                .foregroundStyle(Palette.muted)
                .fixedSize(horizontal: false, vertical: true)
            ForEach(Array(board.sceneOffers.enumerated()), id: \.element.id) { index, control in
                PlayRow(control: control, selected: selected(control), badge: ChoiceLetter.at(index)) { act(control) }
            }
        }
        .id("choices")
    }

    private func selected(_ control: PlayControl) -> Bool {
        guard control.affirmsVote, let id = control.choice?.id else { return false }
        return scene?.myVote == id
    }

    @ViewBuilder private var votes: some View {
        if let scene = scene {
            VStack(alignment: .leading, spacing: 8) {
                SectionLabel("Votes")
                if let vote = session.myVote {
                    myRoll(vote, scene: scene)
                }
                let others = scene.votes.filter { $0.playerId != session.playerId }
                if !others.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(others, id: \.playerId) { vote in
                            otherVote(vote, scene: scene)
                        }
                    }
                }
                waiting(scene)
            }
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        }
    }

    private func myRoll(_ vote: Vote, scene: GameScene) -> some View {
        HStack(spacing: 12) {
            D20Badge(roll: vote.roll, size: 44)
                .rotationEffect(.degrees(revealedRoll == nil ? 0 : 360))
                .scaleEffect(revealedRoll == nil ? 1 : 1.08)
            VStack(alignment: .leading, spacing: 2) {
                Text("Your d20").font(.display(15))
                Text(rollNote(vote, scene: scene))
                    .font(.footnote.italic())
                    .foregroundStyle(Palette.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .card()
        .accessibilityElement(children: .combine)
    }

    private func otherVote(_ vote: Vote, scene: GameScene) -> some View {
        let hero = state.player(vote.playerId)?.character
        return HStack(spacing: 8) {
            PortraitView(url: hero?.portraitURL, size: 26, circular: true)
            Text(hero?.name ?? "A hero").font(.caption.weight(.semibold)).lineLimit(1)
            Text(voteWords(vote, scene: scene))
                .font(.caption)
                .foregroundStyle(Palette.muted)
                .lineLimit(1)
            Spacer(minLength: 0)
            D20Badge(roll: vote.roll, size: 28)
        }
    }

    /// In a fight the vote carries that hero's own label. The same choice id is a different action
    /// for someone else, so the caller's label for it would be the wrong words.
    private func voteWords(_ vote: Vote, scene: GameScene) -> String {
        if scene.combat, let label = vote.label, !label.isEmpty { return label }
        if let choice = scene.choices.first(where: { $0.id == vote.choiceId }), !choice.label.isEmpty {
            return choice.label
        }
        return scene.combat ? vote.action.verb : "Voted"
    }

    private func rollNote(_ vote: Vote, scene: GameScene) -> String {
        if scene.combat {
            let chosen = scene.choices.first { $0.id == vote.choiceId }
            let kind = CombatAction(choiceId: vote.choiceId, label: chosen?.label ?? vote.label)
            return kind.rollNote ?? CombatView.castNote(chosen?.detail ?? "")
                ?? "Your roll to hit this round, before your bonus."
        }
        if let rule = scene.choices.first(where: { $0.id == vote.choiceId })?.rules, RuleTag.isRoll(rule) {
            return "Your roll for the \(rule.prefix(1).lowercased() + rule.dropFirst()), plus your hero's own bonus."
        }
        switch vote.roll {
        case 20: return "A natural 20! Fortune bends toward you."
        case 1: return "A natural 1. Something will go wrong."
        case 15...19: return "A strong roll."
        case 8...14: return "A fair roll. Fate is undecided."
        default: return "A poor roll. Tread carefully."
        }
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
                }
                if session.isHost, scene.combat || !scene.votes.isEmpty {
                    Button(scene.combat ? "Resolve the round now" : "Proceed without them") {
                        Task { await session.advance() }
                    }
                    .buttonStyle(.gildedOutline)
                    .disabled(session.busy)
                }
            }
        } else if state.status == .preparing {
            HStack(spacing: 8) {
                ProgressView().tint(Palette.gold)
                Text("The dungeon master is still writing…")
                    .font(.proseSmall.italic())
                    .foregroundStyle(Palette.muted)
            }
        } else if scene.votes.isEmpty {
            Text("No votes yet.")
                .font(.serif(.footnote).italic())
                .foregroundStyle(Palette.muted)
        }
    }

    private func waitingNames(_ scene: GameScene) -> [String] {
        let voted = Set(scene.votes.map(\.playerId))
        if scene.combat, let combat = state.rules?.combat {
            return combat.combatants.filter { !$0.isFoe && $0.isUp && !voted.contains($0.id) }
                .map { $0.id == session.playerId ? "you" : $0.name }
        }
        return state.players.filter { !voted.contains($0.playerId) }
            .map { $0.playerId == session.playerId ? "you" : $0.character.name }
    }

    private var finale: some View {
        VStack(spacing: 12) {
            Text("The End").font(.display(24, weight: .bold))
            Text(state.rules == nil
                 ? "Your tale is written in the chronicle."
                 : "Your tale is written in the chronicle, and what your heroes won goes home on their sheets.")
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
        if lines.isEmpty {
            DashboardSection(title: "The dice") {
                DashboardNote("No dice yet.")
            }
        } else {
            let round = state.rules?.combat?.round
            let title = scene?.combat == true ? (round.map { $0 > 1 ? "Round \($0 - 1)" : "How it began" } ?? "The dice") : "The dice"
            DiceLog(lines: lines, heroes: heroNames, title: title)
        }
    }
}
