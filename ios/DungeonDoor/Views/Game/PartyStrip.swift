import SwiftUI

/// How the party stands, under the scene's title: a portrait, level, hit-point bar and armour class
/// for each hero, from the rules engine's numbers. Three heroes share the width; more than that
/// scroll sideways. A tap opens that hero's sheet when `open` is set. The tabbed play screen
/// leaves it unset: the Sheet tab is the sheet.
struct PartyStrip: View {
    let party: [HeroStanding]
    let players: [GamePlayer]
    /// The caller's player id, so their own hero stands out.
    let me: String
    /// Opens the sheet of the hero with this player id, when a caller still wants that tap.
    var open: ((String) -> Void)? = nil

    var body: some View {
        if party.count <= 3 {
            HStack(spacing: 8) {
                ForEach(party) { member in
                    button(member).frame(maxWidth: .infinity)
                }
            }
        } else {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(party) { member in
                        button(member).frame(width: 128)
                    }
                }
            }
            .scrollClipDisabled()
        }
    }

    @ViewBuilder private func button(_ member: HeroStanding) -> some View {
        if let open {
            Button {
                open(member.playerId)
            } label: {
                cell(member)
            }
            .buttonStyle(.plain)
            .accessibilityHint("Opens their character sheet")
        } else {
            cell(member)
        }
    }

    private func cell(_ member: HeroStanding) -> some View {
        let hero = players.first { $0.playerId == member.playerId }?.character
        let name = member.name.isEmpty ? hero?.name ?? "A hero" : member.name
        let standing = member.isUp
        let state = standing ? "\(member.hp)/\(member.maxHp)" : member.word
        return VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 7) {
                PortraitView(url: hero?.portraitURL, size: 30, circular: true)
                    .saturation(standing ? 1 : 0)
                    .opacity(standing ? 1 : 0.6)
                VStack(alignment: .leading, spacing: 0) {
                    Text(name)
                        .font(.system(size: 13, weight: .semibold, design: .serif))
                        .fixedSize(horizontal: false, vertical: true)
                        .foregroundStyle(member.playerId == me ? Palette.gold : Palette.parchment)
                    Text("Level \(member.level)")
                        .font(.system(size: 10.5, design: .serif))
                        .foregroundStyle(Palette.muted)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            HPBar(hp: standing ? member.hp : 0, maxHp: member.maxHp,
                  tint: Health.tint(hp: member.hp, maxHp: member.maxHp, standing: standing))
            HStack(spacing: 4) {
                if !standing {
                    Image(systemName: member.dead ? "xmark.circle.fill" : "arrow.down.circle.fill")
                        .foregroundStyle(Palette.ember)
                }
                Text(state)
                    .fontWeight(standing ? .regular : .semibold)
                    .foregroundStyle(standing ? Palette.parchment.opacity(0.85) : Palette.ember)
                Spacer(minLength: 0)
                Text("AC \(member.armorClass)").foregroundStyle(Palette.muted)
            }
            .font(.caption2)
            .monospacedDigit()
            .lineLimit(1)
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.surface.opacity(0.92), in: .rect(cornerRadius: 12))
        .contentShape(.rect)
        .overlay {
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(standing ? Palette.gold.opacity(member.playerId == me ? 0.5 : 0.2) : Palette.ember.opacity(0.45), lineWidth: 1)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(name), level \(member.level): \(standing ? "\(member.hp) of \(member.maxHp) hit points" : state), armour class \(member.armorClass)")
    }
}
