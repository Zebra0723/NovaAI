import SwiftUI

/// The Nova app's look: warm off-white surfaces, ink text, one violet accent,
/// New York for headings and SF for everything else. Light mode only.
enum Theme {
    static let background = Color(red: 0.965, green: 0.957, blue: 0.937)   // #F6F4EF
    static let sidebar = Color(red: 0.937, green: 0.925, blue: 0.898)      // #EFECE5
    static let card = Color(red: 0.988, green: 0.984, blue: 0.973)         // #FCFBF8
    static let selection = Color(red: 0.898, green: 0.882, blue: 0.847)    // #E5E1D8
    static let hairline = Color(red: 0.890, green: 0.871, blue: 0.827)     // #E3DED3

    static let ink = Color(red: 0.110, green: 0.106, blue: 0.094)          // #1C1B18
    static let secondary = Color(red: 0.420, green: 0.404, blue: 0.369)    // #6B675E
    static let tertiary = Color(red: 0.612, green: 0.592, blue: 0.549)     // #9C978C

    static let accent = Color(red: 0.357, green: 0.310, blue: 0.839)       // #5B4FD6
    static let danger = Color(red: 0.761, green: 0.231, blue: 0.180)       // #C23B2E

    static func display(_ size: CGFloat) -> Font { .system(size: size, weight: .semibold, design: .serif) }
    static func title(_ size: CGFloat = 15) -> Font { .system(size: size, weight: .semibold) }
    static func body(_ size: CGFloat = 13.5) -> Font { .system(size: size) }
    static func caption(_ size: CGFloat = 11.5) -> Font { .system(size: size, weight: .medium) }
    static func mono(_ size: CGFloat = 12) -> Font { .system(size: size, design: .monospaced) }
    static func number(_ size: CGFloat) -> Font { .system(size: size, weight: .semibold, design: .serif).monospacedDigit() }
}

// MARK: - Shared pieces

/// A page header: a serif title with an optional subtitle and trailing controls.
struct PageHeader<Trailing: View>: View {
    let title: String
    var subtitle: String?
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack(alignment: .lastTextBaseline) {
            VStack(alignment: .leading, spacing: 6) {
                Text(title)
                    .font(Theme.display(28))
                    .foregroundStyle(Theme.ink)
                if let subtitle {
                    Text(subtitle)
                        .font(Theme.body(13))
                        .foregroundStyle(Theme.secondary)
                }
            }
            Spacer()
            trailing
        }
    }
}

extension PageHeader where Trailing == EmptyView {
    init(title: String, subtitle: String? = nil) {
        self.init(title: title, subtitle: subtitle) { EmptyView() }
    }
}

/// A rounded off-white card with a hairline border.
struct Card<Content: View>: View {
    var padding: CGFloat = 20
    @ViewBuilder var content: Content

    var body: some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))
    }
}

/// Small uppercase label above a group.
struct SectionLabel: View {
    let text: String
    init(_ text: String) { self.text = text }

    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 10.5, weight: .semibold))
            .tracking(0.8)
            .foregroundStyle(Theme.tertiary)
    }
}

struct Hairline: View {
    var body: some View {
        Rectangle().fill(Theme.hairline).frame(height: 1)
    }
}

/// Buttons in the app's style.
struct NovaButtonStyle: ButtonStyle {
    enum Kind { case primary, secondary, destructive }
    var kind: Kind = .secondary

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 12.5, weight: .medium))
            .foregroundStyle(foreground)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(background, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .strokeBorder(kind == .primary ? Color.clear : Theme.hairline, lineWidth: 1)
            )
            .opacity(configuration.isPressed ? 0.75 : 1)
            .contentShape(Rectangle())
    }

    private var foreground: Color {
        switch kind {
        case .primary: return .white
        case .secondary: return Theme.ink
        case .destructive: return Theme.danger
        }
    }

    private var background: Color {
        kind == .primary ? Theme.accent : Theme.card
    }
}

/// A plain text field with the app's border and padding.
struct FieldStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .textFieldStyle(.plain)
            .font(Theme.body())
            .foregroundStyle(Theme.ink)
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .background(Color.white, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))
    }
}

extension View {
    func novaField() -> some View { modifier(FieldStyle()) }
}

// MARK: - Formatting

enum Format {
    static func cost(_ value: Double) -> String {
        if value == 0 { return "$0.00" }
        if value < 0.01 { return String(format: "$%.4f", value) }
        return String(format: "$%.2f", value)
    }

    static func tokens(_ value: Int) -> String {
        switch value {
        case 1_000_000...: return String(format: "%.1fM", Double(value) / 1_000_000)
        case 1_000...: return String(format: "%.1fK", Double(value) / 1_000)
        default: return "\(value)"
        }
    }

    static func duration(_ seconds: TimeInterval) -> String {
        seconds < 60 ? String(format: "%.1fs", seconds) : "\(Int(seconds) / 60)m \(Int(seconds) % 60)s"
    }

    static func date(_ date: Date) -> String {
        if Calendar.current.isDateInToday(date) {
            return "Today, " + date.formatted(date: .omitted, time: .shortened)
        }
        if Calendar.current.isDateInYesterday(date) {
            return "Yesterday, " + date.formatted(date: .omitted, time: .shortened)
        }
        return date.formatted(.dateTime.month(.abbreviated).day().hour().minute())
    }
}
