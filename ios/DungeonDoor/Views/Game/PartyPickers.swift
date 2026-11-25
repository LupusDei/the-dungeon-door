import SwiftUI

/// Pick which of your heroes walks through the door.
struct HeroPicker: View {
    @Environment(AppModel.self) private var model
    @Binding var selection: String?

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 12) {
                ForEach(model.characters) { hero in
                    let selected = hero.id == selection
                    Button {
                        withAnimation(.snappy) { selection = hero.id }
                    } label: {
                        VStack(spacing: 6) {
                            PortraitView(url: hero.portraitURL, size: 84)
                            Text(hero.name).font(.display(14)).lineLimit(1)
                        }
                        .frame(width: 92)
                        .padding(8)
                        .card(highlighted: selected)
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(selected ? .isSelected : [])
                }
            }
            .padding(.vertical, 2)
        }
        .scrollClipDisabled()
        .onAppear { if selection == nil { selection = model.characters.first?.id } }
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
    @State private var code = ""
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
            .onAppear { codeFocused = true }
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
