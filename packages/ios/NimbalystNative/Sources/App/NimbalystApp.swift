import SwiftUI
import GRDB

#if canImport(UIKit)
/// Invisible UIView overlay that intercepts all touches to report user activity
/// for device presence tracking. Passes all touches through without consuming them.
/// This mirrors how the Electron app uses document-level event listeners.
class ActivityTrackingView: UIView {
    var onActivity: (() -> Void)?

    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        // Report activity on any touch, then return nil to pass through
        onActivity?()
        return nil
    }
}

/// SwiftUI wrapper for the activity tracking overlay.
struct ActivityTrackingOverlay: UIViewRepresentable {
    let onActivity: () -> Void

    func makeUIView(context: Context) -> ActivityTrackingView {
        let view = ActivityTrackingView()
        view.onActivity = onActivity
        view.isUserInteractionEnabled = true
        view.backgroundColor = .clear
        return view
    }

    func updateUIView(_ uiView: ActivityTrackingView, context: Context) {
        uiView.onActivity = onActivity
    }
}
#endif

/// Root content view that handles navigation based on pairing and auth state.
public struct ContentView: View {
    @EnvironmentObject var appState: AppState

    public init() {}

    public var body: some View {
        Group {
            if !appState.isPaired {
                PairingView()
            } else if !appState.authManager.isAuthenticated {
                LoginView()
            } else {
                MainNavigationView()
            }
        }
        .preferredColorScheme(.dark)
        #if canImport(UIKit)
        .overlay {
            // Invisible overlay that reports user activity on any touch.
            // Throttling is handled inside WebSocketClient.reportActivity().
            ActivityTrackingOverlay {
                appState.syncManager?.reportUserActivity()
            }
            .allowsHitTesting(true)
        }
        #endif
    }
}

/// Login screen shown after pairing but before authentication.
/// Offers Google OAuth and email magic link sign-in.
/// The paired email (from QR code) determines which account to use.
public struct LoginView: View {
    @EnvironmentObject var appState: AppState

    private var pairedEmail: String? {
        if let email = KeychainManager.getUserId(), email.contains("@") {
            return email
        }
        return nil
    }

    public init() {}

    public var body: some View {
        let _ = NSLog("[LoginView] getUserId=\(KeychainManager.getUserId() ?? "nil"), pairedEmail=\(pairedEmail ?? "nil")")
        VStack(spacing: 24) {
            Spacer()

            Image(systemName: "person.crop.circle.badge.checkmark")
                .font(.system(size: 64))
                .foregroundStyle(NimbalystColors.primary)

            Text("Sign In")
                .font(.title)
                .fontWeight(.bold)

            if let pairedEmail {
                Text("Sign in as **\(pairedEmail)** to sync with your Mac.")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
            } else {
                Text("Sign in with the same account you use on your Mac to sync your sessions.")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
            }

            #if os(iOS)
            if appState.authManager.magicLinkSent {
                // Waiting for user to tap the link in their email
                magicLinkSentView
            } else {
                // Sign-in buttons
                VStack(spacing: 12) {
                    Button {
                        guard let serverUrl = KeychainManager.getServerUrl() else { return }
                        appState.authManager.login(serverUrl: serverUrl)
                    } label: {
                        HStack(spacing: 8) {
                            if appState.authManager.isAuthenticating {
                                ProgressView()
                                    .tint(.white)
                            }
                            Text(appState.authManager.isAuthenticating ? "Signing in..." : "Sign in with Google")
                                .fontWeight(.semibold)
                        }
                        .frame(maxWidth: .infinity)
                        .frame(height: 50)
                        .background(NimbalystColors.primary)
                        .foregroundStyle(.white)
                        .cornerRadius(12)
                    }
                    .disabled(appState.authManager.isAuthenticating)

                    if let email = pairedEmail {
                        Button {
                            guard let serverUrl = KeychainManager.getServerUrl() else { return }
                            appState.authManager.sendMagicLink(email: email, serverUrl: serverUrl)
                        } label: {
                            HStack(spacing: 8) {
                                if appState.authManager.isAuthenticating {
                                    ProgressView()
                                        .tint(NimbalystColors.primary)
                                }
                                Text(appState.authManager.isAuthenticating ? "Sending..." : "Sign in with email link")
                                    .fontWeight(.semibold)
                            }
                            .frame(maxWidth: .infinity)
                            .frame(height: 50)
                            .background(Color.clear)
                            .foregroundStyle(NimbalystColors.primary)
                            .overlay(
                                RoundedRectangle(cornerRadius: 12)
                                    .stroke(NimbalystColors.primary, lineWidth: 1.5)
                            )
                        }
                        .disabled(appState.authManager.isAuthenticating)
                    }
                }
                .padding(.horizontal, 32)
            }
            #endif

            if let error = appState.authManager.authError {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(NimbalystColors.error)
                    .padding(.horizontal, 32)
            }

            Spacer()

            Button("Unpair Device") {
                appState.unpair()
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            .padding(.bottom, 24)
        }
    }

    #if os(iOS)
    private var magicLinkSentView: some View {
        VStack(spacing: 16) {
            Image(systemName: "envelope.badge")
                .font(.system(size: 36))
                .foregroundStyle(NimbalystColors.success)

            Text("Check your email")
                .font(.headline)

            if let email = pairedEmail {
                Text("We sent a sign-in link to **\(email)**. Tap the link in your email to continue.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }

            Button("Resend link") {
                guard let email = pairedEmail,
                      let serverUrl = KeychainManager.getServerUrl() else { return }
                appState.authManager.magicLinkSent = false
                appState.authManager.sendMagicLink(email: email, serverUrl: serverUrl)
            }
            .font(.callout)
            .foregroundStyle(NimbalystColors.primary)
            .padding(.top, 4)

            Button("Use a different sign-in method") {
                appState.authManager.magicLinkSent = false
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            .padding(.top, 4)
        }
        .padding(.horizontal, 32)
    }
    #endif
}

/// Main navigation using NavigationStack for iPhone and NavigationSplitView for iPad.
///
/// iPad layout: two-column split view.
///   - Sidebar: session list for the auto-selected (or user-picked) project
///   - Detail: session transcript
///   - Project switcher via toolbar folder button (sheet)
///
/// iPhone layout: standard stack navigation (Projects -> Sessions -> Detail).
public struct MainNavigationView: View {
    @EnvironmentObject var appState: AppState
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var navigationPath = NavigationPath()
    @State private var showNotificationPrompt = false
    @ObservedObject private var notificationManager = NotificationManager.shared

    public init() {}

    public var body: some View {
        Group {
            if sizeClass == .regular {
                IPadNavigationView()
                    .environmentObject(appState)
            } else {
                NavigationStack(path: $navigationPath) {
                    ProjectListView()
                        .environmentObject(appState)
                }
            }
        }
        #if os(iOS)
        .overlay(alignment: .bottom) {
            if let voice = appState.voiceAgent, voice.state != .disconnected {
                VoiceOverlay(voiceAgent: voice)
                    .padding(.bottom, 8)
            }
        }
        #endif
        .onChange(of: notificationManager.pendingSessionId) { _, newValue in
            guard let sessionId = newValue else { return }
            navigateToSession(sessionId)
            notificationManager.pendingSessionId = nil
        }
        .onAppear {
            let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "unknown"
            AnalyticsManager.shared.capture("mobile_app_opened", properties: [
                "platform": "ios",
                "$set": ["nimbalyst_mobile_version": version],
            ])

            // Handle notification tap that launched the app
            if let sessionId = notificationManager.pendingSessionId {
                navigateToSession(sessionId)
                notificationManager.pendingSessionId = nil
            }

            // Show one-time push notification prompt after pairing + auth
            if notificationManager.shouldPromptForNotifications {
                // Small delay so the main view finishes rendering first
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                    showNotificationPrompt = true
                }
            }
        }
        .alert("Enable Notifications?", isPresented: $showNotificationPrompt) {
            Button("Enable") {
                notificationManager.markPromptShown()
                UserDefaults.standard.set(true, forKey: "pushNotificationsEnabled")
                notificationManager.requestPermission()
            }
            Button("Not Now", role: .cancel) {
                notificationManager.markPromptShown()
            }
        } message: {
            Text("Get notified when your AI sessions complete or need your attention, even when Nimbalyst is in the background.")
        }
    }

    private func navigateToSession(_ sessionId: String) {
        guard sizeClass != .regular else {
            // iPad: set selectedSession on IPadNavigationView (handled separately)
            return
        }
        guard let db = appState.databaseManager,
              let session = try? db.session(byId: sessionId) else { return }
        guard let project = try? db.writer.read({ db in
            try Project.fetchOne(db, id: session.projectId)
        }) else { return }

        navigationPath = NavigationPath()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
            navigationPath.append(project)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                navigationPath.append(session)
            }
        }
    }
}

// MARK: - iPad Navigation

/// iPad two-column layout: sessions sidebar + session detail.
/// Project selection is via a toolbar picker sheet rather than a dedicated column,
/// since the project list is a one-time selection, not a persistent sidebar.
struct IPadNavigationView: View {
    @EnvironmentObject var appState: AppState
    @State private var selectedProject: Project?
    @State private var selectedSession: Session?
    @State private var showProjectPicker = false
    @State private var projects: [Project] = []
    @State private var projectsCancellable: AnyDatabaseCancellable?

    var body: some View {
        NavigationSplitView {
            if let project = selectedProject {
                IPadSessionSidebar(
                    project: project,
                    selectedSession: $selectedSession,
                    onSwitchProject: { showProjectPicker = true }
                )
                .environmentObject(appState)
            } else {
                VStack(spacing: 16) {
                    Image(systemName: "folder")
                        .font(.system(size: 48))
                        .foregroundStyle(.secondary)
                    Text("No Projects")
                        .font(.title3)
                    Text("Projects will appear once synced from your Mac.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
            }
        } detail: {
            if let session = selectedSession {
                SessionDetailView(session: session)
                    .environmentObject(appState)
                    .id(session.id)
            } else {
                Text("Select a session")
                    .foregroundStyle(.secondary)
            }
        }
        .onAppear { startObservingProjects() }
        .onDisappear { projectsCancellable?.cancel() }
        .sheet(isPresented: $showProjectPicker) {
            projectPickerSheet
        }
    }

    private var projectPickerSheet: some View {
        NavigationStack {
            List(projects) { project in
                Button {
                    selectedProject = project
                    selectedSession = nil
                    showProjectPicker = false
                    configureVoiceForProject(project)
                } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(project.name)
                                .font(.body)
                                .foregroundStyle(.primary)
                            if project.sessionCount > 0 {
                                Text("\(project.sessionCount) session\(project.sessionCount == 1 ? "" : "s")")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        Spacer()
                        if project.id == selectedProject?.id {
                            Image(systemName: "checkmark")
                                .foregroundStyle(NimbalystColors.primary)
                        }
                    }
                    .padding(.vertical, 4)
                }
            }
            .navigationTitle("Switch Project")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { showProjectPicker = false }
                }
                ToolbarItem(placement: .primaryAction) {
                    NavigationLink {
                        SettingsView()
                            .environmentObject(appState)
                    } label: {
                        Image(systemName: "gearshape")
                    }
                }
            }
        }
    }

    private func startObservingProjects() {
        guard let db = appState.databaseManager else { return }

        let observation = ValueObservation.tracking { db in
            try Project
                .order(Project.Columns.lastUpdatedAt.desc, Project.Columns.name)
                .fetchAll(db)
        }

        projectsCancellable = observation.start(
            in: db.writer,
            onError: { _ in
            },
            onChange: { newProjects in
                projects = newProjects
                // Auto-select the most recent project if none selected
                if selectedProject == nil, let first = newProjects.first {
                    selectedProject = first
                    appState.configureVoiceAgent(forProject: first.id)
                }
            }
        )
    }

    private func configureVoiceForProject(_ project: Project) {
        appState.configureVoiceAgent(forProject: project.id)
    }
}

/// iPad session list sidebar with selection binding that drives the detail column.
struct IPadSessionSidebar: View {
    @EnvironmentObject var appState: AppState
    let project: Project
    @Binding var selectedSession: Session?
    let onSwitchProject: () -> Void

    @State private var sessions: [Session] = []
    @State private var cancellable: AnyDatabaseCancellable?
    @State private var searchText = ""
    @State private var isCreatingSession = false
    @State private var isLoadingSessions = true

    private var voiceFocusedSessionId: String? {
        #if os(iOS)
        return appState.voiceAgent?.activeSessionId
        #else
        return nil
        #endif
    }

    private var filteredSessions: [Session] {
        if searchText.isEmpty { return sessions }
        return sessions.filter {
            $0.titleDecrypted?.localizedCaseInsensitiveContains(searchText) == true
        }
    }

    private var groupedSessions: [GroupedSessions] {
        let grouped = Dictionary(grouping: filteredSessions) { session in
            TimePeriod.classify(epochMs: session.updatedAt)
        }
        return TimePeriod.allCases.compactMap { period in
            guard let sessions = grouped[period], !sessions.isEmpty else { return nil }
            return GroupedSessions(period: period, sessions: sessions)
        }
    }

    var body: some View {
        List(selection: $selectedSession) {
            ForEach(groupedSessions) { group in
                Section(group.period.rawValue) {
                    ForEach(group.sessions) { session in
                        SessionRow(
                            session: session,
                            voiceFocusedSessionId: voiceFocusedSessionId
                        )
                        .tag(session)
                    }
                    .onDelete { offsets in
                        deleteSessionsInGroup(group: group, at: offsets)
                    }
                }
            }
        }
        .listStyle(.sidebar)
        .navigationTitle(project.name)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.large)
        #endif
        .searchable(text: $searchText, prompt: "Search sessions")
        .refreshable {
            appState.requestSync()
            try? await Task.sleep(nanoseconds: 500_000_000)
        }
        .toolbar {
            #if os(iOS)
            ToolbarItem(placement: .topBarLeading) {
                Button { onSwitchProject() } label: {
                    Image(systemName: "folder")
                }
            }
            #else
            ToolbarItem {
                Button { onSwitchProject() } label: {
                    Image(systemName: "folder")
                }
            }
            #endif
            ToolbarItem(placement: .primaryAction) {
                HStack(spacing: 12) {
                    connectionIndicator
                    Button {
                        createSession()
                    } label: {
                        if isCreatingSession {
                            ProgressView().controlSize(.small)
                        } else {
                            Image(systemName: "plus")
                        }
                    }
                    .disabled(isCreatingSession)
                }
            }
        }
        .overlay {
            if isLoadingSessions {
                ProgressView()
            } else if sessions.isEmpty {
                VStack(spacing: 12) {
                    Image(systemName: "bubble.left.and.bubble.right")
                        .font(.system(size: 48))
                        .foregroundStyle(.secondary)
                    Text("No Sessions")
                        .font(.title3)
                    Text("Start a session in Nimbalyst on your Mac, or tap + to create one.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
                .padding()
            }
        }
        .onAppear { startObserving() }
        .onDisappear { cancellable?.cancel() }
        .onChange(of: project.id) {
            startObserving()
        }
    }

    private var isDesktopConnected: Bool {
        if appState.screenshotMode { return true }
        return appState.syncManager?.connectedDevices.contains(where: { $0.type == "desktop" }) ?? false
    }

    private var connectionIndicator: some View {
        HStack(spacing: 4) {
            Image(systemName: "desktopcomputer")
                .font(.system(size: 14))
                .foregroundStyle(appState.isConnected ? .primary : .secondary)
            Circle()
                .fill(isDesktopConnected ? Color.green : (appState.isConnected ? Color.orange : Color.gray))
                .frame(width: 8, height: 8)
        }
    }

    private func startObserving() {
        cancellable?.cancel()
        isLoadingSessions = true
        sessions = []
        guard let db = appState.databaseManager else { return }
        let projectId = project.id
        let observation = ValueObservation.tracking { db in
            try Session
                .filter(Session.Columns.projectId == projectId)
                .order(Session.Columns.updatedAt.desc)
                .fetchAll(db)
        }
        cancellable = observation.start(
            in: db.writer,
            onError: { _ in },
            onChange: { newSessions in
                withAnimation {
                    sessions = newSessions
                    isLoadingSessions = false
                }
            }
        )
    }

    private func deleteSessionsInGroup(group: GroupedSessions, at offsets: IndexSet) {
        guard let db = appState.databaseManager else { return }
        for index in offsets {
            let session = group.sessions[index]
            do {
                try db.deleteSession(session.id)
                try db.refreshSessionCount(forProject: project.id)
            } catch {
                // Delete failed - row may already be gone from sync
            }
        }
    }

    private func createSession() {
        guard let sync = appState.syncManager else { return }
        isCreatingSession = true
        do {
            try sync.createSession(projectId: project.id, initialPrompt: nil)
        } catch {
            // Create request failed - no connectivity
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            isCreatingSession = false
        }
    }
}
