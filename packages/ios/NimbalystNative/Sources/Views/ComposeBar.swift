import SwiftUI

/// Native input bar for sending prompts to a session.
/// Provides a multi-line text field with a send button.
public struct ComposeBar: View {
    @Binding var text: String
    let isExecuting: Bool
    let onSend: (String) -> Void

    @FocusState private var isFocused: Bool

    private var canSend: Bool {
        !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    public var body: some View {
        VStack(spacing: 0) {
            Divider()

            HStack(alignment: .bottom, spacing: 8) {
                TextField("Message...", text: $text, axis: .vertical)
                    .lineLimit(1...6)
                    .textFieldStyle(.plain)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(NimbalystColors.backgroundTertiary)
                    .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                    .focused($isFocused)

                Button {
                    guard canSend else { return }
                    let prompt = text.trimmingCharacters(in: .whitespacesAndNewlines)
                    text = ""
                    onSend(prompt)
                } label: {
                    Image(systemName: isExecuting ? "clock.fill" : "arrow.up.circle.fill")
                        .font(.system(size: 30))
                        .foregroundStyle(
                            canSend
                                ? NimbalystColors.primary
                                : NimbalystColors.textDisabled
                        )
                }
                .disabled(!canSend)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(.ultraThinMaterial)
        }
    }
}
