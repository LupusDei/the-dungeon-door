import SwiftUI

/// The people this player has adventured with who are not here yet. A companion is a person: the
/// row invites them, whichever hero they bring, and each of their heroes who can go is a tap away
/// to ask for by name. The name they gave themselves is their name; a pencil gives them a nickname
/// that only this player sees, shown beside it. A hero who has died or retired is never offered. Nothing for a player who
/// has not adventured with anyone, or once the party is full.
///
/// The lobby loads the list and keeps it: this view is empty until there is someone to call, and
/// an empty view runs no task of its own.
struct CompanionsToCall: View {
    @Environment(AppModel.self) private var model
    let session: GameSession
    @Binding var companions: [Companion]

    /// Who has been invited from this lobby, and the hero asked for (nil: whichever they bring).
    @State private var invited: [String: String?] = [:]
    /// The companion being named, and what is typed so far.
    @State private var naming: Companion?
    @State private var typed = ""

    private var state: GameState { session.state }

    var body: some View {
        let absent = CompanionCall.absent(companions, here: Set(state.players.map(\.playerId)))
        if !absent.isEmpty && state.players.count < 6 {
            VStack(alignment: .leading, spacing: 10) {
                SectionLabel("Call your companions")
                VStack(spacing: 0) {
                    ForEach(Array(absent.enumerated()), id: \.element.id) { index, companion in
                        if index > 0 {
                            Rectangle().fill(Palette.gold.opacity(0.14)).frame(height: 1).padding(.leading, 14)
                        }
                        row(companion)
                    }
                }
                .card()
                Text(footnote(absent))
                    .font(.caption)
                    .foregroundStyle(Palette.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .alert("A nickname for them", isPresented: Binding(get: { naming != nil }, set: { if !$0 { naming = nil } }), presenting: naming) { companion in
                TextField("Nickname", text: $typed)
                    .textInputAutocapitalization(.words)
                    .autocorrectionDisabled()
                Button("Save") { Task { await name(companion, typed) } }
                Button("Cancel", role: .cancel) {}
            } message: { companion in
                Text(CompanionCall.namingMessage(for: companion))
            }
        }
    }

    private func footnote(_ absent: [Companion]) -> String {
        let reach = model.catalog?.push == true
            ? "They get a notification and find your door on their home screen."
            : "They find your door on their home screen."
        return absent.contains { !$0.heroes.isEmpty } ? "Invite the person, or tap a hero to ask for that one. \(reach)" : reach
    }

    private func row(_ companion: Companion) -> some View {
        let isInvited = invited[companion.playerId] != nil
        let asked = invited[companion.playerId] ?? nil
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Image(systemName: "person.fill")
                    .font(.system(size: 13))
                    .foregroundStyle(Palette.muted)
                    .frame(width: 22)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        // Quotes mark a nickname of the player's own, wherever it stands: here in
                        // place of a name they have not given, or beside the one they have.
                        Text(companion.namedBy == "you" ? "\u{201C}\(companion.name)\u{201D}" : companion.name)
                            .font(.serif(.body, weight: .semibold))
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityLabel(companion.namedBy == "you" ? "\(companion.name), your nickname for them" : companion.name)
                        if let nickname = companion.shownNickname {
                            // Their own name is their name; the player's nickname sits beside it.
                            Text("\u{201C}\(nickname)\u{201D}")
                                .font(.serif(.subheadline).italic())
                                .foregroundStyle(Palette.muted)
                                .fixedSize(horizontal: false, vertical: true)
                                .accessibilityLabel("your nickname for them: \(nickname)")
                        }
                        Button {
                            typed = companion.nickname ?? ""
                            naming = companion
                        } label: {
                            Image(systemName: "pencil")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(Palette.gold.opacity(0.85))
                                .frame(width: 30, height: 30)
                                .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Give \(companion.name) a nickname")
                        .accessibilityIdentifier("name-\(companion.playerId)")
                    }
                    if let caption = CompanionCall.caption(for: companion) {
                        Text(caption)
                            .font(.caption)
                            .foregroundStyle(Palette.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 8)
                if isInvited {
                    Label("Invited", systemImage: "checkmark")
                        .font(.serif(.footnote, weight: .semibold))
                        .foregroundStyle(Palette.verdigris)
                        .accessibilityIdentifier("invited-\(companion.playerId)")
                } else {
                    Button("Invite") { Task { await invite(companion, hero: nil) } }
                        .font(.serif(.footnote, weight: .semibold))
                        .foregroundStyle(Palette.gold)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .overlay { Capsule().strokeBorder(Palette.gold.opacity(0.6), lineWidth: 1) }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Invite \(companion.name)")
                        .accessibilityIdentifier("invite-\(companion.playerId)")
                }
            }
            if !companion.heroes.isEmpty {
                // Wrapped, not scrolled: every hero they can bring is in sight, and so is the one asked for.
                FlowLayout(spacing: 8) {
                    ForEach(companion.heroes) { hero in
                        chip(hero, of: companion, asked: asked == hero.id)
                    }
                }
                .padding(.leading, 32)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .frame(minHeight: 46)
    }

    /// One of their heroes who can go. A tap asks for that hero; a tap on the one asked for asks
    /// for the person alone again.
    private func chip(_ hero: Companion.Hero, of companion: Companion, asked: Bool) -> some View {
        let className = model.catalog?.name(hero.characterClass, in: \.classes) ?? SRD.name(hero.characterClass)
        return Button {
            Task { await invite(companion, hero: asked ? nil : hero) }
        } label: {
            HStack(spacing: 8) {
                PortraitView(url: hero.portraitURL, size: 34, circular: true, opensViewer: false)
                VStack(alignment: .leading, spacing: 0) {
                    Text(hero.name)
                        .font(.serif(.footnote, weight: .semibold))
                        .lineLimit(1)
                    Text(CompanionCall.heroLine(hero, className: className))
                        .font(.caption2.weight(.semibold))
                        .monospacedDigit()
                        .foregroundStyle(Palette.verdigris)
                        .lineLimit(1)
                }
                if asked {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 14))
                        .foregroundStyle(Palette.gold)
                }
            }
            .padding(.leading, 5)
            .padding(.trailing, 12)
            .padding(.vertical, 5)
            .background(asked ? Palette.gold.opacity(0.14) : Palette.raised.opacity(0.6), in: .capsule)
            .overlay { Capsule().strokeBorder(Palette.gold.opacity(asked ? 0.9 : 0.25), lineWidth: 1) }
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(CompanionCall.heroLabel(hero, className: className, asked: asked))
        .accessibilityAddTraits(asked ? [.isButton, .isSelected] : .isButton)
        .accessibilityIdentifier("hero-\(hero.id)")
    }

    private func invite(_ companion: Companion, hero: Companion.Hero?) async {
        do {
            try await model.api.invite(session.code, playerId: companion.playerId, characterId: hero?.id)
            withAnimation(.snappy) { invited[companion.playerId] = .some(hero?.id) }
        } catch {
            session.error = error.localizedDescription
        }
    }

    private func name(_ companion: Companion, _ name: String) async {
        do {
            let fresh = try await model.api.name(companion: companion.playerId, name)
            withAnimation(.snappy) { companions = fresh }
        } catch {
            session.error = error.localizedDescription
        }
    }
}

/// The name this player goes by: what the people they adventure with see when the player invites
/// them, and how those people find the player again whatever became of the hero. There are no
/// accounts, so it is asked for here, where a party gathers.
struct YourNameRow: View {
    @Environment(AppModel.self) private var model
    @State private var editing = false
    @State private var typed = ""
    @State private var error: String?

    var body: some View {
        Button {
            typed = model.myName ?? ""
            editing = true
        } label: {
            HStack(spacing: 10) {
                Image(systemName: model.myName == nil ? "person.crop.circle.badge.plus" : "person.crop.circle")
                    .font(.system(size: 18))
                    .foregroundStyle(Palette.gold)
                    .frame(width: 26)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(model.myName.map { "Your companions know you as \($0)" } ?? "Add your name")
                        .font(.serif(.subheadline, weight: .semibold))
                        .foregroundStyle(Palette.parchment)
                        .fixedSize(horizontal: false, vertical: true)
                    if model.myName == nil {
                        Text("So the people you play with can call on you by name, whichever hero you bring.")
                            .font(.caption)
                            .foregroundStyle(Palette.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 8)
                Text(model.myName == nil ? "Add" : "Change")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Palette.gold)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("your-name")
        .alert("Your name", isPresented: $editing) {
            TextField("Your name", text: $typed)
                .textInputAutocapitalization(.words)
                .autocorrectionDisabled()
            Button("Save") { Task { await save() } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("The people you have adventured with see it. Leave it empty to go without one.")
        }
        if let error { ErrorLine(text: error) }
    }

    private func save() async {
        do {
            try await model.setMyName(typed)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}
