import SwiftUI

struct HomeView: View {
    @Environment(AppModel.self) private var model
    @State private var forging = false
    @State private var newGame = false
    @State private var joining = false
    @State private var doorOpen = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    header
                    heroes
                    actions
                }
                .padding(20)
                .frame(maxWidth: 640)
                .frame(maxWidth: .infinity)
            }
            .refreshable { await model.refresh() }
            .screenChrome()
            .navigationDestination(for: Character.self) { CharacterDetailView(character: $0) }
        }
        .sheet(isPresented: $forging) { CharacterForgeView() }
        .sheet(isPresented: $newGame) { NewGameView() }
        .sheet(isPresented: $joining) { JoinGameView() }
        .fullScreenCover(isPresented: Binding(get: { model.activeGame != nil }, set: { if !$0 { model.closeGame() } })) {
            if let session = model.activeGame { GameView(session: session) }
        }
        .onAppear {
            withAnimation(.easeInOut(duration: 1.4).delay(0.3)) { doorOpen = true }
        }
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 18) {
            DoorMark(open: doorOpen)
                .frame(width: 64)
            VStack(alignment: .leading, spacing: 4) {
                Text("The Dungeon Door")
                    .font(.display(32, weight: .bold))
                Text("Gather your party. The master of this dungeon is listening.")
                    .font(.proseSmall.italic())
                    .foregroundStyle(Palette.muted)
            }
        }
        .padding(.top, 12)
    }

    @ViewBuilder private var heroes: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionLabel("Your heroes")
            if let error = model.catalogError {
                VStack(alignment: .leading, spacing: 8) {
                    ErrorLine(text: "Can't reach the tavern: \(error)")
                    Button("Try again") { Task { await model.refresh() } }
                        .font(.proseSmall)
                }
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 14) {
                    ForEach(model.characters) { hero in
                        NavigationLink(value: hero) { HeroCard(hero: hero) }
                            .buttonStyle(.plain)
                    }
                    Button { forging = true } label: { ForgeCard() }
                        .buttonStyle(.plain)
                        .disabled(model.catalog == nil)
                }
                .padding(.vertical, 2)
            }
            .scrollClipDisabled()
        }
    }

    private var actions: some View {
        VStack(spacing: 12) {
            SectionLabel("Adventure").frame(maxWidth: .infinity, alignment: .leading)
            Button { newGame = true } label: {
                Label("Open a new door", systemImage: "door.left.hand.open")
            }
            .buttonStyle(.gilded)
            Button { joining = true } label: {
                Label("Join a party", systemImage: "person.3.sequence.fill")
            }
            .buttonStyle(.gildedOutline)
            if model.characters.isEmpty {
                Text("Forge a hero first — every party needs someone to walk through the door.")
                    .font(.footnote.italic())
                    .foregroundStyle(Palette.muted)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .disabled(model.characters.isEmpty || model.catalog == nil)
    }
}

private struct HeroCard: View {
    @Environment(AppModel.self) private var model
    let hero: Character

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            PortraitView(url: hero.portraitURL, symbol: classSymbol, size: 132)
            Text(hero.name)
                .font(.display(17))
                .lineLimit(1)
            Text(subtitle)
                .font(.caption)
                .foregroundStyle(Palette.muted)
                .lineLimit(1)
        }
        .frame(width: 132)
        .padding(10)
        .card()
    }

    private var classSymbol: String {
        model.catalog?.classes.first { $0.id == hero.characterClass }?.symbol ?? "shield.lefthalf.filled"
    }

    private var subtitle: String {
        guard let c = model.catalog else { return hero.characterClass.capitalized }
        return "\(c.name(hero.race, in: \.races)) \(c.name(hero.characterClass, in: \.classes))"
    }
}

private struct ForgeCard: View {
    var body: some View {
        VStack(spacing: 10) {
            ZStack {
                RoundedRectangle(cornerRadius: 21)
                    .strokeBorder(Palette.gold.opacity(0.5), style: StrokeStyle(lineWidth: 1.5, dash: [6, 5]))
                Image(systemName: "hammer.fill")
                    .font(.system(size: 40))
                    .foregroundStyle(Palette.gold)
            }
            .frame(width: 132, height: 132)
            Text("Forge a hero").font(.display(17))
            Text("Describe them; we'll paint them").font(.caption).foregroundStyle(Palette.muted)
        }
        .frame(width: 132)
        .padding(10)
        .card()
    }
}
