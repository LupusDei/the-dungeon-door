import SwiftUI

/// Who a hero is, beside their portrait: the name, "Level 2 Dwarf Fighter", "Soldier · Stoic ·
/// Lawful Good", and how far they are toward the next level. A hero who died says so here first.
/// The top of the hero page, and of a sheet opened in a game.
struct HeroIdentityHeader: View {
    @Environment(AppModel.self) private var model
    let character: Character
    var portraitSize: CGFloat = 96
    /// Off where the name is already the screen's title.
    var showsName = true

    @Environment(\.dynamicTypeSize) private var typeSize

    private var fallen: Bool { character.isFallen }

    /// Beside the portrait while the words have room; under it at the largest text sizes, where a
    /// name squeezed into what the portrait leaves would break in the middle of a word.
    private var arrangement: AnyLayout {
        typeSize >= .accessibility3 ? AnyLayout(VStackLayout(alignment: .leading, spacing: 12))
                                    : AnyLayout(HStackLayout(alignment: .center, spacing: 14))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            arrangement {
                PortraitView(url: character.portraitURL, symbol: classSymbol, size: portraitSize)
                    .saturation(fallen ? 0 : 1)
                    .opacity(fallen ? 0.7 : 1)
                VStack(alignment: .leading, spacing: 4) {
                    if showsName {
                        Text(character.name)
                            .font(.serif(.title, weight: .bold))
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityAddTraits(.isHeader)
                    }
                    if fallen { TagLabel("Fallen", tint: Palette.ember) }
                    Text(calling)
                        .font(.serif(showsName ? .headline : .title3, weight: .semibold))
                        .foregroundStyle(fallen ? Palette.muted : Palette.gold)
                        .fixedSize(horizontal: false, vertical: true)
                    if !bearing.isEmpty {
                        Text(bearing)
                            .font(.serif(.subheadline))
                            .foregroundStyle(Palette.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 0)
            }
            .accessibilityElement(children: .combine)
            if let sheet = character.sheet {
                ExperienceBar(level: sheet.level, xp: sheet.xp)
            }
            if fallen {
                Label {
                    Text("\(character.name) died on an adventure. The dead can't go through a door again unless they are raised. Their sheet and their story are kept.")
                        .fixedSize(horizontal: false, vertical: true)
                } icon: {
                    Image(systemName: "leaf.fill")
                }
                .font(.serif(.footnote))
                .foregroundStyle(Palette.parchment.opacity(0.9))
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Palette.ember.opacity(0.14), in: .rect(cornerRadius: 12))
                .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(Palette.ember.opacity(0.5), lineWidth: 1) }
            } else if let penalty = character.sheet?.revivalPenalty, penalty > 0 {
                // Raised from the dead: the numbers below are the hero's own, so say what comes off them.
                Label {
                    Text("Raised from the dead and still weak: \u{2212}\(penalty) on every d20 roll. Each long rest eases it by 1.")
                        .fixedSize(horizontal: false, vertical: true)
                } icon: {
                    Image(systemName: "sparkles")
                }
                .font(.serif(.footnote))
                .foregroundStyle(Palette.parchment.opacity(0.9))
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Palette.gold.opacity(0.10), in: .rect(cornerRadius: 12))
                .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(Palette.gold.opacity(0.4), lineWidth: 1) }
            }
        }
    }

    private var classSymbol: String {
        model.catalog?.classes.first { $0.id == character.characterClass }?.symbol ?? "person.fill"
    }

    private func name(_ id: String, in list: KeyPath<Catalog, [CatalogOption]>) -> String {
        model.catalog?.name(id, in: list) ?? SRD.name(id)
    }

    /// "Level 1 Dwarf Fighter"; without a sheet, just "Dwarf Fighter".
    private var calling: String {
        let words = [character.sheet.map { "Level \($0.level)" }, name(character.race, in: \.races),
                     name(character.characterClass, in: \.classes)]
        return words.compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ")
    }

    /// "Soldier · Stoic · Lawful Good".
    private var bearing: String {
        let background = character.sheet?.backgroundId ?? ""
        let parts = [background.isEmpty ? "" : name(background, in: \.backgrounds),
                     character.temperament.isEmpty ? "" : name(character.temperament, in: \.temperaments),
                     character.alignment.isEmpty ? "" : name(character.alignment, in: \.alignments)]
        return parts.filter { !$0.isEmpty }.joined(separator: " · ")
    }
}

/// Experience toward the next level: "120 / 300 XP" over a bar that fills across the level.
struct ExperienceBar: View {
    let level: Int
    let xp: Int

    var body: some View {
        let floor = SRD.xpFloor(of: level)
        let next = SRD.xpForNextLevel(after: level)
        VStack(alignment: .leading, spacing: 5) {
            HStack(alignment: .firstTextBaseline) {
                Text("EXPERIENCE")
                    .font(.serif(.caption2, weight: .semibold))
                    .tracking(1.4)
                    .foregroundStyle(Palette.muted)
                Spacer()
                if let next {
                    (Text("\(xp)").foregroundStyle(Palette.parchment).fontWeight(.semibold)
                        + Text(" / \(next) XP").foregroundStyle(Palette.muted))
                        .font(.serif(.footnote))
                        .monospacedDigit()
                } else {
                    Text("\(xp) XP · the highest level")
                        .font(.serif(.footnote))
                        .foregroundStyle(Palette.muted)
                        .monospacedDigit()
                }
            }
            HPBar(hp: next == nil ? 1 : max(0, xp - floor), maxHp: next.map { max(1, $0 - floor) } ?? 1,
                  tint: Palette.gold, height: 5)
            if let next {
                Text(xp >= next ? "Ready for level \(level + 1)." : "\(next - xp) XP to level \(level + 1)")
                    .font(.serif(.caption2))
                    .foregroundStyle(Palette.muted)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(next.map { "Level \(level), \(xp) of \($0) experience points to level \(level + 1)" }
                            ?? "Level \(level), the highest. \(xp) experience points")
    }
}

/// A hero's sheet as its own screen, for looking someone up mid-game: the name in the title, live
/// numbers in the vitals and the tabs, and nothing to edit.
struct HeroSheetScreen: View {
    @Environment(\.dismiss) private var dismiss
    let character: Character
    var live: LiveHero?
    @Binding var tab: HeroSheetTab

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0, pinnedViews: [.sectionHeaders]) {
                    HeroIdentityHeader(character: character, portraitSize: 64, showsName: false)
                        .padding(.horizontal, 20)
                        .padding(.top, 12)
                        .padding(.bottom, 14)
                    HeroSheetView(character: character, live: live, tab: $tab)
                }
                .frame(maxWidth: 640)
                .frame(maxWidth: .infinity)
            }
            .defaultScrollAnchor(AppConfig.launchScrollAnchor)
            .screenChrome()
            .navigationTitle(character.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .presentationDetents([.large])
        .presentationBackground(Palette.ink)
    }
}
