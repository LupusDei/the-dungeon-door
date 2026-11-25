import SwiftUI

struct CharacterDetailView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let character: Character
    @State private var editing = false
    @State private var confirmDelete = false
    @State private var error: String?

    /// The latest copy, so edits show straight away.
    private var hero: Character { model.characters.first { $0.id == character.id } ?? character }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                PortraitView(url: hero.portraitURL, size: 320)
                    .frame(maxWidth: .infinity)
                if let c = model.catalog {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(hero.name).font(.display(30, weight: .bold))
                        Text("\(c.name(hero.race, in: \.races)) \(c.name(hero.characterClass, in: \.classes))")
                            .font(.display(18, weight: .regular)).foregroundStyle(Palette.gold)
                        Text([c.name(hero.gender, in: \.genders), c.name(hero.temperament, in: \.temperaments),
                              c.name(hero.alignment, in: \.alignments)].joined(separator: " · "))
                            .font(.proseSmall).foregroundStyle(Palette.muted)
                    }
                }
                if !hero.backstory.isEmpty { block("Backstory", hero.backstory) }
                if let appearance = hero.appearance { block("Appearance", appearance, italic: true) }
                ErrorLine(text: error)
            }
            .padding(20)
            .frame(maxWidth: 640)
            .frame(maxWidth: .infinity)
        }
        .screenChrome()
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Button("Reforge", systemImage: "hammer") { editing = true }
                    Button("Retire hero", systemImage: "trash", role: .destructive) { confirmDelete = true }
                } label: { Image(systemName: "ellipsis.circle") }
            }
        }
        .sheet(isPresented: $editing) { CharacterForgeView(editing: hero) }
        .confirmationDialog("Retire \(hero.name)?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Retire", role: .destructive) {
                Task {
                    do { try await model.delete(hero); dismiss() } catch { self.error = error.localizedDescription }
                }
            }
        } message: {
            Text("Their portrait and story will be gone for good.")
        }
    }

    private func block(_ title: String, _ text: String, italic: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            SectionLabel(title)
            Text(text).font(italic ? .prose.italic() : .prose)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .card()
    }
}
