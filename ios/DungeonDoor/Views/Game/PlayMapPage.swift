import SwiftUI

/// In a fight, a tactical room on 5-foot squares. Outside a fight, the dungeon map, or an empty road.
struct PlayMapPage: View {
    @Bindable var session: GameSession
    var initialTarget: String?
    var openHero: (String) -> Void

    @State private var targetId: String?
    @State private var didApplyTarget = false

    private var state: GameState { session.state }
    private var inCombat: Bool { state.scene?.combat == true && state.rules?.combat != nil }

    var body: some View {
        Group {
            if inCombat, let combat = state.rules?.combat {
                battle(combat)
            } else if state.rules?.dungeon != nil {
                DungeonMapView(session: session, embedded: true)
            } else {
                emptyRoad
            }
        }
        .onAppear {
            guard !didApplyTarget else { return }
            didApplyTarget = true
            targetId = initialTarget
        }
    }

    private var emptyRoad: some View {
        VStack(spacing: 12) {
            Image(systemName: "map")
                .font(.system(size: 28))
                .foregroundStyle(Palette.gold)
            Text("No map for this stretch of road.")
                .font(.proseSmall.italic())
                .foregroundStyle(Palette.muted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(24)
    }

    private func battle(_ combat: Combat) -> some View {
        let room = BattleLayout.room(battlefield: state.scene?.battlefield, areaName: state.rules?.dungeon?.here?.name)
        let points = BattleLayout.points(combatants: combat.combatants, room: room)
        let tokens = combat.combatants.compactMap { combatant -> BattleToken? in
            guard let point = points[combatant.id] else { return nil }
            return BattleToken(combatant: combatant, point: point,
                               portrait: state.player(combatant.id)?.character.portraitURL)
        }
        let hero = tokens.first { $0.id == session.playerId }
        let actions = state.scene?.actions ?? []
        let heroSpeed = state.rules?.combat?.combatant(session.playerId)?.speedFeet
            ?? state.standing(session.playerId)?.movementFeet
            ?? session.me?.character.sheet?.speed
            ?? 30
        let occupied = Set(tokens.map(\.point))
        let legal = Set(actions.filter { $0.kind == "move" && $0.available }.flatMap(\.squares))
        let highlighted = legal.isEmpty ? BattleLayout.disk(from: hero?.point, speedFeet: heroSpeed, room: room, occupied: occupied) : legal

        return VStack(spacing: 0) {
            initiative(combat)
            GeometryReader { geo in
                let cell = min(36, floor((geo.size.width - 16) / CGFloat(max(room.columns, 1))))
                let board = CGSize(width: cell * CGFloat(room.columns), height: cell * CGFloat(room.rows))
                ScrollView([.horizontal, .vertical], showsIndicators: false) {
                    boardView(room: room, tokens: tokens, hero: hero, highlighted: highlighted, tappable: legal,
                              cell: cell, actions: actions)
                        .frame(width: board.width, height: board.height)
                        .padding(8)
                        .frame(minWidth: geo.size.width, minHeight: geo.size.height)
                }
            }
            caption(room: room, hasSquares: !legal.isEmpty)
            legend
            ErrorLine(text: session.error).padding(.horizontal, 16)
            if let target = tokens.first(where: { $0.id == targetId }) {
                targetCard(target, hero: hero, room: room, actions: actions)
            }
        }
    }

    private func initiative(_ combat: Combat) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                SectionLabel("Initiative")
                Spacer()
                if let band = combat.band {
                    Text("\(band) fight")
                        .font(.system(size: 11, weight: .semibold, design: .serif))
                        .foregroundStyle(Palette.ember)
                }
            }
            .padding(.horizontal, 16)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(Array(combat.combatants.enumerated()), id: \.element.id) { index, combatant in
                        let selected = combatant.id == targetId
                        HStack(spacing: 5) {
                            Text("\(index + 1)")
                                .font(.system(size: 10, weight: .bold, design: .serif))
                                .foregroundStyle(Palette.muted)
                            Text(combatant.name)
                                .font(.system(size: 12, weight: .semibold, design: .serif))
                                .fixedSize(horizontal: false, vertical: true)
                                .foregroundStyle(combatant.id == session.playerId ? Palette.gold : Palette.parchment)
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
                        .onTapGesture {
                            withAnimation(.snappy) { targetId = combatant.id == targetId ? nil : combatant.id }
                        }
                        .accessibilityLabel("\(combatant.name), \(combatant.healthSpoken)")
                        .accessibilityAddTraits(selected ? .isSelected : [])
                    }
                }
                .padding(.horizontal, 16)
            }
        }
        .padding(.top, 8)
        .padding(.bottom, 6)
        .background(Palette.ink)
    }

    private func boardView(room: BattleRoom, tokens: [BattleToken], hero: BattleToken?, highlighted: Set<GridPoint>,
                           tappable: Set<GridPoint>, cell: CGFloat, actions: [LegalAction]) -> some View {
        ZStack {
            grid(room: room, cell: cell)
            squares(highlighted, cell: cell, tappable: tappable, actions: actions)
            blockers(room, cell: cell)
            if let hero, let target = tokens.first(where: { $0.id == targetId }), target.id != hero.id {
                measure(from: hero, to: target, cell: cell, squareFeet: room.squareFeet)
            }
            if let hero {
                rings(from: hero.point, cell: cell, squareFeet: room.squareFeet)
            }
            ForEach(tokens) { token in
                tokenView(token, cell: cell)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay { RoundedRectangle(cornerRadius: 10).strokeBorder(Palette.gold.opacity(0.45), lineWidth: 2) }
    }

    private func grid(room: BattleRoom, cell: CGFloat) -> some View {
        Canvas { context, _ in
            for row in 0..<room.rows {
                for column in 0..<room.columns {
                    let rect = CGRect(x: CGFloat(column) * cell, y: CGFloat(row) * cell, width: cell, height: cell)
                    let even = (column + row) % 2 == 0
                    context.fill(Path(rect), with: .color(even ? Color(hex: "#241A14") : Color(hex: "#1B1410")))
                    if let kind = room.cover[GridPoint(x: column, y: row)] {
                        context.fill(Path(rect.insetBy(dx: 3, dy: 3)), with: .color(Palette.gold.opacity(kind == "three-quarters" ? 0.28 : 0.14)))
                    }
                }
            }
            var lines = Path()
            for column in 0...room.columns {
                let x = CGFloat(column) * cell
                lines.move(to: CGPoint(x: x, y: 0))
                lines.addLine(to: CGPoint(x: x, y: CGFloat(room.rows) * cell))
            }
            for row in 0...room.rows {
                let y = CGFloat(row) * cell
                lines.move(to: CGPoint(x: 0, y: y))
                lines.addLine(to: CGPoint(x: CGFloat(room.columns) * cell, y: y))
            }
            context.stroke(lines, with: .color(Color(hex: "#3A2C20").opacity(0.9)), lineWidth: 0.6)
        }
    }

    private func squares(_ highlighted: Set<GridPoint>, cell: CGFloat, tappable: Set<GridPoint>, actions: [LegalAction]) -> some View {
        let points = Array(highlighted)
        return ZStack {
            ForEach(points) { point in
                let canSend = tappable.contains(point)
                Button {
                    guard canSend, PlayTurn.canSend(status: session.state.status, scene: session.state.scene, busy: session.busy),
                          let action = PlayTurn.move(on: point, actions: actions) else { return }
                    Task { await session.vote(actionId: action.id, square: point, dash: action.namesDash, disengage: action.namesDisengage) }
                } label: {
                    RoundedRectangle(cornerRadius: 3)
                        .fill(Palette.gold.opacity(canSend ? 0.22 : 0.12))
                        .overlay {
                            RoundedRectangle(cornerRadius: 3)
                                .strokeBorder(Palette.gold.opacity(canSend ? 0.55 : 0.28), lineWidth: 0.6)
                        }
                        .frame(width: cell - 2, height: cell - 2)
                }
                .buttonStyle(.plain)
                .disabled(!canSend)
                .position(x: (CGFloat(point.x) + 0.5) * cell, y: (CGFloat(point.y) + 0.5) * cell)
                .accessibilityLabel(canSend ? "Move to \(point.x), \(point.y)" : "Within your speed")
            }
        }
    }

    private func blockers(_ room: BattleRoom, cell: CGFloat) -> some View {
        ForEach(Array(room.blocked)) { point in
            RoundedRectangle(cornerRadius: 5)
                .fill(Color(hex: "#4A3A2A"))
                .overlay { RoundedRectangle(cornerRadius: 5).strokeBorder(Palette.gold.opacity(0.25), lineWidth: 1) }
                .frame(width: cell * 0.72, height: cell * 0.72)
                .position(x: (CGFloat(point.x) + 0.5) * cell, y: (CGFloat(point.y) + 0.5) * cell)
                .accessibilityLabel("Blocked")
        }
    }

    private func rings(from origin: GridPoint, cell: CGFloat, squareFeet: Int) -> some View {
        let center = BattleLayout.center(origin, cell: cell)
        return ZStack {
            ring(center: center, feet: 60, cell: cell, squareFeet: squareFeet, fill: Palette.muted.opacity(0.12), stroke: Palette.muted.opacity(0.45))
            ring(center: center, feet: 30, cell: cell, squareFeet: squareFeet, fill: Palette.verdigris.opacity(0.10), stroke: Palette.verdigris.opacity(0.55))
            ring(center: center, feet: 5, cell: cell, squareFeet: squareFeet, fill: Palette.gold.opacity(0.10), stroke: Palette.gold.opacity(0.7), dashed: false)
        }
        .allowsHitTesting(false)
    }

    private func ring(center: CGPoint, feet: Int, cell: CGFloat, squareFeet: Int, fill: Color, stroke: Color, dashed: Bool = true) -> some View {
        let radius = CGFloat(feet) / CGFloat(max(squareFeet, 1)) * cell
        return Circle()
            .fill(fill)
            .overlay {
                Circle()
                    .strokeBorder(style: StrokeStyle(lineWidth: 1.2, dash: dashed ? [5, 4] : []))
                    .foregroundStyle(stroke)
            }
            .frame(width: radius * 2, height: radius * 2)
            .position(center)
    }

    private func measure(from hero: BattleToken, to target: BattleToken, cell: CGFloat, squareFeet: Int) -> some View {
        let start = BattleLayout.center(hero.point, cell: cell)
        let end = BattleLayout.center(target.point, cell: cell)
        let mid = CGPoint(x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 - 10)
        let feet = BattleLayout.feet(from: hero.point, to: target.point, squareFeet: squareFeet)
        return ZStack {
            Path { path in
                path.move(to: start)
                path.addLine(to: end)
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

    private func tokenView(_ token: BattleToken, cell: CGFloat) -> some View {
        let selected = token.id == targetId
        let size = min(cell * 0.82, 34)
        let gauge = token.gauge
        return Button {
            withAnimation(.snappy) { targetId = token.id == targetId ? nil : token.id }
        } label: {
            ZStack {
                Circle()
                    .stroke(Palette.muted.opacity(0.45), lineWidth: 3)
                    .frame(width: size + 5, height: size + 5)
                Circle()
                    .trim(from: 0, to: gauge)
                    .stroke(token.isFoe ? Palette.ember : Palette.verdigris, style: StrokeStyle(lineWidth: 3, lineCap: .round))
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
        .position(BattleLayout.center(token.point, cell: cell))
        .accessibilityLabel("\(token.name), \(token.combatant.healthSpoken)")
    }

    private func caption(room: BattleRoom, hasSquares: Bool) -> some View {
        let line = room.fromServer
            ? (hasSquares ? "Gold squares are legal moves." : "The room is from the table. Moves are still by range band.")
            : "Placed from engaged, near and far, until the table sends squares."
        return Text(line)
            .font(.system(size: 10, design: .serif))
            .foregroundStyle(Palette.muted)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 16)
            .padding(.top, 6)
            .background(Palette.ink)
    }

    private var legend: some View {
        HStack(spacing: 10) {
            legendDot(Palette.gold, "Engaged 5 ft")
            legendDot(Palette.verdigris, "Near 30 ft")
            legendDot(Palette.muted, "Far 60 ft")
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

    private func targetCard(_ target: BattleToken, hero: BattleToken?, room: BattleRoom, actions: [LegalAction]) -> some View {
        let feet = hero.map { BattleLayout.feet(from: $0.point, to: target.point, squareFeet: room.squareFeet) } ?? 0
        let attack = PlayTurn.attack(at: target.id, feet: feet, actions: actions)
        let spell = PlayTurn.spell(at: target.id, actions: actions)
        let reach = attack?.reachFeet ?? 5
        let engaged = hero?.combatant.engagedWith.contains(target.id) == true || target.combatant.engagedWith.contains(hero?.id ?? "")
        let inReach = feet <= reach || engaged
        let mine = target.id == session.playerId
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(target.name)
                    .font(.serif(.headline, weight: .bold))
                    .foregroundStyle(mine ? Palette.gold : Palette.parchment)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer()
                Text(target.combatant.healthText)
                    .font(.serif(.subheadline, weight: .semibold))
                    .foregroundStyle(target.isFoe ? Palette.ember : Palette.verdigris)
            }
            if mine {
                Text("Your hero. Gold squares are where you can move. Rings are 5, 30 and 60 feet.")
                    .font(.serif(.footnote))
                    .foregroundStyle(Palette.muted)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                let band = target.combatant.position.map { " · \($0)" } ?? ""
                Text("\(feet) ft\(band) · \(inReach ? "In reach" : "Out of melee reach")")
                    .font(.serif(.footnote))
                    .foregroundStyle(Palette.muted)
                if let spell {
                    let range = spell.rangeFeet.map { " (\($0.normal) ft)" } ?? ""
                    Text("\(spell.label) is in range\(range).")
                        .font(.serif(.footnote, weight: .semibold))
                        .foregroundStyle(Palette.verdigris)
                } else if actions.contains(where: { $0.kind == "spell" }) {
                    Text("No spell you can cast names \(target.name).")
                        .font(.serif(.footnote))
                        .foregroundStyle(Palette.muted)
                }
                HStack(spacing: 8) {
                    if let attack {
                        Button(attack.label) {
                            guard PlayTurn.canSend(status: session.state.status, scene: session.state.scene, busy: session.busy) else { return }
                            Task { await session.vote(actionId: attack.id, targets: [target.id]) }
                        }
                        .font(.serif(.subheadline, weight: .semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .background(Palette.gold, in: RoundedRectangle(cornerRadius: 10))
                        .foregroundStyle(Palette.ink)
                    }
                    if let spell {
                        Button(spell.label) {
                            guard PlayTurn.canSend(status: session.state.status, scene: session.state.scene, busy: session.busy) else { return }
                            Task { await session.vote(actionId: spell.id, targets: [target.id]) }
                        }
                        .font(.serif(.subheadline, weight: .semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .background(Palette.gold, in: RoundedRectangle(cornerRadius: 10))
                        .foregroundStyle(Palette.ink)
                    }
                }
                .buttonStyle(.plain)
                if !target.isFoe {
                    Button("Open sheet") { openHero(target.id) }
                        .font(.serif(.caption, weight: .semibold))
                        .foregroundStyle(Palette.gold)
                }
            }
        }
        .padding(12)
        .background(Palette.surface)
        .overlay(alignment: .top) { Rectangle().fill(Palette.gold.opacity(0.25)).frame(height: 1) }
    }
}

// MARK: - Layout

struct BattleRoom {
    var columns: Int
    var rows: Int
    var squareFeet: Int
    var blocked: Set<GridPoint>
    var cover: [GridPoint: String]
    /// True when `scene.battlefield` drew the room. False when tokens sit on range bands.
    var fromServer: Bool
}

struct BattleToken: Identifiable {
    let combatant: Combatant
    let point: GridPoint
    let portrait: URL?
    var id: String { combatant.id }
    var name: String { combatant.name }
    var isFoe: Bool { combatant.isFoe }
    var initials: String {
        let letters = combatant.name.split(separator: " ").compactMap { $0.first }
        let text = String(letters.prefix(2))
        return text.isEmpty ? "?" : text
    }
    var gauge: CGFloat { CGFloat(combatant.gauge) }
}

enum BattleLayout {
    static func room(battlefield: Battlefield?, areaName: String?) -> BattleRoom {
        if let field = battlefield, field.width > 0, field.height > 0 {
            var cover: [GridPoint: String] = [:]
            for cell in field.cover { cover[cell.point] = cell.kind ?? "cover" }
            return BattleRoom(columns: max(2, field.columns), rows: max(2, field.rows),
                              squareFeet: max(1, field.squareFeet), blocked: Set(field.walls),
                              cover: cover, fromServer: true)
        }
        let parsed = parseFeet(areaName) ?? (50, 40)
        return BattleRoom(columns: max(4, parsed.0 / 5), rows: max(4, parsed.1 / 5),
                          squareFeet: 5, blocked: [], cover: [:], fromServer: false)
    }

    /// "Grand chamber (50 x 40 ft.)" → (50, 40). Nil when the name has no pair of numbers.
    static func parseFeet(_ name: String?) -> (Int, Int)? {
        guard let name, let open = name.firstIndex(of: "("), let close = name[open...].firstIndex(of: ")") else { return nil }
        let inside = name[name.index(after: open)..<close].lowercased()
        let cleaned = inside.replacingOccurrences(of: "ft.", with: "").replacingOccurrences(of: "ft", with: "")
        let bits = cleaned.split { $0 == "x" || $0 == "×" }.map { $0.trimmingCharacters(in: .whitespaces) }
        guard bits.count >= 2, let width = Int(bits[0]), let height = Int(bits[1]), width > 0, height > 0 else { return nil }
        return (width, height)
    }

    static func points(combatants: [Combatant], room: BattleRoom) -> [String: GridPoint] {
        var used = room.blocked
        var result: [String: GridPoint] = [:]

        func inside(_ point: GridPoint) -> Bool {
            point.x >= 0 && point.y >= 0 && point.x < room.columns && point.y < room.rows
        }

        func claim(_ preferred: GridPoint) -> GridPoint {
            if inside(preferred), !used.contains(preferred) {
                used.insert(preferred)
                return preferred
            }
            let limit = max(room.columns, room.rows) + 1
            for radius in 1..<limit {
                for dx in -radius...radius {
                    for dy in -radius...radius {
                        if max(abs(dx), abs(dy)) != radius { continue }
                        let point = GridPoint(x: preferred.x + dx, y: preferred.y + dy)
                        if inside(point), !used.contains(point) {
                            used.insert(point)
                            return point
                        }
                    }
                }
            }
            return preferred
        }

        for combatant in combatants {
            if let square = combatant.square {
                result[combatant.id] = claim(square)
            }
        }

        let south = max(0, room.rows - 2)
        var column = 1
        let heroes = combatants.filter { !$0.isFoe && result[$0.id] == nil }
        let foes = combatants.filter { $0.isFoe && result[$0.id] == nil }

        func place(_ combatant: Combatant, x: Int, y: Int) {
            let clampedY = min(max(0, y), max(0, room.rows - 1))
            let clampedX = min(max(0, x), max(0, room.columns - 1))
            result[combatant.id] = claim(GridPoint(x: clampedX, y: clampedY))
        }

        for hero in heroes where hero.position == "engaged" {
            place(hero, x: column, y: max(0, south - 1))
            let matched = foes.filter { foe in
                result[foe.id] == nil && (hero.engagedWith.contains(foe.id) || foe.engagedWith.contains(hero.id))
            }
            var foeColumn = column
            for foe in matched {
                place(foe, x: foeColumn, y: max(0, south - 2))
                foeColumn += 1
            }
            column += max(2, matched.count + 1)
        }

        for foe in foes where result[foe.id] == nil && foe.position == "engaged" {
            place(foe, x: column, y: max(0, south - 2))
            column += 1
        }

        var partyColumn = 1
        for hero in heroes where result[hero.id] == nil {
            place(hero, x: partyColumn, y: south)
            partyColumn += 2
        }

        let nearRow = max(1, min(room.rows - 3, south - (30 / max(room.squareFeet, 1))))
        var nearColumn = 2
        var farColumn = max(0, room.columns - 2)
        for foe in foes where result[foe.id] == nil {
            if foe.position == "far" {
                place(foe, x: farColumn, y: 0)
                farColumn = max(0, farColumn - 2)
            } else {
                place(foe, x: nearColumn, y: nearRow)
                nearColumn += 2
            }
        }

        for combatant in combatants where result[combatant.id] == nil {
            place(combatant, x: 0, y: south)
        }
        return result
    }

    static func disk(from origin: GridPoint?, speedFeet: Int, room: BattleRoom, occupied: Set<GridPoint>) -> Set<GridPoint> {
        guard let origin else { return [] }
        let reach = max(0, speedFeet / max(room.squareFeet, 1))
        var squares = Set<GridPoint>()
        guard reach > 0 else { return squares }
        for y in 0..<room.rows {
            for x in 0..<room.columns {
                let point = GridPoint(x: x, y: y)
                if point == origin || room.blocked.contains(point) || occupied.contains(point) { continue }
                if max(abs(x - origin.x), abs(y - origin.y)) <= reach { squares.insert(point) }
            }
        }
        return squares
    }

    static func center(_ point: GridPoint, cell: CGFloat) -> CGPoint {
        CGPoint(x: (CGFloat(point.x) + 0.5) * cell, y: (CGFloat(point.y) + 0.5) * cell)
    }

    /// Feet between two squares. A diagonal counts as one square, the same as a step north.
    static func feet(from a: GridPoint, to b: GridPoint, squareFeet: Int) -> Int {
        max(abs(a.x - b.x), abs(a.y - b.y)) * max(squareFeet, 1)
    }
}
