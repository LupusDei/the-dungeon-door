import SwiftUI

/// The heroes off the roster: those the player retired, who can come back, and the fallen, who are
/// remembered with how and where they died. Reached from the home screen; a hero's page opens from
/// either list.
struct HallOfHeroesView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 26) {
                    Text("Heroes who have left the road. The retired can take it up again; the fallen are remembered here.")
                        .font(.proseSmall)
                        .foregroundStyle(Palette.parchment.opacity(0.85))
                        .fixedSize(horizontal: false, vertical: true)
                    section("Retired", heroes: model.retired,
                            empty: "No hero has retired. Retire one from their page and they will wait here.")
                    section("Fallen", heroes: model.fallen,
                            empty: "None of your heroes has fallen. May it stay that way.")
                }
                .padding(20)
                .frame(maxWidth: 640)
                .frame(maxWidth: .infinity)
            }
            .screenChrome()
            .navigationTitle("Hall of Heroes")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .navigationDestination(for: Character.self) { CharacterDetailView(character: $0) }
            .refreshable { await model.refresh() }
            .task { await model.refresh() }
        }
    }

    @ViewBuilder private func section(_ title: String, heroes: [Character], empty: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel(title)
            if heroes.isEmpty {
                Text(empty)
                    .font(.footnote.italic())
                    .foregroundStyle(Palette.muted)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                ForEach(heroes) { HallRow(hero: $0) }
            }
        }
    }
}

/// One hero in the Hall: portrait, name, species and class, level, and for the fallen how and
/// where. A retired hero's row carries its way back.
private struct HallRow: View {
    @Environment(AppModel.self) private var model
    let hero: Character

    @State private var confirm = false
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        let fallen = hero.isFallen
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 12) {
                NavigationLink(value: hero) {
                    HStack(spacing: 12) {
                        // The row opens the hero's page; the picture opens large from there (as on the home screen).
                        PortraitView(url: hero.portraitURL, symbol: HallText.symbol(hero, model.catalog), size: 56, opensViewer: false)
                            .saturation(fallen ? 0 : 1)
                            .opacity(fallen ? 0.7 : 1)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(hero.name)
                                .font(.serif(.headline, weight: .semibold))
                                .foregroundStyle(fallen ? Palette.parchment.opacity(0.8) : Palette.parchment)
                                .multilineTextAlignment(.leading)
                            Text("\(HallText.kind(hero, model.catalog)) · Level \(hero.sheet?.level ?? 1)")
                                .font(.caption)
                                .foregroundStyle(Palette.muted)
                                .multilineTextAlignment(.leading)
                            if fallen {
                                Text(HallText.whereFell(hero.death))
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(Palette.ember)
                                    .multilineTextAlignment(.leading)
                                if let cause = hero.death?.cause {
                                    Text(cause)
                                        .font(.caption.italic())
                                        .foregroundStyle(Palette.muted)
                                        .multilineTextAlignment(.leading)
                                }
                            } else if let since = HallText.retiredSince(hero) {
                                Text(since)
                                    .font(.caption)
                                    .foregroundStyle(Palette.muted)
                            }
                        }
                        .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 4)
                    }
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                if !fallen {
                    Button("Un-retire") { confirm = true }
                        .font(.serif(.subheadline, weight: .semibold))
                        .foregroundStyle(Palette.ink)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 7)
                        .background(Palette.gold, in: .capsule)
                        .buttonStyle(.plain)
                        .disabled(busy)
                        .accessibilityHint("Asks before bringing \(hero.name) back to your roster")
                }
            }
            ErrorLine(text: error)
        }
        .padding(12)
        .glassCard()
        .confirmationDialog("Bring \(hero.name) back?", isPresented: $confirm, titleVisibility: .visible) {
            Button("Un-retire \(hero.name)") {
                busy = true
                error = nil
                Task {
                    do { try await model.unretire(hero) } catch { self.error = error.localizedDescription }
                    busy = false
                }
            }
            Button("Not now", role: .cancel) {}
        } message: {
            Text("\(hero.name) returns to your heroes on the home screen.")
        }
    }
}

/// On a retired hero's page: since when, and the way back to the roster.
struct RetiredCard: View {
    @Environment(AppModel.self) private var model
    let hero: Character

    @State private var confirm = false
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionLabel("Retired")
            Text("\(HallText.retiredSince(hero) ?? "Retired"). \(hero.name) waits in the Hall of Heroes and can take up the road again.")
                .font(.serif(.subheadline))
                .foregroundStyle(Palette.parchment.opacity(0.9))
                .fixedSize(horizontal: false, vertical: true)
            Button { confirm = true } label: {
                Label("Un-retire \(hero.name)", systemImage: "arrow.uturn.backward")
            }
            .buttonStyle(.gilded)
            .disabled(busy)
            ErrorLine(text: error)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
        .confirmationDialog("Bring \(hero.name) back?", isPresented: $confirm, titleVisibility: .visible) {
            Button("Un-retire \(hero.name)") {
                busy = true
                error = nil
                Task {
                    do { try await model.unretire(hero) } catch { self.error = error.localizedDescription }
                    busy = false
                }
            }
            Button("Not now", role: .cancel) {}
        } message: {
            Text("\(hero.name) returns to your heroes on the home screen.")
        }
    }
}

/// On a fallen hero's page: how and where they died, when the server recorded it.
struct FallenCard: View {
    let hero: Character

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel("Fallen")
            Text(HallText.whereFell(hero.death))
                .font(.serif(.subheadline, weight: .semibold))
                .foregroundStyle(Palette.ember)
                .fixedSize(horizontal: false, vertical: true)
            if let cause = hero.death?.cause {
                Text(cause)
                    .font(.serif(.subheadline).italic())
                    .foregroundStyle(Palette.parchment.opacity(0.9))
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let date = hero.death?.date {
                Text(date, format: .dateTime.day().month(.wide).year())
                    .font(.caption)
                    .foregroundStyle(Palette.muted)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
        .accessibilityElement(children: .combine)
    }
}

/// The words the Hall uses for a hero.
private enum HallText {
    static func kind(_ hero: Character, _ catalog: Catalog?) -> String {
        guard let catalog else { return hero.characterClass.capitalized }
        return "\(catalog.name(hero.race, in: \.races)) \(catalog.name(hero.characterClass, in: \.classes))"
    }

    static func symbol(_ hero: Character, _ catalog: Catalog?) -> String {
        catalog?.classes.first { $0.id == hero.characterClass }?.symbol ?? "shield.lefthalf.filled"
    }

    /// "Fell in The Flooded Crypt, on The Sunken Keep", or as much of that as was recorded.
    static func whereFell(_ death: Death?) -> String {
        switch (death?.place, death?.adventure) {
        case let (place?, adventure?) where place != adventure: "Fell in \(place), on \(adventure)"
        case let (place?, _): "Fell in \(place)"
        case let (nil, adventure?): "Fell on \(adventure)"
        case (nil, nil): "Fell on an adventure"
        }
    }

    /// "Retired 3 November 2026", when the stamp reads as a date.
    static func retiredSince(_ hero: Character) -> String? {
        guard let stamp = hero.retiredAt, let date = ServerTime.date(stamp) else { return nil }
        return "Retired \(date.formatted(.dateTime.day().month(.wide).year()))"
    }
}
