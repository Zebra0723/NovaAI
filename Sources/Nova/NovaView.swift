import SwiftUI

/// The Nova bar: one line of glass with a soft star glow that comes alive while Nova works.
struct NovaView: View {
    @ObservedObject var controller: NovaController
    let onSize: (CGSize) -> Void

    @FocusState private var focused: Bool

    private var radius: CGFloat { controller.isActing ? 20 : 24 }

    var body: some View {
        Group {
            if controller.isActing {
                pill
            } else {
                bar
            }
        }
        .background(GlassBackground(radius: radius))
        .overlay(NovaGlow(radius: radius, active: controller.isWorking))
        .shadow(color: .black.opacity(0.28), radius: 24, y: 10)
        .background(
            GeometryReader { proxy in
                Color.clear
                    .onAppear { onSize(proxy.size) }
                    .onChange(of: proxy.size) { _, size in onSize(size) }
            }
        )
        .padding(NovaPanel.margin)
        .fixedSize()
        .animation(.spring(response: 0.38, dampingFraction: 0.86), value: controller.isActing)
        .animation(.easeOut(duration: 0.2), value: controller.answer)
        .onChange(of: controller.focusToken) { _, _ in focused = true }
    }

    // MARK: - Full bar

    private var bar: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 14) {
                NovaMark(active: controller.isWorking)
                    .frame(width: 18, height: 18)

                if controller.isWorking {
                    Text(controller.status)
                        .font(.system(size: 17, weight: .regular))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.tail)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentTransition(.opacity)
                } else {
                    inputField
                }

                if controller.isWorking {
                    KeyHint("esc")
                }
            }
            .padding(.horizontal, 20)
            .frame(height: 58)

            if let answer = controller.answer, !controller.isWorking {
                Rectangle()
                    .fill(Color.primary.opacity(0.08))
                    .frame(height: 1)
                    .padding(.horizontal, 20)

                ScrollView {
                    Text(Self.markdown(answer))
                        .font(.system(size: 14.5))
                        .lineSpacing(3)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 22)
                        .padding(.vertical, 16)
                }
                .scrollIndicators(.never)
                .frame(maxHeight: 380)
                .fixedSize(horizontal: false, vertical: true)
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .frame(width: 640)
    }

    @ViewBuilder
    private var inputField: some View {
        Group {
            if controller.needsKey {
                SecureField("Paste your Anthropic API key to wake Nova", text: $controller.input)
            } else {
                TextField(controller.answer == nil ? "Ask Nova anything…" : "Follow up…", text: $controller.input)
            }
        }
        .textFieldStyle(.plain)
        .font(.system(size: 19, weight: .regular))
        .focused($focused)
        .onSubmit { controller.submit() }
        .onAppear { focused = true }
    }

    // MARK: - Acting pill

    private var pill: some View {
        HStack(spacing: 10) {
            NovaMark(active: true)
                .frame(width: 14, height: 14)
            Text(controller.status)
                .font(.system(size: 13, weight: .medium))
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)
            KeyHint("esc")
        }
        .padding(.horizontal, 16)
        .frame(width: 400, height: 40)
    }

    private static func markdown(_ text: String) -> AttributedString {
        let options = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        return (try? AttributedString(markdown: text, options: options)) ?? AttributedString(text)
    }
}

// MARK: - Pieces

/// Liquid Glass where available, frosted material otherwise.
private struct GlassBackground: View {
    let radius: CGFloat

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        if #available(macOS 26.0, *) {
            Color.clear.glassEffect(.regular, in: shape)
        } else {
            shape.fill(.ultraThinMaterial)
        }
    }
}

/// A hairline edge that becomes a slowly turning nova-colored halo while Nova works.
private struct NovaGlow: View {
    let radius: CGFloat
    let active: Bool

    private static let colors: [Color] = [
        Color(red: 0.55, green: 0.80, blue: 1.00),
        Color(red: 0.62, green: 0.50, blue: 1.00),
        Color(red: 1.00, green: 0.56, blue: 0.82),
        Color(red: 1.00, green: 0.86, blue: 0.62),
        Color(red: 0.55, green: 0.80, blue: 1.00),
    ]

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        if active {
            TimelineView(.animation) { timeline in
                let angle = Angle.degrees(timeline.date.timeIntervalSinceReferenceDate * 90)
                let gradient = AngularGradient(colors: Self.colors, center: .center, angle: angle)
                ZStack {
                    shape.strokeBorder(gradient, lineWidth: 1.5)
                    shape.strokeBorder(gradient, lineWidth: 6).blur(radius: 14).opacity(0.75)
                }
            }
            .allowsHitTesting(false)
            .transition(.opacity)
        } else {
            shape.strokeBorder(.white.opacity(0.14), lineWidth: 1)
                .allowsHitTesting(false)
        }
    }
}

/// Nova's mark: a four-point star that breathes while working.
private struct NovaMark: View {
    let active: Bool

    var body: some View {
        TimelineView(.animation(paused: !active)) { timeline in
            let t = timeline.date.timeIntervalSinceReferenceDate
            let pulse = active ? 0.5 + 0.5 * sin(t * 3.2) : 0
            Image(systemName: "sparkle")
                .resizable()
                .scaledToFit()
                .foregroundStyle(
                    LinearGradient(colors: [Color(red: 0.62, green: 0.82, blue: 1), Color(red: 0.78, green: 0.6, blue: 1)],
                                   startPoint: .topLeading, endPoint: .bottomTrailing)
                )
                .scaleEffect(1 + 0.12 * pulse)
                .shadow(color: Color(red: 0.62, green: 0.6, blue: 1).opacity(0.35 + 0.5 * pulse), radius: 4 + 6 * pulse)
        }
    }
}

private struct KeyHint: View {
    let label: String
    init(_ label: String) { self.label = label }

    var body: some View {
        Text(label)
            .font(.system(size: 11, weight: .medium, design: .rounded))
            .foregroundStyle(.secondary)
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(Color.primary.opacity(0.07), in: RoundedRectangle(cornerRadius: 6, style: .continuous))
    }
}
