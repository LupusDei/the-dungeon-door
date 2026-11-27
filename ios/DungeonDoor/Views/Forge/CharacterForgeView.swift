import SwiftUI

/// Create or edit a hero in five steps: who they are, their calling, their background (with the
/// character sheet it gives), their story, their portrait. The sheet step is skipped on a server
/// that has no backgrounds to offer.
struct CharacterForgeView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    enum Step: Int, CaseIterable {
        case identity, calling, sheet, story, portrait
        var title: String {
            switch self {
            case .identity: "Who"
            case .calling: "Calling"
            case .sheet: "Sheet"
            case .story: "Story"
            case .portrait: "Portrait"
            }
        }

        /// The step a `-forgeStep` launch argument names.
        init?(argument: String) {
            switch argument.lowercased() {
            case "identity", "who": self = .identity
            case "calling": self = .calling
            case "sheet": self = .sheet
            case "story": self = .story
            case "portrait": self = .portrait
            default: return nil
            }
        }
    }

    /// What a sheet was drawn up from. A sheet is only shown while this still matches the hero.
    private struct SheetSubject: Equatable {
        var race: String
        var characterClass: String
        /// The background asked for; nil left the pick to the server.
        var background: String?
        /// Where its ability increases go. Nil leaves the placement to the server.
        var boost: AbilityBoost?
    }

    @State private var hero: Character
    @State private var step: Step
    @State private var forging = false
    @State private var saving = false
    @State private var error: String?
    @State private var tweak = ""
    private let isEditing: Bool
    /// A hero above level 1 keeps the species, class and background it grew up with: the server
    /// refuses to rebuild its sheet.
    private let locked: Bool

    // The sheet step. `hero.sheet` and `hero.attacks` hold the last sheet the server sent (the
    // hero's own, or a preview); `sheetSubject` says what it was drawn up from.
    /// The background the player picked. Nil until they do: the server picks one for a new hero.
    @State private var background: String?
    /// Where that background's ability increases go. Nil until the player places them.
    @State private var boost: AbilityBoost?
    @State private var sheetSubject: SheetSubject?
    @State private var askedSubject: SheetSubject?
    @State private var sheetLoading = false
    @State private var sheetError: String?
    @State private var sheetRequests = 0
    @State private var sheetTab = HeroSheetTab.launchDefault

    /// `draft` is a new hero with some of the forge already filled in (the `-forgeNew` argument).
    init(editing existing: Character? = nil, draft: Character? = nil, startingAt step: Step = .identity) {
        _hero = State(initialValue: existing ?? draft ?? Character.blank(ownerId: AppConfig.playerId))
        _step = State(initialValue: step)
        // `-forgeBackground <id>` picks a background as the forge opens (screenshot checks).
        let level = existing?.sheet?.level ?? 1
        let asked = level > 1 ? nil : AppConfig.forgeBackgroundArgument
        let sameBackground = asked == nil || asked == existing?.sheet?.backgroundId
        _background = State(initialValue: asked ?? existing?.sheet?.backgroundId)
        _boost = State(initialValue: level > 1 || !sameBackground ? nil : existing?.sheet?.abilityBoost)
        _sheetSubject = State(initialValue: existing.flatMap { hero in
            hero.sheet.map {
                SheetSubject(race: hero.race, characterClass: hero.characterClass, background: $0.backgroundId, boost: $0.abilityBoost)
            }
        })
        isEditing = existing != nil
        locked = (existing?.sheet?.level ?? 1) > 1
    }

    /// The steps this forge walks through: all five, or four when the server has no backgrounds.
    private var steps: [Step] {
        (model.catalog?.backgrounds.isEmpty ?? true) ? Step.allCases.filter { $0 != .sheet } : Step.allCases
    }

    private func neighbour(_ offset: Int) -> Step? {
        let all = steps
        guard let index = all.firstIndex(of: step) else {
            return offset > 0 ? all.first { $0.rawValue > step.rawValue } : all.last { $0.rawValue < step.rawValue }
        }
        return all.indices.contains(index + offset) ? all[index + offset] : nil
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                StepTrack(current: step, steps: steps)
                    .padding(.horizontal, 20)
                    .padding(.vertical, 12)
                ScrollView {
                    Group {
                        if let catalog = model.catalog {
                            switch step {
                            case .identity: identity(catalog)
                            case .calling: calling(catalog)
                            case .sheet: sheetStep(catalog)
                            case .story: story
                            case .portrait: portrait(catalog)
                            }
                        } else {
                            ProgressView().tint(Palette.gold).padding(40)
                        }
                    }
                    .padding(20)
                    .frame(maxWidth: 640)
                    .frame(maxWidth: .infinity)
                }
                .scrollDismissesKeyboard(.interactively)
                .defaultScrollAnchor(AppConfig.launchScrollAnchor)
                footer
            }
            .screenChrome()
            .navigationTitle(isEditing ? "Reforge \(hero.name)" : "Forge a Hero")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
            .interactiveDismissDisabled(forging || saving)
        }
    }

    // MARK: Steps

    private func identity(_ catalog: Catalog) -> some View {
        VStack(alignment: .leading, spacing: 22) {
            VStack(alignment: .leading, spacing: 8) {
                SectionLabel("Name")
                TextField("What do the bards call them?", text: $hero.name)
                    .font(.display(22))
                    .textInputAutocapitalization(.words)
                    .autocorrectionDisabled()
                    .padding(14)
                    .card()
                    .onChange(of: hero.name) { _, new in if new.count > 40 { hero.name = String(new.prefix(40)) } }
            }
            VStack(alignment: .leading, spacing: 8) {
                SectionLabel("Gender")
                ChipPicker(options: catalog.genders, selection: $hero.gender)
            }
            VStack(alignment: .leading, spacing: 8) {
                SectionLabel("Species")
                if locked {
                    lockedPick(catalog.races, hero.race, what: "species")
                } else {
                    OptionGrid(options: catalog.races, selection: $hero.race)
                }
            }
        }
    }

    /// The one option a levelled hero is held to, and a line saying why it can't be changed.
    private func lockedPick(_ options: [CatalogOption], _ id: String, what: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            OptionGrid(options: options.filter { $0.id == id }, selection: .constant(id), columns: 1)
                .disabled(true)
            Label("\(hero.name) is level \(hero.sheet?.level ?? 2): their \(what) is part of who they have become, and can't be changed.",
                  systemImage: "lock.fill")
                .font(.footnote)
                .foregroundStyle(Palette.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func calling(_ catalog: Catalog) -> some View {
        VStack(alignment: .leading, spacing: 22) {
            VStack(alignment: .leading, spacing: 8) {
                SectionLabel("Class")
                if locked {
                    lockedPick(catalog.classes, hero.characterClass, what: "class")
                } else {
                    OptionGrid(options: catalog.classes, selection: $hero.characterClass)
                }
            }
            VStack(alignment: .leading, spacing: 8) {
                SectionLabel("Temperament")
                ChipPicker(options: catalog.temperaments, selection: $hero.temperament)
                SelectedBlurb(options: catalog.temperaments, selection: hero.temperament)
            }
            VStack(alignment: .leading, spacing: 8) {
                SectionLabel("Alignment")
                ChipPicker(options: catalog.alignments, selection: $hero.alignment, minWidth: 104)
            }
        }
    }

    // MARK: The sheet step

    private var subject: SheetSubject {
        SheetSubject(race: hero.race, characterClass: hero.characterClass, background: background, boost: boost)
    }

    /// The sheet on show, as long as it was drawn up for the hero as they are now. A sheet drawn
    /// up with the server's own pick of background still fits once the player picks that same one.
    private var currentSheet: CharacterSheet? {
        guard let sheet = hero.sheet, let drawn = sheetSubject,
              drawn.race == hero.race, drawn.characterClass == hero.characterClass,
              background == nil || background == sheet.backgroundId,
              drawn.boost == boost else { return nil }
        return sheet
    }

    /// The three scores the background on show can raise.
    private func backgroundAbilities(_ catalog: Catalog) -> [String] {
        catalog.backgrounds.first { $0.id == shownBackground }?.abilities ?? []
    }

    /// The background the picker marks: the tap in flight, the player's pick, or the server's.
    private var shownBackground: String {
        background ?? currentSheet?.backgroundId ?? ""
    }

    private func sheetStep(_ catalog: Catalog) -> some View {
        VStack(alignment: .leading, spacing: 22) {
            VStack(alignment: .leading, spacing: 8) {
                SectionLabel("Background")
                Text("What they were before the door. It brings a feat, two skills and gear, and raises three ability scores: +2 to one and +1 to another, or +1 to each.")
                    .font(.footnote).foregroundStyle(Palette.muted)
                    .fixedSize(horizontal: false, vertical: true)
                if locked {
                    lockedPick(catalog.backgrounds, shownBackground, what: "background")
                } else {
                    OptionGrid(options: catalog.backgrounds,
                               selection: Binding(get: { shownBackground }, set: { chooseBackground($0) }),
                               columns: 1)
                }
            }
            if !locked, !backgroundAbilities(catalog).isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    SectionLabel("Ability bonuses")
                    Text("Put +2 on one of these and +1 on another, or +1 on each. None can pass 20. The sheet below shows the result.")
                        .font(.footnote).foregroundStyle(Palette.muted)
                        .fixedSize(horizontal: false, vertical: true)
                    AbilityBonusPicker(abilities: backgroundAbilities(catalog), boost: $boost)
                        .id(shownBackground)
                }
            }
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 10) {
                    SectionLabel(locked ? "Character sheet" : "Their sheet at level 1")
                    if sheetLoading { ProgressView().controlSize(.small).tint(Palette.gold) }
                    Spacer()
                }
                if let sheetError {
                    VStack(alignment: .leading, spacing: 8) {
                        ErrorLine(text: sheetError)
                        Button("Try again") { requestSheet() }
                            .font(.proseSmall.weight(.semibold))
                            .disabled(sheetLoading)
                    }
                }
                if currentSheet != nil {
                    // The same sheet the hero page shows; the forge already pads its steps.
                    VStack(spacing: 0) {
                        HeroSheetView(character: hero, tab: $sheetTab, inset: 0)
                    }
                    .opacity(sheetLoading ? 0.45 : 1)
                    .animation(.easeInOut(duration: 0.2), value: sheetLoading)
                } else if sheetError == nil {
                    HStack(spacing: 10) {
                        if !sheetLoading { Image(systemName: "scroll").foregroundStyle(Palette.gold) }
                        Text(sheetLoading ? "Drawing up the sheet…" : "The sheet is drawn up once the forge knows their species and class.")
                            .font(.proseSmall.italic())
                            .foregroundStyle(Palette.muted)
                    }
                    .frame(maxWidth: .infinity, minHeight: 80)
                    .padding(14)
                    .card()
                }
            }
        }
        .onAppear { refreshSheetIfNeeded() }
        .onChange(of: boost) { _, _ in
            guard !locked, currentSheet == nil else { return }
            requestSheet()
        }
    }

    /// Fetches the preview when the step opens, unless the sheet in hand already fits the hero.
    private func refreshSheetIfNeeded() {
        if locked || currentSheet != nil { return }
        if sheetLoading, askedSubject == subject { return }
        requestSheet()
    }

    private func chooseBackground(_ id: String) {
        guard !locked, id != background else { return }
        withAnimation(.snappy) {
            background = id
            boost = nil
        }
        requestSheet()
    }

    /// Asks the server for the level-1 sheet this hero would get. Only the latest request may answer.
    private func requestSheet() {
        let asked = subject
        let name = hero.name.trimmingCharacters(in: .whitespaces)
        guard !asked.race.isEmpty, !asked.characterClass.isEmpty else { return }
        sheetRequests += 1
        let ticket = sheetRequests
        askedSubject = asked
        withAnimation(.snappy) {
            sheetLoading = true
            sheetError = nil
        }
        Task {
            do {
                // The id seeds the build, so this is the very hero a save would make.
                let preview = try await model.api.sheet(id: hero.id, name: name.isEmpty ? "Hero" : name, race: asked.race,
                                                        characterClass: asked.characterClass, backgroundId: asked.background,
                                                        boost: asked.boost)
                guard ticket == sheetRequests else { return }
                withAnimation(.snappy) {
                    hero.sheet = preview.sheet
                    hero.attacks = preview.attacks
                    sheetSubject = asked
                    sheetLoading = false
                }
            } catch {
                guard ticket == sheetRequests else { return }
                withAnimation(.snappy) {
                    sheetError = "The sheet wouldn't come: \(error.localizedDescription)"
                    sheetLoading = false
                }
            }
        }
    }

    private var story: some View {
        VStack(alignment: .leading, spacing: 22) {
            VStack(alignment: .leading, spacing: 8) {
                SectionLabel("Backstory")
                Text("Where do they come from, and what drives them through the door?")
                    .font(.footnote).foregroundStyle(Palette.muted)
                    .fixedSize(horizontal: false, vertical: true)
                ParchmentEditor(prompt: "Raised by smugglers in a lighthouse; owes a debt to a sea hag…",
                                text: $hero.backstory)
            }
            VStack(alignment: .leading, spacing: 8) {
                SectionLabel("Look")
                Text("Describe them in your own words. The dungeon master will embellish it into a portrait.")
                    .font(.footnote).foregroundStyle(Palette.muted)
                    .fixedSize(horizontal: false, vertical: true)
                ParchmentEditor(prompt: "Copper braid, a burn scar on one cheek, patched green cloak, too many rings…",
                                text: $hero.description)
            }
        }
    }

    private func portrait(_ catalog: Catalog) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            ZStack {
                if forging {
                    ForgingView()
                        .aspectRatio(1, contentMode: .fit)
                        .card()
                } else {
                    PortraitView(url: hero.portraitURL,
                                 symbol: catalog.classes.first { $0.id == hero.characterClass }?.symbol ?? "person.fill",
                                 size: 300)
                }
            }
            .frame(maxWidth: .infinity)

            VStack(alignment: .leading, spacing: 4) {
                Text(hero.name).font(.display(26, weight: .bold))
                Text([catalog.name(hero.gender, in: \.genders), catalog.name(hero.race, in: \.races),
                      catalog.name(hero.characterClass, in: \.classes)].joined(separator: " · "))
                    .font(.proseSmall).foregroundStyle(Palette.muted)
                Text("\(catalog.name(hero.temperament, in: \.temperaments)) · \(catalog.name(hero.alignment, in: \.alignments))")
                    .font(.proseSmall).foregroundStyle(Palette.muted)
            }

            if let appearance = hero.appearance {
                VStack(alignment: .leading, spacing: 6) {
                    SectionLabel("As the dungeon master sees them")
                    Text(appearance).font(.proseSmall.italic())
                }
                .padding(14)
                .card()
            }

            if hero.portraitUrl != nil {
                VStack(alignment: .leading, spacing: 8) {
                    SectionLabel("Not quite right?")
                    TextField("Darker armour, an older face, a raven on the shoulder…", text: $tweak, axis: .vertical)
                        .font(.prose)
                        .padding(12)
                        .card()
                }
            }

            ErrorLine(text: error)

            Button {
                Task { await forge() }
            } label: {
                Label(hero.portraitUrl == nil ? "Forge portrait" : "Reforge portrait", systemImage: "flame.fill")
            }
            .buttonStyle(hero.portraitUrl == nil ? .gilded : .gildedOutline)
            .disabled(forging || saving)
        }
    }

    // MARK: Footer

    private var footer: some View {
        HStack(spacing: 12) {
            if let previous = neighbour(-1) {
                Button("Back") { withAnimation { step = previous } }
                    .buttonStyle(.gildedOutline)
                    .frame(maxWidth: 120)
            }
            if step == .portrait {
                Button {
                    Task { await seal() }
                } label: {
                    if saving { ProgressView().tint(Palette.ink) } else { Text(hero.portraitUrl == nil ? "Seal without portrait" : "Seal hero") }
                }
                .buttonStyle(.gilded)
                .disabled(forging || saving)
            } else {
                Button("Next") {
                    if let next = neighbour(1) { withAnimation { step = next } }
                }
                .buttonStyle(.gilded)
                .disabled(!isComplete(step))
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
        .background(Palette.ink.opacity(0.95))
    }

    /// A levelled hero just waits for the sheet. A new one places the background's increases first,
    /// unless this server's catalog doesn't list the three abilities.
    private var sheetStepComplete: Bool {
        if locked { return !sheetLoading }
        let abilities = model.catalog.map { backgroundAbilities($0) } ?? []
        if abilities.isEmpty { return !sheetLoading }
        return boost?.isValid(for: abilities) == true && !sheetLoading
    }

    private func isComplete(_ step: Step) -> Bool {
        switch step {
        case .identity: !hero.name.trimmingCharacters(in: .whitespaces).isEmpty && !hero.gender.isEmpty && !hero.race.isEmpty
        case .calling: !hero.characterClass.isEmpty && !hero.temperament.isEmpty && !hero.alignment.isEmpty
        // Wait for the sheet in flight, so the hero that is sealed is the one on screen. A sheet
        // that failed doesn't block the forge: the server makes one when the hero is saved.
        case .sheet: sheetStepComplete
        case .story, .portrait: true
        }
    }

    // MARK: Actions

    private func forge() async {
        forging = true
        error = nil
        defer { forging = false }
        do {
            let note = tweak.trimmingCharacters(in: .whitespacesAndNewlines)
            let result = try await model.api.forgePortrait(
                for: hero,
                previousAppearance: hero.portraitUrl == nil ? nil : hero.appearance,
                note: note.isEmpty ? nil : note)
            withAnimation {
                hero.appearance = result.appearance
                hero.portraitUrl = result.portraitUrl
            }
            tweak = ""
        } catch {
            self.error = "The forge sputtered: \(error.localizedDescription)"
        }
    }

    private func seal() async {
        saving = true
        error = nil
        defer { saving = false }
        hero.name = hero.name.trimmingCharacters(in: .whitespaces)
        do {
            // The background on show is the one to build on. A levelled hero sends none: its sheet stays.
            let picked = locked || shownBackground.isEmpty ? nil : shownBackground
            let placed = locked ? nil : boost
            _ = try await model.save(hero, backgroundId: picked, boost: placed)
            dismiss()
        } catch {
            self.error = "Couldn't save \(hero.name): \(error.localizedDescription)"
        }
    }
}

private struct StepTrack: View {
    let current: CharacterForgeView.Step
    let steps: [CharacterForgeView.Step]
    @Environment(\.dynamicTypeSize) private var typeSize

    /// Five small labels in a row fit only at the smaller text sizes. Past them the track is bars
    /// alone, with the step spelled out underneath in text that grows.
    private var spelledOut: Bool { typeSize >= .xxLarge }
    private var position: Int { (steps.firstIndex(of: current) ?? 0) + 1 }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 6) {
                ForEach(steps, id: \.self) { step in
                    VStack(spacing: 6) {
                        Capsule()
                            .fill(step.rawValue <= current.rawValue ? Palette.gold : Palette.raised)
                            .frame(height: 3)
                        if !spelledOut {
                            Text(step.title.uppercased())
                                .font(.system(size: 10, weight: .semibold, design: .serif))
                                .tracking(1.2)
                                .lineLimit(1)
                                .minimumScaleFactor(0.7)
                                .foregroundStyle(step == current ? Palette.gold : Palette.muted)
                        }
                    }
                }
            }
            if spelledOut {
                Text("Step \(position) of \(steps.count): \(current.title)")
                    .font(.serif(.footnote, weight: .semibold))
                    .foregroundStyle(Palette.gold)
                    .fixedSize(horizontal: false, vertical: true)
                    // Pinned above the step: past this size it would take the room the step needs.
                    .dynamicTypeSize(...DynamicTypeSize.accessibility2)
            }
        }
        .animation(.snappy, value: current)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Step \(position) of \(steps.count): \(current.title)")
    }
}

/// Shown while the portrait is generated (10–40 s), so the wait feels like part of the game.
private struct ForgingView: View {
    private let lines = [
        "Stoking the forge…", "Consulting the bards…", "Grinding pigments from dragon scale…",
        "The dungeon master squints at your hero…", "Painting by candlelight…", "Varnishing the canvas…",
    ]

    var body: some View {
        TimelineView(.periodic(from: .now, by: 3)) { context in
            let tick = Int(context.date.timeIntervalSinceReferenceDate / 3)
            VStack(spacing: 18) {
                Image(systemName: "flame.fill")
                    .font(.system(size: 56))
                    .foregroundStyle(LinearGradient(colors: [Palette.gold, Palette.ember], startPoint: .top, endPoint: .bottom))
                    .symbolEffect(.pulse, options: .repeating)
                Text(lines[tick % lines.count])
                    .font(.prose.italic())
                    .foregroundStyle(Palette.muted)
                    .contentTransition(.opacity)
                    .animation(.easeInOut, value: tick)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}
