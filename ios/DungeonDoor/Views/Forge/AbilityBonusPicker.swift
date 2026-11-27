import SwiftUI

/// Where a background's three ability increases go: +2 and +1, or +1 to each.
struct AbilityBonusPicker: View {
    let abilities: [String]
    @Binding var boost: AbilityBoost?

    @State private var mode = ""
    @State private var plusTwo = ""
    @State private var plusOne = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                modeChip("twoOne", " +2 and +1 ")
                modeChip("oneOneOne", " +1 to each ")
            }
            if mode == "twoOne" {
                scoreRow("Plus 2", selection: plusTwo) { plusTwo = $0; publish() }
                scoreRow("Plus 1", selection: plusOne) { plusOne = $0; publish() }
                if !plusTwo.isEmpty, plusTwo == plusOne {
                    Text("The +2 and the +1 go to different scores.")
                        .font(.footnote)
                        .foregroundStyle(Palette.ember)
                        .fixedSize(horizontal: false, vertical: true)
                }
            } else if mode == "oneOneOne" {
                Text("\(abilities.map(SRD.abilityName).joined(separator: ", ")) each go up by 1.")
                    .font(.footnote)
                    .foregroundStyle(Palette.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .onAppear { adopt(boost) }
    }

    private func modeChip(_ id: String, _ title: String) -> some View {
        let selected = mode == id
        return Button {
            withAnimation(.snappy) {
                mode = id
                publish()
            }
        } label: {
            Text(title)
                .font(.system(.subheadline, design: .serif, weight: selected ? .semibold : .regular))
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .frame(maxWidth: .infinity, minHeight: 40)
                .foregroundStyle(selected ? Palette.ink : Palette.parchment)
                .background(selected ? Palette.gold : Palette.surface, in: .capsule)
                .overlay { Capsule().strokeBorder(Palette.gold.opacity(selected ? 0 : 0.3)) }
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func scoreRow(_ title: String, selection: String, choose: @escaping (String) -> Void) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title.uppercased())
                .font(.system(size: 10, weight: .semibold, design: .serif))
                .tracking(1.5)
                .foregroundStyle(Palette.muted)
            HStack(spacing: 8) {
                ForEach(abilities, id: \.self) { id in
                    let selected = selection == id
                    Button {
                        withAnimation(.snappy) { choose(id) }
                    } label: {
                        Text(SRD.ability(id))
                            .font(.system(.subheadline, design: .serif, weight: .semibold))
                            .frame(maxWidth: .infinity, minHeight: 40)
                            .foregroundStyle(selected ? Palette.ink : Palette.parchment)
                            .background(selected ? Palette.gold : Palette.surface, in: .capsule)
                            .overlay { Capsule().strokeBorder(Palette.gold.opacity(selected ? 0 : 0.3)) }
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("\(title), \(SRD.abilityName(id))")
                    .accessibilityAddTraits(selected ? .isSelected : [])
                }
            }
        }
    }

    /// What the controls add up to, or nil until the choice is one the rules allow.
    private var drafted: AbilityBoost? {
        switch mode {
        case "oneOneOne":
            return AbilityBoost(kind: "oneOneOne")
        case "twoOne":
            guard !plusTwo.isEmpty, !plusOne.isEmpty, plusTwo != plusOne else { return nil }
            return AbilityBoost(kind: "twoOne", plusTwo: plusTwo, plusOne: plusOne)
        default:
            return nil
        }
    }

    private func publish() {
        let next = drafted
        if next != boost { boost = next }
    }

    private func adopt(_ existing: AbilityBoost?) {
        guard let existing else { return }
        mode = existing.kind
        plusTwo = existing.plusTwo ?? ""
        plusOne = existing.plusOne ?? ""
    }
}

/// On a hero's page, when the forge placed the background's increases and the scores are still those.
struct AbilityBonusCard: View {
    @Environment(AppModel.self) private var model
    let hero: Character

    @State private var boost: AbilityBoost?
    @State private var busy = false
    @State private var error: String?

    private var abilities: [String] {
        guard let id = hero.sheet?.backgroundId else { return [] }
        return model.catalog?.backgrounds.first { $0.id == id }?.abilities ?? []
    }

    /// A party keeps the sheet from when the hero joined, and writes it home at the end.
    private var inAParty: Bool {
        model.activeGame?.state.players.contains { $0.character.id == hero.id } ?? false
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionLabel("Ability bonuses")
            if inAParty {
                Text("\(hero.name) is in a party, which keeps the sheet from when they joined. Place the bonuses once that adventure is over.")
                    .font(.serif(.subheadline))
                    .foregroundStyle(Palette.parchment.opacity(0.9))
                    .fixedSize(horizontal: false, vertical: true)
            } else if abilities.isEmpty {
                Text("The forge placed \(hero.name)'s ability bonuses. They can be moved once the backgrounds have loaded.")
                    .font(.serif(.subheadline))
                    .foregroundStyle(Palette.muted)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                Text("\(hero.name)'s background raises three scores. The forge placed the +2 and +1 itself. Choose where they go. This replaces that placement, and it can be done once.")
                    .font(.serif(.subheadline))
                    .foregroundStyle(Palette.parchment.opacity(0.9))
                    .fixedSize(horizontal: false, vertical: true)
                AbilityBonusPicker(abilities: abilities, boost: $boost)
                    .id(hero.sheet?.backgroundId ?? "")
                Button {
                    Task { await place() }
                } label: {
                    if busy { ProgressView().tint(Palette.ink) } else { Text("Place the bonuses") }
                }
                .buttonStyle(.gilded)
                .disabled(busy || boost?.isValid(for: abilities) != true)
            }
            ErrorLine(text: error)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }

    private func place() async {
        guard let boost else { return }
        busy = true
        error = nil
        defer { busy = false }
        do {
            try await model.assignBonuses(hero, boost: boost)
        } catch {
            self.error = error.localizedDescription
        }
    }
}
