import SwiftUI

/// Native settings screen with connection info, account, notifications, and unpair.
public struct SettingsView: View {
    @EnvironmentObject var appState: AppState
    @State private var pushEnabled = UserDefaults.standard.bool(forKey: "pushNotificationsEnabled")
    @State private var analyticsEnabled = AnalyticsManager.shared.isEnabled
    @State private var showUnpairConfirmation = false
    @Environment(\.dismiss) private var dismiss

    // Voice mode settings
    #if os(iOS)
    @State private var hasOpenAIApiKey = KeychainManager.getOpenAIApiKey() != nil
    @State private var voiceSettings = VoiceModeSettings.load()
    #endif

    public init() {}

    private var connectedDevices: [DeviceInfo] {
        appState.syncManager?.connectedDevices ?? []
    }

    public var body: some View {
        Form {
            connectionSection
            accountSection
            #if os(iOS)
            voiceModeSection
            notificationsSection
            analyticsSection
            #endif
            dangerSection
        }
        .navigationTitle("Settings")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.large)
        #endif
    }

    // MARK: - Connection

    private var connectionSection: some View {
        Section("Connection") {
            HStack {
                Text("Status")
                Spacer()
                HStack(spacing: 6) {
                    Circle()
                        .fill(appState.isConnected ? NimbalystColors.success : NimbalystColors.textDisabled)
                        .frame(width: 8, height: 8)
                    Text(appState.isConnected ? "Connected" : "Disconnected")
                        .foregroundStyle(.secondary)
                }
            }

            if let serverUrl = KeychainManager.getServerUrl() {
                HStack {
                    Text("Server")
                    Spacer()
                    Text(serverUrl)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }

            if !connectedDevices.isEmpty {
                DisclosureGroup("Connected Devices (\(connectedDevices.count))") {
                    ForEach(connectedDevices, id: \.deviceId) { device in
                        HStack {
                            Image(systemName: deviceIcon(for: device.type))
                                .foregroundStyle(.secondary)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(device.name)
                                    .font(.body)
                                Text(device.platform)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
        }
    }

    // MARK: - Account

    private var accountSection: some View {
        Section("Account") {
            if let userId = KeychainManager.getUserId() {
                HStack {
                    Text("User ID")
                    Spacer()
                    Text(userId)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .font(.caption)
                }
            }

            HStack {
                Text("Paired")
                Spacer()
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(NimbalystColors.success)
            }
        }
    }

    // MARK: - Notifications

    #if os(iOS)
    private var notificationsSection: some View {
        Section {
            Toggle("Push Notifications", isOn: $pushEnabled)
                .onChange(of: pushEnabled) { newValue in
                    UserDefaults.standard.set(newValue, forKey: "pushNotificationsEnabled")
                    if newValue {
                        NotificationManager.shared.requestPermission()
                    }
                }
        } header: {
            Text("Notifications")
        } footer: {
            Text("Get notified when AI sessions complete or need your attention.")
        }
    }
    #endif

    // MARK: - Voice Mode

    #if os(iOS)
    private static let voiceOptions = [
        "alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse",
    ]

    private var voiceModeSection: some View {
        Section {
            // API Key (synced from desktop)
            HStack {
                Text("OpenAI API Key")
                Spacer()
                if hasOpenAIApiKey {
                    HStack(spacing: 4) {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundStyle(NimbalystColors.success)
                        Text("Synced from desktop")
                            .foregroundStyle(.secondary)
                    }
                    .font(.caption)
                } else {
                    Text("Not synced yet")
                        .foregroundStyle(.secondary)
                        .font(.caption)
                }
            }
            .onReceive(NotificationCenter.default.publisher(for: .init("OpenAIApiKeySynced"))) { _ in
                hasOpenAIApiKey = KeychainManager.getOpenAIApiKey() != nil
            }

            // Voice picker
            Picker("Voice", selection: $voiceSettings.voice) {
                ForEach(Self.voiceOptions, id: \.self) { voice in
                    Text(voice.capitalized).tag(voice)
                }
            }
            .onChange(of: voiceSettings.voice) { _ in saveVoiceSettings() }

            // Idle timeout
            Stepper(
                "Idle Timeout: \(Int(voiceSettings.idleTimeout))s",
                value: $voiceSettings.idleTimeout,
                in: 10...120,
                step: 10
            )
            .onChange(of: voiceSettings.idleTimeout) { _ in saveVoiceSettings() }

            // Auto-announce completions
            Toggle("Auto-Announce Completions", isOn: $voiceSettings.autoAnnounceCompletions)
                .onChange(of: voiceSettings.autoAnnounceCompletions) { _ in saveVoiceSettings() }

            // Prompt confirmation delay
            Stepper(
                "Confirm Delay: \(Int(voiceSettings.promptConfirmationDelay))s",
                value: $voiceSettings.promptConfirmationDelay,
                in: 1...10,
                step: 1
            )
            .onChange(of: voiceSettings.promptConfirmationDelay) { _ in saveVoiceSettings() }
        } header: {
            Text("Voice Mode")
        } footer: {
            Text("Voice mode uses OpenAI's Realtime API for voice-to-voice conversations. The API key is synced from your desktop app's OpenAI settings.")
        }
    }

    private func saveVoiceSettings() {
        voiceSettings.save()
        appState.voiceAgent?.settings = voiceSettings
    }
    #endif

    // MARK: - Analytics

    #if os(iOS)
    private var analyticsSection: some View {
        Section {
            Toggle("Usage Analytics", isOn: $analyticsEnabled)
                .onChange(of: analyticsEnabled) { newValue in
                    if newValue {
                        AnalyticsManager.shared.optIn()
                    } else {
                        AnalyticsManager.shared.optOut()
                    }
                }
        } header: {
            Text("Privacy")
        } footer: {
            Text("Anonymous usage analytics help improve Nimbalyst. No session content or file paths are ever collected.")
        }
    }
    #endif

    // MARK: - Danger Zone

    private var dangerSection: some View {
        Section {
            Button(role: .destructive) {
                showUnpairConfirmation = true
            } label: {
                HStack {
                    Image(systemName: "link.badge.plus")
                        .symbolRenderingMode(.multicolor)
                    Text("Unpair Device")
                }
            }
            .confirmationDialog(
                "Unpair this device?",
                isPresented: $showUnpairConfirmation,
                titleVisibility: .visible
            ) {
                Button("Unpair", role: .destructive) {
                    appState.unpair()
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This will remove all synced data from this device. You can re-pair later by scanning a new QR code.")
            }
        }
    }

    // MARK: - Helpers

    private func deviceIcon(for type: String) -> String {
        switch type {
        case "desktop": return "desktopcomputer"
        case "mobile": return "iphone"
        case "tablet": return "ipad"
        default: return "display"
        }
    }
}
