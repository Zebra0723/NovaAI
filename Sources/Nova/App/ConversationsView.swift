import SwiftUI

/// Every conversation Nova has had: a searchable list and the full exchange on the right.
struct ConversationsView: View {
    @ObservedObject var store: NovaStore
    @State private var selectedID: UUID?
    @State private var query = ""

    private var filtered: [Conversation] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return store.conversations }
        return store.conversations.filter { conversation in
            conversation.exchanges.contains {
                $0.request.lowercased().contains(q) || $0.reply.lowercased().contains(q)
            }
        }
    }

    private var selected: Conversation? {
        store.conversations.first { $0.id == selectedID } ?? filtered.first
    }

    var body: some View {
        HStack(spacing: 0) {
            list
                .frame(width: 320)
            Rectangle().fill(Theme.hairline).frame(width: 1)
            if let selected {
                ConversationDetail(conversation: selected) {
                    store.delete(selected)
                    selectedID = nil
                }
                .id(selected.id)
            } else {
                emptyState
            }
        }
    }

    private var list: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 14) {
                Text("Conversations")
                    .font(Theme.display(24))
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.tertiary)
                    TextField("Search everything Nova has said", text: $query)
                        .textFieldStyle(.plain)
                        .font(Theme.body(13))
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 7)
                .background(Color.white, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))
            }
            .padding(.horizontal, 20)
            .padding(.top, 48)
            .padding(.bottom, 14)

            Hairline()

            if filtered.isEmpty {
                Text(query.isEmpty ? "Nothing yet." : "No matches.")
                    .font(Theme.body(13))
                    .foregroundStyle(Theme.tertiary)
                    .padding(20)
                Spacer()
            } else {
                ScrollView {
                    LazyVStack(spacing: 2) {
                        ForEach(filtered) { conversation in
                            ConversationRow(conversation: conversation,
                                            selected: conversation.id == selected?.id) {
                                selectedID = conversation.id
                            }
                        }
                    }
                    .padding(10)
                }
            }
        }
        .background(Theme.background)
    }

    private var emptyState: some View {
        VStack(spacing: 10) {
            NovaGlyph()
                .frame(width: 28, height: 28)
                .opacity(0.5)
            Text("No conversations yet")
                .font(Theme.display(20))
            Text("Press ⌃Space anywhere and ask Nova something.\nEvery exchange will show up here.")
                .font(Theme.body(13))
                .foregroundStyle(Theme.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct ConversationRow: View {
    let conversation: Conversation
    let selected: Bool
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 5) {
                Text(conversation.title)
                    .font(.system(size: 13.5, weight: .medium))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                HStack(spacing: 6) {
                    Text(Format.date(conversation.updatedAt))
                    if conversation.exchanges.count > 1 {
                        Text("·")
                        Text("\(conversation.exchanges.count) messages")
                    }
                    Spacer()
                    Text(Format.cost(conversation.usage.costUSD))
                        .monospacedDigit()
                }
                .font(Theme.caption(11))
                .foregroundStyle(Theme.tertiary)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .fill(selected ? Theme.selection : (hovering ? Theme.selection.opacity(0.45) : .clear))
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
    }
}

private struct ConversationDetail: View {
    let conversation: Conversation
    let onDelete: () -> Void
    @State private var confirmingDelete = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                header
                ForEach(conversation.exchanges) { exchange in
                    ExchangeView(exchange: exchange)
                }
            }
            .padding(.horizontal, 40)
            .padding(.top, 48)
            .padding(.bottom, 40)
            .frame(maxWidth: 820, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                Text(conversation.title)
                    .font(Theme.display(24))
                    .textSelection(.enabled)
                Spacer(minLength: 20)
                Button("Delete") { confirmingDelete = true }
                    .buttonStyle(NovaButtonStyle(kind: .destructive))
                    .confirmationDialog("Delete this conversation?", isPresented: $confirmingDelete) {
                        Button("Delete", role: .destructive, action: onDelete)
                    } message: {
                        Text("It will be removed from Nova's history for good.")
                    }
            }
            let usage = conversation.usage
            Text([
                conversation.startedAt.formatted(date: .long, time: .shortened),
                "\(conversation.exchanges.count) message\(conversation.exchanges.count == 1 ? "" : "s")",
                "\(Format.tokens(usage.totalTokens)) tokens",
                Format.cost(usage.costUSD),
            ].joined(separator: "  ·  "))
            .font(Theme.caption(12))
            .foregroundStyle(Theme.tertiary)
        }
    }
}

private struct ExchangeView: View {
    let exchange: Exchange
    @State private var showActions = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            // The user's request
            VStack(alignment: .leading, spacing: 6) {
                SectionLabel("You")
                Text(exchange.request)
                    .font(.system(size: 14.5, weight: .medium))
                    .textSelection(.enabled)
                if !exchange.context.isEmpty {
                    HStack(spacing: 6) {
                        ForEach(exchange.context, id: \.self) { label in
                            Text(label)
                                .font(Theme.caption(11))
                                .foregroundStyle(Theme.secondary)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 3)
                                .background(Theme.selection.opacity(0.6), in: Capsule())
                        }
                    }
                }
            }

            // Nova's reply
            Card(padding: 18) {
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        SectionLabel("Nova")
                        Spacer()
                        if exchange.outcome != .completed {
                            Text(exchange.outcome == .stopped ? "Stopped" : "Failed")
                                .font(Theme.caption(11))
                                .foregroundStyle(exchange.outcome == .failed ? Theme.danger : Theme.secondary)
                        }
                    }
                    Text(Self.markdown(exchange.reply))
                        .font(Theme.body(14))
                        .lineSpacing(4)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    if !exchange.actions.isEmpty {
                        Hairline()
                        actions
                    }

                    Hairline()
                    meta
                }
            }
        }
    }

    private var actions: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                withAnimation(.easeOut(duration: 0.2)) { showActions.toggle() }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 9, weight: .semibold))
                        .rotationEffect(.degrees(showActions ? 90 : 0))
                    Text("\(exchange.actions.count) action\(exchange.actions.count == 1 ? "" : "s") taken")
                        .font(Theme.caption(12))
                }
                .foregroundStyle(Theme.secondary)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if showActions {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(exchange.actions) { action in
                        HStack(alignment: .firstTextBaseline, spacing: 10) {
                            Text(action.date.formatted(date: .omitted, time: .standard))
                                .font(Theme.mono(11))
                                .foregroundStyle(Theme.tertiary)
                            Text(Self.kindLabel(action.kind))
                                .font(Theme.caption(10.5))
                                .foregroundStyle(Theme.secondary)
                                .frame(width: 54, alignment: .leading)
                            Text(action.summary)
                                .font(action.kind == .shell ? Theme.mono(12) : Theme.body(12.5))
                                .foregroundStyle(action.isError ? Theme.danger : Theme.ink)
                                .textSelection(.enabled)
                                .lineLimit(3)
                        }
                    }
                }
                .padding(.leading, 15)
                .transition(.opacity)
            }
        }
    }

    private var meta: some View {
        HStack(spacing: 14) {
            if let tier = exchange.tier.flatMap(Tier.init(rawValue:)) {
                metaItem("Model", tier.displayName)
            }
            metaItem("Time", Format.duration(exchange.duration))
            metaItem("Tokens", Format.tokens(exchange.usage.totalTokens))
            metaItem("Cost", Format.cost(exchange.usage.costUSD))
            Spacer()
            Text(exchange.date.formatted(date: .omitted, time: .shortened))
                .font(Theme.caption(11))
                .foregroundStyle(Theme.tertiary)
        }
    }

    private func metaItem(_ label: String, _ value: String) -> some View {
        HStack(spacing: 5) {
            Text(label)
                .foregroundStyle(Theme.tertiary)
            Text(value)
                .foregroundStyle(Theme.secondary)
                .monospacedDigit()
        }
        .font(Theme.caption(11))
    }

    private static func kindLabel(_ kind: ActionRecord.Kind) -> String {
        switch kind {
        case .computer: return "SCREEN"
        case .shell: return "SHELL"
        case .memory: return "MEMORY"
        }
    }

    private static func markdown(_ text: String) -> AttributedString {
        let options = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        return (try? AttributedString(markdown: text, options: options)) ?? AttributedString(text)
    }
}
