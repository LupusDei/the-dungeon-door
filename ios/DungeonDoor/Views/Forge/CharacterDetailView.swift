import SwiftUI

/// A hero's page, which is their character sheet: who they are, their vitals, and the sheet's tabs.
/// The backstory and the dungeon master's description live in the Story tab.
struct CharacterDetailView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let character: Character
    @State private var tab = HeroSheetTab.launchDefault
    @State private var editing = false
    @State private var confirmDelete = false
    @State private var error: String?
    /// `-openQuests YES`: straight on to this hero's quests (screenshot checks).
    @State private var launchQuests = AppConfig.openQuestsArgument

    /// The latest copy, so edits show straight away.
    private var hero: Character { model.characters.first { $0.id == character.id } ?? character }

    var body: some View {
        ScrollView {
            // A lazy stack so the sheet's vitals and tabs can pin under the bar while the rest scrolls.
            LazyVStack(alignment: .leading, spacing: 0, pinnedViews: [.sectionHeaders]) {
                HeroIdentityHeader(character: hero)
                    .padding(.horizontal, 20)
                    .padding(.top, 8)
                    .padding(.bottom, 14)
                if hero.isFallen {
                    TempleCard(hero: hero)
                        .padding(.horizontal, 20)
                        .padding(.bottom, 14)
                }
                if hero.bonusesOpen == true {
                    AbilityBonusCard(hero: hero)
                        .padding(.horizontal, 20)
                        .padding(.bottom, 14)
                }
                // The adventures this hero has been on: their pictures and how each came out.
                QuestsLink(hero: hero)
                    .padding(.horizontal, 20)
                    .padding(.bottom, 14)
                HeroSheetView(character: hero, tab: $tab)
                if hero.sheet == nil {
                    // No sheet to hold the Story tab yet: their words still belong on the page.
                    VStack(alignment: .leading, spacing: 20) {
                        if !hero.backstory.isEmpty { block("Backstory", hero.backstory) }
                        if let appearance = hero.appearance { block("As the dungeon master sees them", appearance, italic: true) }
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 8)
                }
                ErrorLine(text: error)
                    .padding(.horizontal, 20)
                    .padding(.bottom, 20)
            }
            .frame(maxWidth: 640)
            .frame(maxWidth: .infinity)
        }
        .defaultScrollAnchor(AppConfig.launchScrollAnchor)
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
        .navigationDestination(isPresented: $launchQuests) { HeroQuestsView(hero: hero) }
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
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(title)
            SheetProse(text: text, italic: italic)
        }
    }
}
