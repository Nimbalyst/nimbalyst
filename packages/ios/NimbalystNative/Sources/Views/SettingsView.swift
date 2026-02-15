import SwiftUI

/// Native settings screen with connection info, account, notifications, and unpair.
struct SettingsView: View {
    @EnvironmentObject var appState: AppState
    @State private var pushEnabled = UserDefaults.standard.bool(forKey: "pushNotificationsEnabled")
    @State private var showUnpairConfirmation = false
    @Environment(\.dismiss) private var dismiss

    private var connectedDevices: [DeviceInfo] {
        appState.syncManager?.connectedDevices ?? []
    }

    var body: some View {
        Form {
            connectionSection
            accountSection
            #if os(iOS)
            notificationsSection
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
