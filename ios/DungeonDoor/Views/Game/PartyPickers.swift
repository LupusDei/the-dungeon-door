import SwiftUI

/// Pick which of your heroes walks through the door. The fallen are not offered: the dead stay
/// dead, and the server turns them away.
struct HeroPicker: View {
    @Environment(AppModel.self) private var model
    @Binding var selection: String?
    /// 100 at the default text size, more as the cards' small text grows.
    @ScaledMetric(relativeTo: .caption2) private var percent: CGFloat = 100
    @Environment(\.dynamicTypeSize) private var typeSize

    private var living: [Character] { model.characters.filter { !$0.isFallen } }
    private var fallen: [Character] { model.fallen }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if living.isEmpty {
                Label("None of your heroes can go: \(fallenNames) died on an adventure. Forge a new hero to open a door.",
                      systemImage: "leaf.fill")
                    .font(.proseSmall)
                    .foregroundStyle(Palette.parchment.opacity(0.9))
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .card()
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(alignment: .top, spacing: 12) {
                        // Once any hero has a sheet, every card keeps a line for it, so the row stays level.
                        let showVitals = living.contains { $0.sheet != nil }
                        // A card widens with the text (to 150), so a name and vitals wrap instead of being cut.
                        let side = min(max(84 * percent / 100, 84), 150)
                        ForEach(living) { hero in
                            let selected = hero.id == selection
                            Button {
                                withAnimation(.snappy) { selection = hero.id }
                            } label: {
                                VStack(spacing: 6) {
                                    PortraitView(url: hero.portraitURL, size: side)
                                    Text(hero.name)
                                        .font(.serif(.footnote, weight: .semibold))
                                        .lineLimit(typeSize.isAccessibilitySize ? nil : 1)
                                        .minimumScaleFactor(0.8)
                                        .multilineTextAlignment(.center)
                                        .fixedSize(horizontal: false, vertical: true)
                                    if showVitals {
                                        Text(hero.shortVitalsLine ?? " ")
                                            .font(.caption2.weight(.semibold))
                                            .monospacedDigit()
                                            .foregroundStyle(Palette.verdigris)
                                            .lineLimit(typeSize.isAccessibilitySize ? nil : 1)
                                            .minimumScaleFactor(0.8)
                                            .multilineTextAlignment(.center)
                                            .fixedSize(horizontal: false, vertical: true)
                                    }
                                }
                                .frame(width: side + 8)
                                .frame(maxHeight: .infinity, alignment: .top)
                                .padding(8)
                                .card(highlighted: selected)
                                .dynamicTypeSize(...DynamicTypeSize.accessibility2)
                            }
                            .buttonStyle(.plain)
                            .accessibilityAddTraits(selected ? .isSelected : [])
                        }
                    }
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.vertical, 2)
                }
                .scrollClipDisabled()
                if !fallen.isEmpty {
                    Text("\(fallenNames) \(fallen.count == 1 ? "has" : "have") fallen and can't go on another adventure.")
                        .font(.footnote.italic())
                        .foregroundStyle(Palette.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .onAppear { pickLiving() }
        .onChange(of: living.map(\.id)) { _, _ in pickLiving() }
    }

    private var fallenNames: String {
        ListFormatter.localizedString(byJoining: fallen.map(\.name))
    }

    /// Keeps the selection on a hero who can go.
    private func pickLiving() {
        if !living.contains(where: { $0.id == selection }) { selection = living.first?.id }
    }
}

/// The dungeon master archetypes, as cards.
struct DungeonMasterPicker: View {
    let masters: [DungeonMasterInfo]
    @Binding var selection: String
    var enabled = true

    var body: some View {
        VStack(spacing: 10) {
            ForEach(masters) { dm in
                let selected = dm.id == selection
                Button {
                    withAnimation(.snappy) { selection = dm.id }
                } label: {
                    DungeonMasterRow(dm: dm, selected: selected, expanded: selected)
                }
                .buttonStyle(.plain)
                .disabled(!enabled)
                .accessibilityAddTraits(selected ? .isSelected : [])
            }
        }
    }
}

struct DungeonMasterRow: View {
    let dm: DungeonMasterInfo
    var selected = false
    var expanded = true

    var body: some View {
        let accent = dm.accent.map(Color.init(hex:)) ?? Palette.gold
        HStack(alignment: .top, spacing: 14) {
            ZStack {
                Circle().fill(accent.opacity(0.18))
                Image(systemName: dm.symbol ?? "theatermasks.fill")
                    .font(.system(size: 22))
                    .foregroundStyle(accent)
            }
            .frame(width: 48, height: 48)
            VStack(alignment: .leading, spacing: 4) {
                Text(dm.name).font(.display(18))
                Text(dm.tagline).font(.proseSmall.italic()).foregroundStyle(accent)
                if expanded {
                    Text(dm.description)
                        .font(.footnote)
                        .foregroundStyle(Palette.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 0)
            if selected { Image(systemName: "checkmark.seal.fill").foregroundStyle(accent) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .card(highlighted: selected)
    }
}

struct NewGameView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var heroId: String?
    @State private var dungeonMaster = ""
    @State private var working = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    VStack(alignment: .leading, spacing: 10) {
                        SectionLabel("Your hero")
                        HeroPicker(selection: $heroId)
                    }
                    VStack(alignment: .leading, spacing: 10) {
                        SectionLabel("Your dungeon master")
                        DungeonMasterPicker(masters: model.catalog?.dungeonMasters ?? [], selection: $dungeonMaster)
                        Text("You can change your mind in the lobby, until the door opens.")
                            .font(.footnote.italic()).foregroundStyle(Palette.muted)
                    }
                    ErrorLine(text: error)
                }
                .padding(20)
                .frame(maxWidth: 640)
                .frame(maxWidth: .infinity)
            }
            .safeAreaInset(edge: .bottom) {
                Button {
                    Task { await create() }
                } label: {
                    if working { ProgressView().tint(Palette.ink) } else { Label("Open the door", systemImage: "door.left.hand.open") }
                }
                .buttonStyle(.gilded)
                .disabled(heroId == nil || dungeonMaster.isEmpty || working)
                .padding(20)
                .background(Palette.ink.opacity(0.95))
            }
            .screenChrome()
            .navigationTitle("A New Adventure")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .onAppear { if dungeonMaster.isEmpty { dungeonMaster = model.catalog?.dungeonMasters.first?.id ?? "" } }
        }
    }

    private func create() async {
        guard let heroId else { return }
        working = true
        defer { working = false }
        do {
            let state = try await model.api.createGame(characterId: heroId, dungeonMaster: dungeonMaster)
            dismiss()
            model.enter(state)
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct JoinGameView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var code: String

    /// `code`: a door code already known (from an invitation).
    init(code: String = "") {
        _code = State(initialValue: String(code.uppercased().prefix(6)))
    }
    @State private var heroId: String?
    @State private var working = false
    @State private var error: String?
    @FocusState private var codeFocused: Bool

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    VStack(alignment: .leading, spacing: 10) {
                        SectionLabel("Door code")
                        Text("Ask your host for the six letters on their door.")
                            .font(.footnote).foregroundStyle(Palette.muted)
                        ZStack {
                            TextField("", text: $code)
                                .textInputAutocapitalization(.characters)
                                .autocorrectionDisabled()
                                .keyboardType(.asciiCapable)
                                .focused($codeFocused)
                                .foregroundStyle(.clear)
                                .tint(.clear)
                                .opacity(0.02)
                                .onChange(of: code) { _, new in
                                    let cleaned = String(new.uppercased().filter { $0.isLetter || $0.isNumber }.prefix(6))
                                    if cleaned != new { code = cleaned }
                                }
                            CodeTiles(code: code, active: codeFocused)
                                .allowsHitTesting(false)
                        }
                        .contentShape(.rect)
                        .onTapGesture { codeFocused = true }
                    }
                    VStack(alignment: .leading, spacing: 10) {
                        SectionLabel("Your hero")
                        HeroPicker(selection: $heroId)
                    }
                    ErrorLine(text: error)
                }
                .padding(20)
                .frame(maxWidth: 640)
                .frame(maxWidth: .infinity)
            }
            .safeAreaInset(edge: .bottom) {
                Button {
                    Task { await join() }
                } label: {
                    if working { ProgressView().tint(Palette.ink) } else { Label("Knock", systemImage: "hand.raised.fill") }
                }
                .buttonStyle(.gilded)
                .disabled(code.count != 6 || heroId == nil || working)
                .padding(20)
                .background(Palette.ink.opacity(0.95))
            }
            .screenChrome()
            .navigationTitle("Join a Party")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .onAppear { codeFocused = code.count != 6 }
        }
    }

    private func join() async {
        guard let heroId else { return }
        working = true
        defer { working = false }
        do {
            let state = try await model.api.join(code, characterId: heroId)
            dismiss()
            model.enter(state)
        } catch let api as APIError where api.status == 404 {
            error = "No door with that code. Check the letters with your host."
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// Six letter tiles, used to enter a code and to show one off.
struct CodeTiles: View {
    let code: String
    var active = false
    var size: CGFloat = 46

    var body: some View {
        HStack(spacing: 8) {
            ForEach(0..<6, id: \.self) { i in
                let chars = Array(code)
                let letter = i < chars.count ? String(chars[i]) : ""
                Text(letter)
                    .font(.system(size: size * 0.5, weight: .bold, design: .serif))
                    .frame(width: size, height: size * 1.2)
                    .background(Palette.surface, in: .rect(cornerRadius: 8))
                    .overlay {
                        RoundedRectangle(cornerRadius: 8)
                            .strokeBorder(Palette.gold.opacity(active && i == chars.count ? 1 : 0.35),
                                          lineWidth: active && i == chars.count ? 2 : 1)
                    }
            }
        }
        .frame(maxWidth: .infinity)
    }
}
