import SwiftUI

/// What Nova remembers about the user. Nova adds to it on its own; the user can add, edit, and delete.
struct MemoryView: View {
    @ObservedObject var store: NovaStore
    @State private var draft = ""
    @State private var confirmingClear = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                PageHeader(title: "Memory",
                           subtitle: "Nova uses these in every conversation. It saves new ones as it learns about you.") {
                    if !store.memories.isEmpty {
                        Button("Clear all") { confirmingClear = true }
                            .buttonStyle(NovaButtonStyle(kind: .destructive))
                            .confirmationDialog("Delete every memory?", isPresented: $confirmingClear) {
                                Button("Delete all", role: .destructive) { store.deleteAllMemories() }
                            } message: {
                                Text("Nova will forget everything it has learned about you.")
                            }
                    }
                }

                HStack(spacing: 10) {
                    TextField("Add something for Nova to remember", text: $draft)
                        .novaField()
                        .onSubmit(add)
                    Button("Add", action: add)
                        .buttonStyle(NovaButtonStyle(kind: .primary))
                        .disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty)
                }

                if store.memories.isEmpty {
                    Card {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Nothing remembered yet")
                                .font(Theme.title())
                            Text("Tell Nova things like \u{201C}remember that I prefer short answers\u{201D} or add them here.")
                                .font(Theme.body(13))
                                .foregroundStyle(Theme.secondary)
                        }
                    }
                } else {
                    Card(padding: 0) {
                        VStack(spacing: 0) {
                            ForEach(Array(store.memories.enumerated()), id: \.element.id) { index, memory in
                                if index > 0 { Hairline() }
                                MemoryRow(memory: memory, store: store)
                            }
                        }
                    }
                }
            }
            .padding(.horizontal, 40)
            .padding(.top, 48)
            .padding(.bottom, 40)
            .frame(maxWidth: 820, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func add() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        store.addMemory(text, source: .user)
        draft = ""
    }
}

private struct MemoryRow: View {
    let memory: Memory
    let store: NovaStore
    @State private var editing = false
    @State private var text = ""
    @State private var hovering = false

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 5) {
                if editing {
                    TextField("Memory", text: $text, axis: .vertical)
                        .novaField()
                        .onSubmit(save)
                } else {
                    Text(memory.text)
                        .font(Theme.body(14))
                        .textSelection(.enabled)
                }
                Text("\(memory.source == .nova ? "Saved by Nova" : "Added by you") · \(Format.date(memory.createdAt))")
                    .font(Theme.caption(11))
                    .foregroundStyle(Theme.tertiary)
            }
            Spacer(minLength: 12)
            HStack(spacing: 6) {
                if editing {
                    Button("Cancel") { editing = false }
                        .buttonStyle(NovaButtonStyle())
                    Button("Save", action: save)
                        .buttonStyle(NovaButtonStyle(kind: .primary))
                } else {
                    Button("Edit") {
                        text = memory.text
                        editing = true
                    }
                    .buttonStyle(NovaButtonStyle())
                    Button("Delete") { store.deleteMemory(memory) }
                        .buttonStyle(NovaButtonStyle(kind: .destructive))
                }
            }
            .opacity(editing || hovering ? 1 : 0)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 14)
        .contentShape(Rectangle())
        .onHover { hovering = $0 }
    }

    private func save() {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty { store.updateMemory(memory, text: trimmed) }
        editing = false
    }
}
