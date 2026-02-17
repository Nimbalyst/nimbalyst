import SwiftUI
import Combine
import GRDB

// MARK: - Time Period Grouping

enum TimePeriod: String, CaseIterable {
    case today = "Today"
    case yesterday = "Yesterday"
    case thisWeek = "This Week"
    case lastWeek = "Last Week"
    case thisMonth = "This Month"
    case older = "Older"

    static func classify(epochMs: Int) -> TimePeriod {
        let date = Date(timeIntervalSince1970: Double(epochMs) / 1000)
        let calendar = Calendar.current
        let now = Date()

        if calendar.isDateInToday(date) {
            return .today
        } else if calendar.isDateInYesterday(date) {
            return .yesterday
        } else {
            let startOfWeek = calendar.dateInterval(of: .weekOfYear, for: now)?.start ?? now
            let startOfLastWeek = calendar.date(byAdding: .weekOfYear, value: -1, to: startOfWeek) ?? now
            let startOfMonth = calendar.dateInterval(of: .month, for: now)?.start ?? now

            if date >= startOfWeek {
                return .thisWeek
            } else if date >= startOfLastWeek {
                return .lastWeek
            } else if date >= startOfMonth {
                return .thisMonth
            } else {
                return .older
            }
        }
    }
}

struct GroupedSessions: Identifiable {
    let period: TimePeriod
    let sessions: [Session]
    var id: String { period.rawValue }
}

/// Displays sessions for a given project with status badges, pull-to-refresh,
/// search, time-based grouping, and reactive GRDB observation.
public struct SessionListView: View {
    @EnvironmentObject var appState: AppState
    public let project: Project

    @State private var sessions: [Session] = []
    @State private var cancellable: AnyDatabaseCancellable?

    public init(project: Project) {
        self.project = project
    }
    @State private var searchText = ""
    @State private var isCreatingSession = false

    private var voiceFocusedSessionId: String? {
        #if os(iOS)
        return appState.voiceAgent?.activeSessionId
        #else
        return nil
        #endif
    }

    private var filteredSessions: [Session] {
        if searchText.isEmpty {
            return sessions
        }
        return sessions.filter { session in
            session.titleDecrypted?.localizedCaseInsensitiveContains(searchText) == true
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

    public var body: some View {
        List {
            ForEach(groupedSessions) { group in
                Section(group.period.rawValue) {
                    ForEach(group.sessions) { session in
                        NavigationLink(value: session) {
                            SessionRow(
                                session: session,
                                voiceFocusedSessionId: voiceFocusedSessionId
                            )
                        }
                    }
                    .onDelete { offsets in
                        deleteSessionsInGroup(group: group, at: offsets)
                    }
                }
            }
        }
        .listStyle(.plain)
        .navigationTitle(project.name)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .searchable(text: $searchText, prompt: "Search sessions")
        .refreshable {
            appState.requestSync()
            try? await Task.sleep(nanoseconds: 500_000_000)
        }
        .navigationDestination(for: Session.self) { session in
            SessionDetailView(session: session)
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                HStack(spacing: 12) {
                    #if os(iOS)
                    if let voice = appState.voiceAgent, voice.state != .disconnected {
                        VoiceStatusPill(state: voice.state)
                    }
                    #endif
                    connectionIndicator
                    Button {
                        createAndNavigateToSession()
                    } label: {
                        if isCreatingSession {
                            ProgressView()
                                .controlSize(.small)
                        } else {
                            Image(systemName: "plus")
                        }
                    }
                    .disabled(isCreatingSession)
                }
            }
        }
        .overlay {
            if sessions.isEmpty {
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
        .onAppear {
            startObserving()
            appState.configureVoiceAgent(forProject: project.id)
        }
        .onDisappear {
            cancellable?.cancel()
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
            onError: { error in
                print("Session observation error: \(error)")
            },
            onChange: { newSessions in
                withAnimation {
                    sessions = newSessions
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
                print("Failed to delete session: \(error)")
            }
        }
    }

    /// Create a new session and let the user type their first prompt in it.
    private func createAndNavigateToSession() {
        guard let sync = appState.syncManager else { return }
        isCreatingSession = true
        do {
            try sync.createSession(projectId: project.id, initialPrompt: nil)
            AnalyticsManager.shared.capture("mobile_session_created")
        } catch {
            print("Failed to create session: \(error)")
        }
        // The session will appear in the list via GRDB observation when the server responds.
        // Reset the creating state after a short delay.
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            isCreatingSession = false
        }
    }
}

struct SessionRow: View {
    let session: Session
    var voiceFocusedSessionId: String? = nil

    var body: some View {
        HStack(spacing: 8) {
            // Unread indicator
            Circle()
                .fill(NimbalystColors.primary)
                .frame(width: 8, height: 8)
                .opacity(session.hasUnread ? 1 : 0)

            VStack(alignment: .leading, spacing: 4) {
                Text(session.titleDecrypted ?? "Untitled Session")
                    .font(.body)
                    .fontWeight(session.hasUnread ? .semibold : .regular)
                    .lineLimit(1)

                HStack(spacing: 8) {
                    if let provider = session.provider {
                        ProviderBadge(provider: provider)
                    }

                    if let mode = session.mode {
                        Text(mode)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }

                    Text(RelativeTimestamp.format(epochMs: session.updatedAt))
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }

            Spacer()

            HStack(spacing: 6) {
                // Voice focus indicator
                if voiceFocusedSessionId == session.id {
                    Image(systemName: "mic.fill")
                        .font(.caption2)
                        .foregroundStyle(NimbalystColors.primary)
                }

                // Context usage
                if let pct = session.contextUsagePercent {
                    ContextUsageBadge(percent: pct)
                }

                // Status indicators - pending prompt takes priority (it's actionable)
                if session.hasQueuedPrompts {
                    Image(systemName: "clock.fill")
                        .foregroundStyle(.orange)
                        .font(.caption)
                } else if session.isExecuting {
                    ProgressView()
                        .controlSize(.small)
                }
            }
        }
        .padding(.vertical, 4)
    }
}

/// Badge showing the AI provider name with appropriate color.
struct ProviderBadge: View {
    let provider: String

    var body: some View {
        Text(displayName)
            .font(.caption2)
            .fontWeight(.medium)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(badgeColor.opacity(0.15))
            .foregroundStyle(badgeColor)
            .clipShape(Capsule())
    }

    private var displayName: String {
        switch provider.lowercased() {
        case "claude-code": return "Claude Code"
        case "claude": return "Claude"
        case "openai": return "OpenAI"
        case "lm-studio": return "LM Studio"
        default: return provider
        }
    }

    private var badgeColor: Color {
        switch provider.lowercased() {
        case "claude-code", "claude": return NimbalystColors.primary
        case "openai": return .green
        case "lm-studio": return .purple
        default: return .gray
        }
    }
}

/// Compact context usage indicator showing percentage with color coding.
struct ContextUsageBadge: View {
    let percent: Int

    var body: some View {
        Text("\(percent)%")
            .font(.caption2)
            .fontWeight(.medium)
            .monospacedDigit()
            .foregroundStyle(badgeColor)
    }

    private var badgeColor: Color {
        if percent >= 90 {
            return NimbalystColors.error
        } else if percent >= 70 {
            return NimbalystColors.warning
        } else {
            return NimbalystColors.textFaint
        }
    }
}
