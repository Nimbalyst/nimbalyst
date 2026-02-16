#if os(iOS)
import SwiftUI

/// Floating voice mode indicator displayed over the main content.
/// Shows the current voice state with animated visuals.
/// Tap to activate/resume, long-press to deactivate.
struct VoiceOverlay: View {
    @ObservedObject var voiceAgent: VoiceAgent

    @State private var pulseScale: CGFloat = 1.0
    @State private var ringOpacity: Double = 0.5
    @State private var dotOffset: CGFloat = 0

    private let buttonSize: CGFloat = 56

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            // Pending prompt card sits above the button
            if let pending = voiceAgent.pendingPrompt {
                PendingPromptCard(
                    prompt: pending,
                    onCancel: { voiceAgent.cancelPendingPrompt() },
                    onConfirm: { voiceAgent.confirmPendingPrompt() }
                )
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .padding(.bottom, 12)
            }

            // Main voice button
            voiceButton
                .padding(.bottom, 8)
        }
        .animation(.spring(response: 0.3), value: voiceAgent.pendingPrompt != nil)
        .animation(.easeInOut(duration: 0.2), value: voiceAgent.state)
    }

    // MARK: - Voice Button

    private var voiceButton: some View {
        ZStack {
            // Animated ring behind the button
            if shouldShowRing {
                Circle()
                    .stroke(ringColor, lineWidth: 2)
                    .frame(width: buttonSize + 16, height: buttonSize + 16)
                    .scaleEffect(pulseScale)
                    .opacity(ringOpacity)
            }

            // Main button
            Button {
                handleTap()
            } label: {
                ZStack {
                    Circle()
                        .fill(buttonBackground)
                        .frame(width: buttonSize, height: buttonSize)
                        .shadow(color: .black.opacity(0.3), radius: 8, y: 4)

                    buttonContent
                }
            }
            .simultaneousGesture(
                LongPressGesture(minimumDuration: 0.8)
                    .onEnded { _ in
                        let generator = UIImpactFeedbackGenerator(style: .heavy)
                        generator.impactOccurred()
                        voiceAgent.deactivate()
                    }
            )
        }
        .onAppear { startAnimations() }
        .onChange(of: voiceAgent.state) { _ in startAnimations() }
    }

    // MARK: - Button Content

    @ViewBuilder
    private var buttonContent: some View {
        switch voiceAgent.state {
        case .disconnected:
            Image(systemName: "mic.fill")
                .font(.system(size: 22))
                .foregroundStyle(.white)

        case .connecting:
            ProgressView()
                .tint(.white)

        case .listening:
            Image(systemName: "mic.fill")
                .font(.system(size: 22))
                .foregroundStyle(.white)

        case .processing:
            // Animated thinking dots
            HStack(spacing: 4) {
                ForEach(0..<3) { i in
                    Circle()
                        .fill(.white)
                        .frame(width: 6, height: 6)
                        .offset(y: dotOffset(for: i))
                }
            }

        case .speaking:
            Image(systemName: "speaker.wave.2.fill")
                .font(.system(size: 20))
                .foregroundStyle(.white)

        case .idle:
            VStack(spacing: 2) {
                Image(systemName: "mic.fill")
                    .font(.system(size: 18))
                    .foregroundStyle(.white.opacity(0.5))
            }
        }
    }

    // MARK: - Styling

    private var buttonBackground: Color {
        switch voiceAgent.state {
        case .disconnected: return NimbalystColors.backgroundTertiary
        case .connecting: return NimbalystColors.backgroundActive
        case .listening: return NimbalystColors.primary
        case .processing: return NimbalystColors.purple
        case .speaking: return NimbalystColors.success
        case .idle: return NimbalystColors.backgroundActive.opacity(0.7)
        }
    }

    private var ringColor: Color {
        switch voiceAgent.state {
        case .listening: return NimbalystColors.primary
        case .speaking: return NimbalystColors.success
        default: return .clear
        }
    }

    private var shouldShowRing: Bool {
        voiceAgent.state == .listening || voiceAgent.state == .speaking
    }

    // MARK: - Actions

    private func handleTap() {
        switch voiceAgent.state {
        case .disconnected:
            let generator = UIImpactFeedbackGenerator(style: .medium)
            generator.impactOccurred()
            voiceAgent.activate()

        case .idle:
            let generator = UIImpactFeedbackGenerator(style: .light)
            generator.impactOccurred()
            voiceAgent.activate()

        default:
            break
        }
    }

    // MARK: - Animations

    private func dotOffset(for index: Int) -> CGFloat {
        guard voiceAgent.state == .processing else { return 0 }
        let phase = dotOffset + CGFloat(index) * 0.3
        return sin(phase * .pi * 2) * 4
    }

    private func startAnimations() {
        switch voiceAgent.state {
        case .listening:
            withAnimation(.easeInOut(duration: 1.5).repeatForever(autoreverses: true)) {
                pulseScale = 1.15
                ringOpacity = 0.8
            }

        case .speaking:
            withAnimation(.easeInOut(duration: 0.8).repeatForever(autoreverses: true)) {
                pulseScale = 1.2
                ringOpacity = 0.9
            }

        case .processing:
            withAnimation(.linear(duration: 1.0).repeatForever(autoreverses: false)) {
                dotOffset = 1.0
            }

        default:
            pulseScale = 1.0
            ringOpacity = 0.5
            dotOffset = 0
        }
    }
}
#endif
