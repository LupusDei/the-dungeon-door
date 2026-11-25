import SwiftUI

/// Create or edit a hero in four steps: who they are, their calling, their story, their portrait.
struct CharacterForgeView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    enum Step: Int, CaseIterable {
        case identity, calling, story, portrait
        var title: String {
            switch self {
            case .identity: "Who"
            case .calling: "Calling"
            case .story: "Story"
            case .portrait: "Portrait"
            }
        }
    }

    @State private var hero: Character
    @State private var step: Step = .identity
    @State private var forging = false
    @State private var saving = false
    @State private var error: String?
    @State private var tweak = ""
    private let isEditing: Bool

    init(editing existing: Character? = nil) {
        _hero = State(initialValue: existing ?? Character.blank(ownerId: AppConfig.playerId))
        isEditing = existing != nil
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                StepTrack(current: step)
                    .padding(.horizontal, 20)
                    .padding(.vertical, 12)
                ScrollView {
                    Group {
                        if let catalog = model.catalog {
                            switch step {
                            case .identity: identity(catalog)
                            case .calling: calling(catalog)
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
                SectionLabel("Race")
                OptionGrid(options: catalog.races, selection: $hero.race)
            }
        }
    }

    private func calling(_ catalog: Catalog) -> some View {
        VStack(alignment: .leading, spacing: 22) {
            VStack(alignment: .leading, spacing: 8) {
                SectionLabel("Class")
                OptionGrid(options: catalog.classes, selection: $hero.characterClass)
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

    private var story: some View {
        VStack(alignment: .leading, spacing: 22) {
            VStack(alignment: .leading, spacing: 8) {
                SectionLabel("Backstory")
                Text("Where do they come from, and what drives them through the door?")
                    .font(.footnote).foregroundStyle(Palette.muted)
                ParchmentEditor(prompt: "Raised by smugglers in a lighthouse; owes a debt to a sea hag…",
                                text: $hero.backstory)
            }
            VStack(alignment: .leading, spacing: 8) {
                SectionLabel("Look")
                Text("Describe them in your own words. The dungeon master will embellish it into a portrait.")
                    .font(.footnote).foregroundStyle(Palette.muted)
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
            if step != .identity {
                Button("Back") { withAnimation { step = Step(rawValue: step.rawValue - 1)! } }
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
                Button("Next") { withAnimation { step = Step(rawValue: step.rawValue + 1)! } }
                    .buttonStyle(.gilded)
                    .disabled(!isComplete(step))
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
        .background(Palette.ink.opacity(0.95))
    }

    private func isComplete(_ step: Step) -> Bool {
        switch step {
        case .identity: !hero.name.trimmingCharacters(in: .whitespaces).isEmpty && !hero.gender.isEmpty && !hero.race.isEmpty
        case .calling: !hero.characterClass.isEmpty && !hero.temperament.isEmpty && !hero.alignment.isEmpty
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
            _ = try await model.save(hero)
            dismiss()
        } catch {
            self.error = "Couldn't save \(hero.name): \(error.localizedDescription)"
        }
    }
}

private struct StepTrack: View {
    let current: CharacterForgeView.Step
    var body: some View {
        HStack(spacing: 6) {
            ForEach(CharacterForgeView.Step.allCases, id: \.self) { step in
                VStack(spacing: 6) {
                    Capsule()
                        .fill(step.rawValue <= current.rawValue ? Palette.gold : Palette.raised)
                        .frame(height: 3)
                    Text(step.title.uppercased())
                        .font(.system(size: 10, weight: .semibold, design: .serif))
                        .tracking(1.5)
                        .foregroundStyle(step == current ? Palette.gold : Palette.muted)
                }
            }
        }
        .animation(.snappy, value: current)
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
