#if DEBUG
import SwiftUI

/// A Roll20-like tactical map of the room the party is in: a 5-foot grid, tokens with hit-point
/// rings, movement range, and the 5 / 30 / 60 foot range bands from the server.
struct ProtoMapTab: View {
    @Bindable var session: GameSession
    var preselectedTarget: String? = nil

    @State private var targetId: String?
    @State private var appeared = false

    private let cols = 10
    private let rows = 8
    private let feetPerSquare = 5
    /// Blocked squares: two pillars in the hall.
    private let blocked: Set<ProtoGrid.Point> = [.init(3, 2), .init(6, 2)]

    var body: some View {
        VStack(spacing: 0) {
            initiative
            GeometryReader { geo in
                let cell = min(36, floor((geo.size.width - 16) / CGFloat(cols)))
                let board = CGSize(width: cell * CGFloat(cols), height: cell * CGFloat(rows))
                ScrollView([.horizontal, .vertical], showsIndicators: false) {
                    ZStack(alignment: .topLeading) {
                        boardView(cell: cell)
                            .frame(width: board.width, height: board.height)
                    }
                    .padding(8)
                    .frame(minWidth: geo.size.width, minHeight: geo.size.height)
                }
            }
            legend
            if let target = token(targetId) {
                targetCard(target)
            }
        }
        .onAppear {
            if !appeared {
                targetId = preselectedTarget
                appeared = true
            }
        }
    }

    // MARK: Initiative

    private var initiative: some View {
        let combatants = session.state.rules?.combat?.combatants ?? tokens.map(\.combatant)
        return VStack(alignment: .leading, spacing: 6) {
            HStack {
                SectionLabel("Initiative")
                Spacer()
                if let band = session.state.rules?.combat?.band {
                    Text("\(band) fight")
                        .font(.system(size: 11, weight: .semibold, design: .serif))
                        .foregroundStyle(Palette.ember)
                }
            }
            .padding(.horizontal, 16)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(Array(combatants.enumerated()), id: \.element.id) { index, combatant in
                        let selected = combatant.id == (targetId ?? DemoData.miraId)
                        HStack(spacing: 5) {
                            Text("\(index + 1)")
                                .font(.system(size: 10, weight: .bold, design: .serif))
                                .foregroundStyle(Palette.muted)
                            Text(combatant.name)
                                .font(.system(size: 12, weight: .semibold, design: .serif))
                                .lineLimit(2)
                                .minimumScaleFactor(0.7)
                                .foregroundStyle(combatant.id == DemoData.miraId ? Palette.gold : Palette.parchment)
                            if let position = combatant.position {
                                Text(position)
                                    .font(.system(size: 10, design: .serif))
                                    .foregroundStyle(Palette.muted)
                            }
                        }
                        .padding(.horizontal, 8)
                        .padding(.vertical, 6)
                        .background(Palette.surface, in: Capsule())
                        .overlay {
                            Capsule().strokeBorder(
                                selected ? Palette.gold : (combatant.isFoe ? Palette.ember : Palette.verdigris).opacity(0.6),
                                lineWidth: selected ? 1.5 : 1)
                        }
                        .onTapGesture { withAnimation(.snappy) { targetId = combatant.id == targetId ? nil : combatant.id } }
                    }
                }
                .padding(.horizontal, 16)
            }
        }
        .padding(.top, 8)
        .padding(.bottom, 6)
        .background(Palette.ink)
    }

    // MARK: Board

    private func boardView(cell: CGFloat) -> some View {
        let hero = token(DemoData.miraId)
        return ZStack {
            grid(cell: cell)
            if let hero {
                rangeRings(from: hero, cell: cell)
                movementWash(from: hero, cell: cell)
            }
            pillars(cell: cell)
            if let hero, let target = token(targetId), target.id != hero.id {
                measure(from: hero, to: target, cell: cell)
            }
            ForEach(tokens) { token in
                tokenView(token, cell: cell)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay {
            RoundedRectangle(cornerRadius: 10)
                .strokeBorder(Palette.gold.opacity(0.45), lineWidth: 2)
        }
    }

    private func grid(cell: CGFloat) -> some View {
        Canvas { context, _ in
            for r in 0..<rows {
                for c in 0..<cols {
                    let rect = CGRect(x: CGFloat(c) * cell, y: CGFloat(r) * cell, width: cell, height: cell)
                    let even = (c + r) % 2 == 0
                    context.fill(Path(rect), with: .color(even ? Color(hex: "#241A14") : Color(hex: "#1B1410")))
                }
            }
            var lines = Path()
            for c in 0...cols {
                let x = CGFloat(c) * cell
                lines.move(to: CGPoint(x: x, y: 0))
                lines.addLine(to: CGPoint(x: x, y: CGFloat(rows) * cell))
            }
            for r in 0...rows {
                let y = CGFloat(r) * cell
                lines.move(to: CGPoint(x: 0, y: y))
                lines.addLine(to: CGPoint(x: CGFloat(cols) * cell, y: y))
            }
            context.stroke(lines, with: .color(Color(hex: "#3A2C20").opacity(0.9)), lineWidth: 0.6)
        }
    }

    private func rangeRings(from hero: ProtoToken, cell: CGFloat) -> some View {
        let center = hero.center(cell: cell)
        return ZStack {
            ring(center: center, feet: 60, cell: cell, color: Palette.muted.opacity(0.18), stroke: Palette.muted.opacity(0.45))
            ring(center: center, feet: 30, cell: cell, color: Palette.verdigris.opacity(0.10), stroke: Palette.verdigris.opacity(0.55))
            ring(center: center, feet: 5, cell: cell, color: Palette.gold.opacity(0.10), stroke: Palette.gold.opacity(0.7))
        }
        .allowsHitTesting(false)
    }

    private func ring(center: CGPoint, feet: Int, cell: CGFloat, color: Color, stroke: Color) -> some View {
        let radius = CGFloat(feet) / CGFloat(feetPerSquare) * cell
        return Circle()
            .fill(color)
            .overlay { Circle().strokeBorder(style: StrokeStyle(lineWidth: 1.2, dash: feet == 5 ? [] : [5, 4])).foregroundStyle(stroke) }
            .frame(width: radius * 2, height: radius * 2)
            .position(center)
    }

    private func movementWash(from hero: ProtoToken, cell: CGFloat) -> some View {
        let speed = session.state.standing(DemoData.miraId)?.speed ?? 30
        let reach = max(1, speed / feetPerSquare)
        return ZStack {
            ForEach(0..<rows, id: \.self) { r in
                ForEach(0..<cols, id: \.self) { c in
                    let point = ProtoGrid.Point(c, r)
                    if !blocked.contains(point), chebyshev(hero.col, hero.row, c, r) <= reach, (c != hero.col || r != hero.row) {
                        RoundedRectangle(cornerRadius: 3)
                            .fill(Palette.gold.opacity(0.13))
                            .overlay { RoundedRectangle(cornerRadius: 3).strokeBorder(Palette.gold.opacity(0.28), lineWidth: 0.6) }
                            .frame(width: cell - 2, height: cell - 2)
                            .position(x: (CGFloat(c) + 0.5) * cell, y: (CGFloat(r) + 0.5) * cell)
                    }
                }
            }
        }
        .allowsHitTesting(false)
    }

    private func pillars(cell: CGFloat) -> some View {
        ForEach(Array(blocked), id: \.self) { point in
            RoundedRectangle(cornerRadius: 5)
                .fill(Color(hex: "#4A3A2A"))
                .overlay { RoundedRectangle(cornerRadius: 5).strokeBorder(Palette.gold.opacity(0.25), lineWidth: 1) }
                .frame(width: cell * 0.72, height: cell * 0.72)
                .position(x: (CGFloat(point.col) + 0.5) * cell, y: (CGFloat(point.row) + 0.5) * cell)
                .accessibilityLabel("Pillar")
        }
    }

    private func measure(from hero: ProtoToken, to target: ProtoToken, cell: CGFloat) -> some View {
        let a = hero.center(cell: cell)
        let b = target.center(cell: cell)
        let mid = CGPoint(x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 10)
        let feet = distance(from: hero, to: target)
        return ZStack {
            Path { path in
                path.move(to: a)
                path.addLine(to: b)
            }
            .stroke(style: StrokeStyle(lineWidth: 1.8, dash: [6, 5]))
            .foregroundStyle(Palette.gold)
            Text("\(feet) ft")
                .font(.system(size: 11, weight: .bold, design: .serif))
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(Palette.ink.opacity(0.92), in: Capsule())
                .overlay { Capsule().strokeBorder(Palette.gold.opacity(0.7), lineWidth: 1) }
                .foregroundStyle(Palette.gold)
                .position(mid)
        }
        .allowsHitTesting(false)
    }

    private func tokenView(_ token: ProtoToken, cell: CGFloat) -> some View {
        let selected = token.id == targetId || (targetId == nil && token.id == DemoData.miraId)
        let size = min(cell * 0.82, 34)
        return Button {
            withAnimation(.snappy) { targetId = token.id == targetId ? nil : token.id }
        } label: {
            ZStack {
                Circle()
                    .stroke(token.ringColor, lineWidth: 3)
                    .frame(width: size + 5, height: size + 5)
                Circle()
                    .trim(from: 0, to: token.gauge)
                    .stroke(token.ringColor, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .frame(width: size + 5, height: size + 5)
                if let url = token.portrait {
                    PortraitView(url: url, size: size, circular: true)
                } else {
                    ZStack {
                        Circle().fill(token.isFoe ? Palette.ember.opacity(0.85) : Palette.verdigris.opacity(0.85))
                        Text(token.initials)
                            .font(.system(size: size * 0.38, weight: .bold, design: .serif))
                            .foregroundStyle(.white)
                    }
                    .frame(width: size, height: size)
                    .overlay { Circle().strokeBorder(Palette.gold.opacity(0.4), lineWidth: 1) }
                }
            }
            .shadow(color: selected ? Palette.gold.opacity(0.7) : .black.opacity(0.4), radius: selected ? 5 : 2)
            .scaleEffect(selected ? 1.08 : 1)
        }
        .buttonStyle(.plain)
        .position(token.center(cell: cell))
        .accessibilityLabel(token.accessibility)
    }

    // MARK: Legend & target

    private var legend: some View {
        HStack(spacing: 10) {
            legendDot(Palette.gold, "Engaged 5 ft")
            legendDot(Palette.verdigris, "Near 30 ft")
            legendDot(Palette.muted, "Far 60 ft")
            Text("Gold wash: 30 ft move")
                .font(.system(size: 10, design: .serif))
                .foregroundStyle(Palette.muted)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 6)
        .background(Palette.ink)
    }

    private func legendDot(_ color: Color, _ label: String) -> some View {
        HStack(spacing: 4) {
            Circle().stroke(color, lineWidth: 1.5).frame(width: 9, height: 9)
            Text(label)
                .font(.system(size: 10, design: .serif))
                .foregroundStyle(Palette.muted)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
    }

    private func targetCard(_ target: ProtoToken) -> some View {
        let hero = token(DemoData.miraId)
        let feet = hero.map { distance(from: $0, to: target) } ?? 0
        let band = bandName(feet)
        let inMelee = feet <= 5
        let fireBoltRange = 120
        let inSpell = feet <= fireBoltRange
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(target.name)
                    .font(.serif(.headline, weight: .bold))
                    .foregroundStyle(target.id == DemoData.miraId ? Palette.gold : Palette.parchment)
                    .lineLimit(2)
                    .minimumScaleFactor(0.8)
                Spacer()
                Text(target.health)
                    .font(.serif(.subheadline, weight: .semibold))
                    .foregroundStyle(target.isFoe ? Palette.ember : Palette.verdigris)
            }
            if target.id != DemoData.miraId {
                Text("\(feet) ft · \(band) · \(inMelee ? "In melee reach" : "Out of melee reach")")
                    .font(.serif(.footnote))
                    .foregroundStyle(Palette.muted)
                Text(inSpell ? "Fire Bolt is in range (120 ft)." : "Fire Bolt is out of range.")
                    .font(.serif(.footnote, weight: .semibold))
                    .foregroundStyle(inSpell ? Palette.verdigris : Palette.ember)
                if target.isFoe {
                    HStack(spacing: 8) {
                        Button("Attack") { }
                            .font(.serif(.subheadline, weight: .semibold))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 10)
                            .background(inMelee ? Palette.gold : Palette.raised, in: RoundedRectangle(cornerRadius: 10))
                            .foregroundStyle(inMelee ? Palette.ink : Palette.muted)
                            .disabled(!inMelee)
                        Button("Cast Fire Bolt") { }
                            .font(.serif(.subheadline, weight: .semibold))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 10)
                            .background(inSpell ? Palette.gold : Palette.raised, in: RoundedRectangle(cornerRadius: 10))
                            .foregroundStyle(inSpell ? Palette.ink : Palette.muted)
                            .disabled(!inSpell)
                    }
                    .buttonStyle(.plain)
                }
            } else {
                Text("Your hero. Gold squares are a 30-foot move. Rings are engaged, near and far.")
                    .font(.serif(.footnote))
                    .foregroundStyle(Palette.muted)
            }
        }
        .padding(12)
        .background(Palette.surface)
        .overlay(alignment: .top) { Rectangle().fill(Palette.gold.opacity(0.25)).frame(height: 1) }
    }

    // MARK: Model

    private var tokens: [ProtoToken] {
        let portraits: [String: URL?] = [
            DemoData.miraId: DemoData.miraPortrait.flatMap(URL.init(string:)),
            DemoData.brynId: DemoData.brynPortrait.flatMap(URL.init(string:)),
            DemoData.pipId: DemoData.pipPortrait.flatMap(URL.init(string:)),
        ]
        // Grand chamber 50 × 40 ft. Mira in the south, the archer as far to the north-east as the room allows.
        let places: [(String, Int, Int)] = [
            (DemoData.miraId, 3, 6),
            (DemoData.brynId, 2, 5),
            ("foe-1", 2, 4),
            (DemoData.pipId, 5, 5),
            ("foe-3", 6, 3),
            ("foe-2", 9, 0),
        ]
        let combatants = session.state.rules?.combat?.combatants ?? []
        return places.compactMap { id, col, row in
            guard let combatant = combatants.first(where: { $0.id == id }) else { return nil }
            let hero = session.state.player(id)?.character
            let initials = String(combatant.name.split(separator: " ").compactMap(\.first).prefix(2))
            return ProtoToken(id: id, name: combatant.name, col: col, row: row,
                              isFoe: combatant.isFoe, initials: initials.isEmpty ? "?" : initials,
                              portrait: portraits[id] ?? hero?.portraitURL,
                              combatant: combatant)
        }
    }

    private func token(_ id: String?) -> ProtoToken? {
        tokens.first { $0.id == id }
    }

    private func distance(from a: ProtoToken, to b: ProtoToken) -> Int {
        let dx = Double(a.col - b.col)
        let dy = Double(a.row - b.row)
        return Int((sqrt(dx * dx + dy * dy) * Double(feetPerSquare)).rounded())
    }

    private func bandName(_ feet: Int) -> String {
        if feet <= 5 { return "Engaged" }
        if feet <= 30 { return "Near" }
        return "Far"
    }

    private func chebyshev(_ c1: Int, _ r1: Int, _ c2: Int, _ r2: Int) -> Int {
        max(abs(c1 - c2), abs(r1 - r2))
    }
}

struct ProtoGrid {
    struct Point: Hashable {
        let col: Int
        let row: Int
        init(_ col: Int, _ row: Int) { self.col = col; self.row = row }
    }
}

struct ProtoToken: Identifiable {
    let id: String
    let name: String
    let col: Int
    let row: Int
    let isFoe: Bool
    let initials: String
    let portrait: URL?
    let combatant: Combatant

    var health: String { combatant.healthText }
    var gauge: CGFloat {
        let g = combatant.gauge
        guard g.most > 0 else { return 0 }
        return CGFloat(g.now) / CGFloat(g.most)
    }
    var ringColor: Color { isFoe ? Palette.ember : Palette.verdigris }
    func center(cell: CGFloat) -> CGPoint {
        CGPoint(x: (CGFloat(col) + 0.5) * cell, y: (CGFloat(row) + 0.5) * cell)
    }
    var accessibility: String {
        "\(name), \(health), \(combatant.position ?? "on the grid")"
    }
}
#endif
