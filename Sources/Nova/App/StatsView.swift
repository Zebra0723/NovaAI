import Charts
import SwiftUI

/// Totals, activity over the last two weeks, and a breakdown by model.
struct StatsView: View {
    @ObservedObject var store: NovaStore
    @State private var hoveredDay: Date?

    private struct DayCount: Identifiable {
        let date: Date
        let count: Int
        var id: Date { date }
    }

    private struct ModelRow: Identifiable {
        let tier: Tier
        let requests: Int
        let cost: Double
        var id: Tier { tier }
    }

    private var exchanges: [Exchange] { store.conversations.flatMap(\.exchanges) }

    private var totalSpend: Double {
        exchanges.reduce(0) { $0 + $1.usage.costUSD } + store.backgroundStats.usage.costUSD
    }

    private var days: [DayCount] {
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: Date())
        var counts: [Date: Int] = [:]
        for exchange in exchanges {
            counts[calendar.startOfDay(for: exchange.date), default: 0] += 1
        }
        return (0..<14).reversed().compactMap { offset in
            guard let day = calendar.date(byAdding: .day, value: -offset, to: today) else { return nil }
            return DayCount(date: day, count: counts[day] ?? 0)
        }
    }

    private var models: [ModelRow] {
        Tier.allCases.map { tier in
            let matching = exchanges.filter { $0.tier == tier.rawValue }
            return ModelRow(tier: tier, requests: matching.count,
                            cost: matching.reduce(0) { $0 + $1.usage.costUSD })
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                PageHeader(title: "Stats", subtitle: "Everything Nova has done for you, and what it cost.")

                tiles
                activity
                HStack(alignment: .top, spacing: 16) {
                    modelBreakdown
                    proactive
                }
            }
            .padding(.horizontal, 40)
            .padding(.top, 48)
            .padding(.bottom, 40)
            .frame(maxWidth: 980, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    // MARK: - Tiles

    private var tiles: some View {
        let completed = exchanges.filter { $0.outcome == .completed }
        let averageTime = completed.isEmpty ? 0 : completed.reduce(0) { $0 + $1.duration } / Double(completed.count)
        return HStack(spacing: 16) {
            StatTile(label: "Conversations", value: "\(store.conversations.count)")
            StatTile(label: "Requests", value: "\(exchanges.count)")
            StatTile(label: "Actions taken", value: "\(exchanges.reduce(0) { $0 + $1.actions.count })")
            StatTile(label: "Average time", value: completed.isEmpty ? "–" : Format.duration(averageTime))
            StatTile(label: "Total spent", value: Format.cost(totalSpend))
        }
    }

    // MARK: - Activity

    private var activity: some View {
        Card {
            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .firstTextBaseline) {
                    Text("Requests per day")
                        .font(Theme.title())
                    Spacer()
                    Text(hoveredSummary)
                        .font(Theme.caption(12))
                        .foregroundStyle(Theme.secondary)
                        .monospacedDigit()
                }
                Chart(days) { day in
                    BarMark(x: .value("Day", day.date, unit: .day),
                            y: .value("Requests", day.count),
                            width: .ratio(0.62))
                        .foregroundStyle(Theme.accent.opacity(hoveredDay == nil || isHovered(day) ? 1 : 0.35))
                        .cornerRadius(4)
                }
                .chartXSelection(value: $hoveredDay)
                .chartXAxis {
                    AxisMarks(values: .stride(by: .day, count: 2)) { _ in
                        AxisValueLabel(format: .dateTime.month(.abbreviated).day())
                            .font(Theme.caption(10.5))
                            .foregroundStyle(Theme.tertiary)
                    }
                }
                .chartYAxis {
                    AxisMarks(position: .leading, values: .automatic(desiredCount: 4)) { _ in
                        AxisGridLine().foregroundStyle(Theme.hairline)
                        AxisValueLabel()
                            .font(Theme.caption(10.5))
                            .foregroundStyle(Theme.tertiary)
                    }
                }
                .frame(height: 200)
            }
        }
    }

    private func isHovered(_ day: DayCount) -> Bool {
        guard let hoveredDay else { return false }
        return Calendar.current.isDate(day.date, inSameDayAs: hoveredDay)
    }

    private var hoveredSummary: String {
        if let day = days.first(where: isHovered) {
            let label = day.date.formatted(.dateTime.weekday(.wide).month(.abbreviated).day())
            return "\(label): \(day.count) request\(day.count == 1 ? "" : "s")"
        }
        let total = days.reduce(0) { $0 + $1.count }
        return "\(total) in the last 14 days"
    }

    // MARK: - Models

    private var modelBreakdown: some View {
        let maxRequests = max(1, models.map(\.requests).max() ?? 1)
        return Card {
            VStack(alignment: .leading, spacing: 16) {
                Text("By model")
                    .font(Theme.title())
                ForEach(models) { row in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(alignment: .firstTextBaseline) {
                            Text(row.tier.displayName)
                                .font(.system(size: 13, weight: .medium))
                            Text(Self.difficulty(row.tier))
                                .font(Theme.caption(11))
                                .foregroundStyle(Theme.tertiary)
                            Spacer()
                            Text("\(row.requests) · \(Format.cost(row.cost))")
                                .font(Theme.caption(12))
                                .foregroundStyle(Theme.secondary)
                                .monospacedDigit()
                        }
                        GeometryReader { proxy in
                            ZStack(alignment: .leading) {
                                Capsule().fill(Theme.selection.opacity(0.6))
                                Capsule()
                                    .fill(Theme.accent)
                                    .frame(width: max(row.requests == 0 ? 0 : 6,
                                                      proxy.size.width * CGFloat(row.requests) / CGFloat(maxRequests)))
                            }
                        }
                        .frame(height: 6)
                    }
                    .help("\(row.tier.displayName): \(row.requests) requests, \(Format.cost(row.cost))")
                }
            }
        }
    }

    private static func difficulty(_ tier: Tier) -> String {
        switch tier {
        case .easy: return "easy"
        case .medium: return "medium"
        case .hard: return "hard"
        }
    }

    // MARK: - Proactive

    private var proactive: some View {
        let background = store.backgroundStats
        return Card {
            VStack(alignment: .leading, spacing: 14) {
                Text("Proactive checks")
                    .font(Theme.title())
                VStack(alignment: .leading, spacing: 10) {
                    statLine("Screens checked", "\(background.checks)")
                    statLine("Problems spotted", "\(background.notices)")
                    statLine("Cost", Format.cost(background.usage.costUSD))
                }
                Text(store.settings.proactiveEnabled ? "On. Change this in Settings." : "Off. Turn it on in Settings.")
                    .font(Theme.caption(11))
                    .foregroundStyle(Theme.tertiary)
            }
        }
        .frame(width: 300)
    }

    private func statLine(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label)
                .font(Theme.body(13))
                .foregroundStyle(Theme.secondary)
            Spacer()
            Text(value)
                .font(.system(size: 13, weight: .semibold))
                .monospacedDigit()
        }
    }
}

private struct StatTile: View {
    let label: String
    let value: String

    var body: some View {
        Card(padding: 16) {
            VStack(alignment: .leading, spacing: 8) {
                Text(label)
                    .font(Theme.caption(11.5))
                    .foregroundStyle(Theme.secondary)
                Text(value)
                    .font(Theme.number(26))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
            }
        }
    }
}
