import AppKit
import SwiftUI

/// The Nova bar: a single line of glass with a soft nova aura. It swirls to life
/// while Nova works and folds into a dark island under the menu bar while Nova acts.
struct NovaView: View {
    @ObservedObject var controller: NovaController
    let onSize: (CGSize) -> Void

    @FocusState private var focused: Bool
    @State private var appeared = false
    @State private var measuredAnswerHeight: CGFloat = 200
    @State private var resizeStart: (width: CGFloat, height: CGFloat, mouse: NSPoint)?

    private var acting: Bool { controller.isActing }
    private var radius: CGFloat { acting ? 19 : 26 }
    private var shape: RoundedRectangle { RoundedRectangle(cornerRadius: radius, style: .continuous) }

    var body: some View {
        Group {
            if acting {
                island.transition(.scale(scale: 0.9).combined(with: .opacity))
            } else {
                bar.transition(.opacity)
            }
        }
        .background {
            ZStack {
                if !acting {
                    NovaAura(radius: radius, active: controller.isWorking)
                }
                if acting {
                    shape.fill(Color.black.opacity(0.86))
                } else {
                    GlassBackground(shape: shape)
                }
            }
        }
        .overlay(NovaRim(shape: shape, active: controller.isWorking, dark: acting))
        .shadow(color: .black.opacity(acting ? 0.35 : 0.2), radius: acting ? 16 : 30, y: acting ? 6 : 14)
        .background(
            GeometryReader { proxy in
                Color.clear
                    .onAppear { onSize(proxy.size) }
                    .onChange(of: proxy.size) { _, size in onSize(size) }
            }
        )
        .scaleEffect(appeared ? 1 : 0.965)
        .opacity(appeared ? 1 : 0)
        .blur(radius: appeared ? 0 : 8)
        .padding(NovaPanel.margin)
        .fixedSize()
        .animation(.spring(response: 0.42, dampingFraction: 0.84), value: acting)
        .animation(.spring(response: 0.36, dampingFraction: 0.9), value: controller.answer)
        .animation(.easeOut(duration: 0.2), value: controller.context)
        .animation(.easeOut(duration: 0.18), value: controller.input.isEmpty)
        .onChange(of: controller.focusToken) { _, _ in focused = true }
        .onChange(of: controller.isShown) { _, shown in
            if shown {
                withAnimation(.spring(response: 0.34, dampingFraction: 0.82)) { appeared = true }
            } else {
                appeared = false
            }
        }
        .onAppear { appeared = controller.isShown }
    }

    // MARK: - Bar

    private var bar: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 14) {
                leadingMark
                    .frame(width: 22, height: 22)

                if controller.isWorking {
                    Text(controller.status)
                        .font(.system(size: 17))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.tail)
                        .shimmer()
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentTransition(.opacity)
                        .animation(.easeOut(duration: 0.2), value: controller.status)
                } else {
                    inputField
                }

                trailingAccessories
            }
            .padding(.leading, 22)
            .padding(.trailing, 18)
            .frame(height: 64)

            if controller.needsKey && !controller.isWorking {
                Text("Stored securely in your Keychain. Get a key at platform.claude.com")
                    .font(.system(size: 11.5))
                    .foregroundStyle(.tertiary)
                    .padding(.leading, 58)
                    .padding(.bottom, 14)
                    .padding(.top, -8)
            }

            if !controller.context.isEmpty && !controller.isWorking && !controller.needsKey {
                contextChips
                    .transition(.opacity)
            }

            if controller.isWorking && !controller.liveText.isEmpty {
                answerSection(controller.liveText, live: true)
                    .transition(.opacity.combined(with: .offset(y: -6)))
            } else if let answer = controller.answer, !controller.isWorking {
                answerSection(answer, live: false)
                    .transition(.opacity.combined(with: .offset(y: -6)))
            }
        }
        .frame(width: controller.barWidth)
        .contentShape(Rectangle())
        // Grab Nova anywhere (except inside text) and put it anywhere on screen.
        .gesture(
            DragGesture(minimumDistance: 3)
                .onChanged { _ in controller.panel?.userDragChanged() }
                .onEnded { _ in controller.panel?.userDragEnded() }
        )
        .overlay(alignment: .bottomTrailing) {
            ResizeGrip()
                .gesture(resizeGesture)
                .padding(6)
        }
    }

    /// Drag the corner grip: sideways changes the width, up/down changes the answer height.
    private var resizeGesture: some Gesture {
        DragGesture(minimumDistance: 1)
            .onChanged { _ in
                let mouse = NSEvent.mouseLocation
                if resizeStart == nil {
                    controller.panel?.pinPosition()
                    resizeStart = (controller.barWidth, controller.answerHeight ?? measuredAnswerHeight, mouse)
                }
                guard let start = resizeStart else { return }
                controller.barWidth = min(1200, max(460, start.width + mouse.x - start.mouse.x))
                if controller.answer != nil {
                    controller.answerHeight = min(900, max(120, start.height + start.mouse.y - mouse.y))
                }
            }
            .onEnded { _ in
                resizeStart = nil
                controller.saveSize()
            }
    }

    @ViewBuilder
    private var leadingMark: some View {
        if controller.needsKey && !controller.isWorking {
            Image(systemName: "key.fill")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(NovaPalette.markGradient)
        } else {
            NovaMark(active: controller.isWorking)
        }
    }

    @ViewBuilder
    private var trailingAccessories: some View {
        if controller.isWorking {
            if let tier = controller.tier { ModelTag(tier: tier) }
            KeyHint("esc")
        } else if !controller.input.isEmpty {
            KeyHint("↵").transition(.opacity.combined(with: .scale(scale: 0.8)))
        }
    }

    private var inputField: some View {
        Group {
            if controller.needsKey {
                SecureField(Keychain.apiKey == nil ? "Paste your Anthropic API key to wake Nova" : "Paste your new Anthropic API key",
                            text: $controller.input)
            } else {
                TextField(controller.answer == nil ? "Ask Nova anything…" : "Follow up…", text: $controller.input)
            }
        }
        .textFieldStyle(.plain)
        .font(.system(size: 20))
        .focused($focused)
        .onSubmit { controller.submit() }
        .onAppear { focused = true }
    }

    /// What Nova picked up when summoned. Each chip can be removed before sending.
    private var contextChips: some View {
        HStack(spacing: 6) {
            ForEach(controller.context) { item in
                ContextChip(item: item) { controller.removeContext(item) }
            }
            Spacer(minLength: 0)
        }
        .padding(.leading, 58)
        .padding(.trailing, 18)
        .padding(.top, -6)
        .padding(.bottom, 12)
    }

    private func answerSection(_ answer: String, live: Bool) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            LinearGradient(colors: [.clear, Color.primary.opacity(0.13), .clear],
                           startPoint: .leading, endPoint: .trailing)
                .frame(height: 1)
                .padding(.horizontal, 18)

            ScrollView {
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    if controller.answerIsError && !live {
                        Image(systemName: "exclamationmark.circle.fill")
                            .foregroundStyle(.orange)
                    }
                    Text(Self.markdown(answer))
                        .font(.system(size: 15))
                        .lineSpacing(4)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(.horizontal, 24)
                .padding(.top, 18)
                .padding(.bottom, 16)
            }
            .scrollIndicators(.never)
            .answerFrame(controller.answerHeight)
            .background(
                GeometryReader { proxy in
                    Color.clear
                        .onAppear { measuredAnswerHeight = proxy.size.height }
                        .onChange(of: proxy.size.height) { _, height in measuredAnswerHeight = height }
                }
            )
            .mask(
                VStack(spacing: 0) {
                    Color.black
                    LinearGradient(colors: [.black, .clear], startPoint: .top, endPoint: .bottom)
                        .frame(height: 14)
                }
            )

            if !live {
                HStack(spacing: 14) {
                    if let tier = controller.answeredBy { ModelTag(tier: tier) }
                    Spacer()
                    FooterHint(key: "↵", label: "follow up")
                    FooterHint(key: "esc", label: "close")
                }
                .padding(.horizontal, 22)
                .padding(.bottom, 14)
            }
        }
    }

    // MARK: - Island (while Nova drives the Mac)

    private var island: some View {
        HStack(spacing: 10) {
            NovaMark(active: true, sparkle: false)
                .frame(width: 14, height: 14)
            Text(controller.status)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(.white.opacity(0.92))
                .lineLimit(1)
                .truncationMode(.tail)
                .shimmer()
                .frame(maxWidth: .infinity, alignment: .leading)
                .animation(.easeOut(duration: 0.2), value: controller.status)
            if let tier = controller.tier { ModelTag(tier: tier) }
            KeyHint("esc")
        }
        .padding(.horizontal, 14)
        .frame(width: 440, height: 38)
        .environment(\.colorScheme, .dark)
    }

    private static func markdown(_ text: String) -> AttributedString {
        let options = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        return (try? AttributedString(markdown: text, options: options)) ?? AttributedString(text)
    }
}

// MARK: - Palette

private enum NovaPalette {
    static let ice = Color(red: 0.56, green: 0.80, blue: 1.00)
    static let violet = Color(red: 0.64, green: 0.52, blue: 1.00)
    static let rose = Color(red: 1.00, green: 0.56, blue: 0.82)
    static let ember = Color(red: 1.00, green: 0.84, blue: 0.62)

    static let ring: [Color] = [ice, violet, rose, ember, ice]

    static let markGradient = LinearGradient(colors: [Color(red: 0.70, green: 0.88, blue: 1), violet],
                                             startPoint: .topLeading, endPoint: .bottomTrailing)
}

// MARK: - Surfaces

/// Liquid Glass where available, frosted material otherwise, with a faint violet tint.
private struct GlassBackground: View {
    let shape: RoundedRectangle

    var body: some View {
        ZStack {
            if #available(macOS 26.0, *) {
                Color.clear.glassEffect(.regular, in: shape)
            } else {
                shape.fill(.ultraThinMaterial)
            }
            shape.fill(
                LinearGradient(colors: [NovaPalette.violet.opacity(0.07), .clear, NovaPalette.ice.opacity(0.04)],
                               startPoint: .topLeading, endPoint: .bottomTrailing)
            )
        }
    }
}

/// A soft nova-colored halo behind the glass. It breathes when idle and swirls while Nova works.
private struct NovaAura: View {
    let radius: CGFloat
    let active: Bool

    var body: some View {
        TimelineView(.animation(minimumInterval: active ? nil : 1.0 / 30)) { timeline in
            let t = timeline.date.timeIntervalSinceReferenceDate
            let breathe = 0.5 + 0.5 * sin(t * (active ? 2.4 : 0.8))
            RoundedRectangle(cornerRadius: radius, style: .continuous)
                .fill(AngularGradient(colors: NovaPalette.ring, center: .center,
                                      angle: .degrees(t * (active ? 80 : 10))))
                .scaleEffect(x: 0.94, y: 0.82)
                .offset(y: 8)
                .blur(radius: active ? 24 : 30)
                .opacity(active ? 0.42 + 0.22 * breathe : 0.12 + 0.08 * breathe)
        }
        .allowsHitTesting(false)
        .animation(.easeInOut(duration: 0.5), value: active)
    }
}

/// The bar's edge: a lit-glass highlight at rest, a turning nova ring while Nova works.
private struct NovaRim: View {
    let shape: RoundedRectangle
    let active: Bool
    let dark: Bool

    var body: some View {
        ZStack {
            shape.strokeBorder(
                LinearGradient(colors: [.white.opacity(dark ? 0.16 : 0.45), .white.opacity(0.06), .white.opacity(dark ? 0.04 : 0.12)],
                               startPoint: .top, endPoint: .bottom),
                lineWidth: 1
            )
            if active {
                TimelineView(.animation) { timeline in
                    let angle = Angle.degrees(timeline.date.timeIntervalSinceReferenceDate * 110)
                    let ring = AngularGradient(colors: NovaPalette.ring, center: .center, angle: angle)
                    ZStack {
                        shape.strokeBorder(ring, lineWidth: 1.4).opacity(0.9)
                        shape.strokeBorder(ring, lineWidth: 5).blur(radius: 10).opacity(0.6)
                    }
                }
                .transition(.opacity)
            }
        }
        .allowsHitTesting(false)
        .animation(.easeInOut(duration: 0.4), value: active)
    }
}

// MARK: - Mark

/// A four-point star with concave sides.
private struct FourPointStar: Shape {
    func path(in rect: CGRect) -> Path {
        let c = CGPoint(x: rect.midX, y: rect.midY)
        let r = min(rect.width, rect.height) / 2
        let pinch = r * 0.16
        let tips = [
            CGPoint(x: c.x, y: c.y - r), CGPoint(x: c.x + r, y: c.y),
            CGPoint(x: c.x, y: c.y + r), CGPoint(x: c.x - r, y: c.y),
        ]
        let controls = [
            CGPoint(x: c.x + pinch, y: c.y - pinch), CGPoint(x: c.x + pinch, y: c.y + pinch),
            CGPoint(x: c.x - pinch, y: c.y + pinch), CGPoint(x: c.x - pinch, y: c.y - pinch),
        ]
        var path = Path()
        path.move(to: tips[0])
        for i in 0..<4 {
            path.addQuadCurve(to: tips[(i + 1) % 4], control: controls[i])
        }
        path.closeSubpath()
        return path
    }
}

/// Nova's mark: a glowing star (with a tiny companion) that turns and breathes while working.
private struct NovaMark: View {
    let active: Bool
    var sparkle = true

    var body: some View {
        TimelineView(.animation(paused: !active)) { timeline in
            let t = timeline.date.timeIntervalSinceReferenceDate
            let pulse = active ? 0.5 + 0.5 * sin(t * 3) : 0
            ZStack {
                Circle()
                    .fill(RadialGradient(colors: [NovaPalette.violet.opacity(0.55), .clear],
                                         center: .center, startRadius: 0, endRadius: 14))
                    .padding(-8)
                    .opacity(0.45 + 0.55 * pulse)
                FourPointStar()
                    .fill(NovaPalette.markGradient)
                    .rotationEffect(.degrees(active ? t * 40 : 0))
                    .scaleEffect(1 + 0.1 * pulse)
                    .shadow(color: NovaPalette.violet.opacity(0.5), radius: 3 + 4 * pulse)
            }
            .overlay(alignment: .topTrailing) {
                if sparkle {
                    FourPointStar()
                        .fill(Color.white.opacity(0.9))
                        .frame(width: 6, height: 6)
                        .offset(x: 4, y: -3)
                        .opacity(active ? 0.4 + 0.6 * (1 - pulse) : 0.7)
                }
            }
        }
    }
}

// MARK: - Small pieces

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
            .overlay(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .strokeBorder(Color.primary.opacity(0.08), lineWidth: 0.5)
            )
    }
}

private struct ContextChip: View {
    let item: ContextItem
    let onRemove: () -> Void

    private var icon: String {
        switch item.kind {
        case .selection: return "text.cursor"
        case .browser: return "globe"
        case .finder: return "doc"
        }
    }

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: icon)
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(.secondary)
            Text(item.label)
                .font(.system(size: 11.5, weight: .medium))
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .truncationMode(.middle)
                .frame(maxWidth: 200, alignment: .leading)
            Button(action: onRemove) {
                Image(systemName: "xmark")
                    .font(.system(size: 8, weight: .bold))
                    .foregroundStyle(.tertiary)
            }
            .buttonStyle(.plain)
            .help("Don't send this")
        }
        .padding(.horizontal, 9)
        .padding(.vertical, 4)
        .background(Color.primary.opacity(0.06), in: Capsule())
        .overlay(Capsule().strokeBorder(Color.primary.opacity(0.07), lineWidth: 0.5))
        .fixedSize()
    }
}

private struct FooterHint: View {
    let key: String
    let label: String

    var body: some View {
        HStack(spacing: 6) {
            KeyHint(key)
            Text(label)
                .font(.system(size: 11.5))
                .foregroundStyle(.tertiary)
        }
    }
}

/// Which model is on the job, tinted by difficulty.
private struct ModelTag: View {
    let tier: Tier

    private var tint: Color {
        switch tier {
        case .easy: return Color(red: 0.45, green: 0.85, blue: 0.75)
        case .medium: return NovaPalette.ice
        case .hard: return NovaPalette.rose
        }
    }

    var body: some View {
        HStack(spacing: 5) {
            Circle()
                .fill(tint)
                .frame(width: 5, height: 5)
                .shadow(color: tint.opacity(0.8), radius: 3)
            Text(tier.label)
                .font(.system(size: 11, weight: .medium, design: .rounded))
                .foregroundStyle(tint.opacity(0.95))
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(tint.opacity(0.12), in: Capsule())
        .transition(.opacity)
    }
}

/// A soft highlight that sweeps across text while Nova is thinking.
private struct Shimmer: ViewModifier {
    func body(content: Content) -> some View {
        content.overlay {
            TimelineView(.animation) { timeline in
                let t = timeline.date.timeIntervalSinceReferenceDate
                let phase = CGFloat((t * 0.6).truncatingRemainder(dividingBy: 1)) * 1.6 - 0.3
                LinearGradient(colors: [.clear, .white.opacity(0.55), .clear],
                               startPoint: UnitPoint(x: phase - 0.25, y: 0.5),
                               endPoint: UnitPoint(x: phase + 0.25, y: 0.5))
            }
            .mask(content)
            .allowsHitTesting(false)
        }
    }
}

private extension View {
    func shimmer() -> some View { modifier(Shimmer()) }

    /// A fixed answer height once the user has resized it; otherwise fit the answer, up to 400pt.
    @ViewBuilder
    func answerFrame(_ height: CGFloat?) -> some View {
        if let height {
            frame(height: height)
        } else {
            frame(maxHeight: 400).fixedSize(horizontal: false, vertical: true)
        }
    }
}

/// Three short diagonal lines in the bottom-right corner, the classic resize grip.
private struct ResizeGrip: View {
    @State private var hovering = false

    var body: some View {
        Canvas { context, size in
            for inset in [4.0, 8.0, 12.0] {
                var line = Path()
                line.move(to: CGPoint(x: size.width, y: size.height - inset))
                line.addLine(to: CGPoint(x: size.width - inset, y: size.height))
                context.stroke(line, with: .color(.primary), style: StrokeStyle(lineWidth: 1.2, lineCap: .round))
            }
        }
        .frame(width: 13, height: 13)
        .opacity(hovering ? 0.55 : 0.22)
        .padding(5)
        .contentShape(Rectangle())
        .onHover { hovering = $0 }
        .help("Drag to resize")
    }
}
