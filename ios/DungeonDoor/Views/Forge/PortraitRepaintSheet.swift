import SwiftUI

/// Repaint a sealed hero's portrait from their page, without walking the whole forge: the picture,
/// what to change, their Look in their own words, and a save. The hero keeps the portrait they have
/// until the player keeps a new one and saves; Cancel leaves them as they were.
struct PortraitRepaintSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    private let original: Character
    @State private var look: String
    @State private var note = ""
    @State private var painting: PortraitRemake
    @State private var forging = false
    @State private var saving = false
    @State private var error: String?

    init(hero: Character) {
        original = hero
        _look = State(initialValue: hero.description)
        _painting = State(initialValue: PortraitRemake(hero))
    }

    private var symbol: String {
        model.catalog?.classes.first { $0.id == original.characterClass }?.symbol ?? "person.fill"
    }

    private var edited: Character {
        var hero = original
        hero.description = look
        return hero
    }

    private var unsaved: Bool { painting.changed || look != original.description }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        PortraitCanvas(url: painting.shown.portraitUrl.flatMap(URL.init(string:)), symbol: symbol, forging: forging)
                        if painting.awaitingChoice { PortraitChoiceNote() }

                        RepaintControls(painting: painting, note: $note, busy: forging || saving) {
                            Task { await paint() }
                        }

                        ErrorLine(text: error)

                        VStack(alignment: .leading, spacing: 8) {
                            SectionLabel("Look")
                            Text("Their look in your own words. Change it and the next painting starts fresh from it.")
                                .font(.footnote).foregroundStyle(Palette.muted)
                                .fixedSize(horizontal: false, vertical: true)
                            ParchmentEditor(prompt: "Copper braid, a burn scar on one cheek, patched green cloak, too many rings…",
                                            text: $look)
                        }

                        if let appearance = painting.shown.appearance {
                            VStack(alignment: .leading, spacing: 6) {
                                SectionLabel("As the dungeon master sees them")
                                Text(appearance).font(.proseSmall.italic())
                            }
                            .padding(14)
                            .card()
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
            .navigationTitle("Repaint \(original.name)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
            .interactiveDismissDisabled(forging || saving || unsaved)
        }
    }

    private var footer: some View {
        HStack(spacing: 12) {
            if painting.awaitingChoice {
                PortraitChoiceBar(disabled: forging || saving,
                                  backToLast: { withAnimation { painting.backToLast() } },
                                  keepNew: { withAnimation { painting.keepNew() } })
            } else {
                Button {
                    Task { await save() }
                } label: {
                    if saving { ProgressView().tint(Palette.ink) } else { Label("Keep & save", systemImage: "checkmark.seal.fill") }
                }
                .buttonStyle(.gilded)
                .disabled(forging || saving || !unsaved)
                .accessibilityHint("Saves the portrait and look, and closes.")
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
        .background(Palette.ink.opacity(0.95))
    }

    private func paint() async {
        forging = true
        error = nil
        defer { forging = false }
        do {
            let hero = edited
            let asked = painting.request(description: hero.description, note: note)
            let result = try await model.api.forgePortrait(for: hero, previousAppearance: asked.previousAppearance, note: asked.note)
            withAnimation { painting.painted(result, from: hero.description) }
            note = ""
        } catch {
            self.error = "The forge sputtered: \(error.localizedDescription)"
        }
    }

    private func save() async {
        saving = true
        error = nil
        defer { saving = false }
        do {
            // No background or boost: the sheet stays exactly as it is.
            _ = try await model.save(painting.applied(to: edited))
            dismiss()
        } catch {
            self.error = "Couldn't save \(original.name): \(error.localizedDescription)"
        }
    }
}
