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

/// A unified item in the session list: either a standalone session or a workstream/worktree group.
enum SessionListItem: Identifiable {
    case session(Session)
    case group(WorkstreamGroup)

    var id: String {
        switch self {
        case .session(let s): return s.id
        case .group(let g): return "group-\(g.parent.id)"
        }
    }

    var effectiveUpdatedAt: Int {
        switch self {
        case .session(let s): return s.updatedAt
        case .group(let g): return g.latestUpdate
        }
    }
}

struct GroupedSessionItems: Identifiable {
    let period: TimePeriod
    let items: [SessionListItem]
    var id: String { period.rawValue }
}

/// Legacy type alias for macOS SessionListView variant in NimbalystApp.swift.
struct GroupedSessions: Identifiable {
    let period: TimePeriod
    let sessions: [Session]
    var id: String { period.rawValue }
}

// MARK: - Workstream Group Model

struct WorkstreamGroup: Identifiable {
    let parent: Session
    let children: [Session]
    /// Whether this group represents a git worktree (vs a workstream).
    let isWorktree: Bool
    var id: String { parent.id }

    /// Most recent update across all children (or parent if no children).
    var latestUpdate: Int {
        children.map(\.updatedAt).max() ?? parent.updatedAt
    }
}

// MARK: - Aggregated Status

enum AggregatedStatus {
    case waitingForInput  // hasPendingPrompt + isExecuting
    case processing       // isExecuting
    case pendingPrompt    // hasQueuedPrompts
    case unread           // hasUnread
    case idle
}

func computeAggregatedStatus(_ children: [Session]) -> AggregatedStatus {
    if children.contains(where: { $0.hasQueuedPrompts && $0.isExecuting }) {
        return .waitingForInput
    }
    if children.contains(where: { $0.isExecuting }) {
        return .processing
    }
    if children.contains(where: { $0.hasQueuedPrompts }) {
        return .pendingPrompt
    }
    if children.contains(where: { $0.hasUnread }) {
        return .unread
    }
    return .idle
}

// MARK: - Phase Filter

enum PhaseFilter: String, CaseIterable {
    case all = "All"
    case active = "Active"
    case planning = "Planning"
    case complete = "Done"

    /// Whether a session matches this filter.
    func matches(_ session: Session) -> Bool {
        switch self {
        case .all: return true
        case .active: return session.phase == "implementing" || session.phase == "validating"
        case .planning: return session.phase == "planning" || session.phase == "backlog"
        case .complete: return session.phase == "complete"
        }
    }

    /// Whether a workstream group matches (any child matches, or the group has no phase info).
    func matchesGroup(_ group: WorkstreamGroup) -> Bool {
        if self == .all { return true }
        // Show workstream if any child matches the filter
        return group.children.contains { matches($0) }
    }
}

/// Displays sessions for a given project with status badges, pull-to-refresh,
/// search, hierarchical workstream grouping, and reactive GRDB observation.
public struct SessionListView: View {
    @EnvironmentObject var appState: AppState
    public let project: Project

    @State private var sessions: [Session] = []
    @State private var cancellable: AnyDatabaseCancellable?
    @State private var expandedWorkstreams: Set<String> = []

    public init(project: Project) {
        self.project = project
    }
    @State private var searchText = ""
    @State private var isCreatingSession = false
    @State private var phaseFilter: PhaseFilter = .all

    private var voiceFocusedSessionId: String? {
        #if os(iOS)
        return appState.voiceAgent?.activeSessionId
        #else
        return nil
        #endif
    }

    private var filteredSessions: [Session] {
        var result = sessions

        if !searchText.isEmpty {
            result = result.filter { session in
                session.titleDecrypted?.localizedCaseInsensitiveContains(searchText) == true
            }
        }

        // Phase filter applies to standalone sessions only (workstream groups filter their children)
        // but we keep all sessions here and apply group-level filtering in the computed properties

        return result
    }

    /// Whether any sessions have phase data (controls visibility of the filter picker).
    private var hasPhaseData: Bool {
        sessions.contains { $0.phase != nil && !($0.phase?.isEmpty ?? true) }
    }

    // MARK: - Hierarchy Computation

    /// Workstream and worktree parent sessions with their children, sorted by most recent activity.
    private var workstreamGroups: [WorkstreamGroup] {
        // 1. Workstream groups (sessionType == "workstream" with parentSessionId children)
        let parentIds = Set(filteredSessions.filter { $0.sessionType == "workstream" }.map(\.id))
        let childrenByParent = Dictionary(grouping: filteredSessions.filter { session in
            if let pid = session.parentSessionId, parentIds.contains(pid) {
                return true
            }
            return false
        }) { $0.parentSessionId! }

        var groups = filteredSessions
            .filter { $0.sessionType == "workstream" }
            .map { parent in
                let children = (childrenByParent[parent.id] ?? [])
                    .sorted { $0.updatedAt > $1.updatedAt }
                return WorkstreamGroup(parent: parent, children: children, isWorktree: false)
            }

        // 2. Worktree groups (sessions with a worktreeId, not already in a workstream)
        // Even a single session with a worktreeId forms a worktree group (matching desktop behavior)
        let workstreamMemberIds = Set(parentIds.union(childrenByParent.values.flatMap { $0.map(\.id) }))
        let worktreeSessions = filteredSessions.filter { session in
            session.worktreeId != nil && !workstreamMemberIds.contains(session.id)
        }
        let sessionsByWorktree = Dictionary(grouping: worktreeSessions) { $0.worktreeId! }
        for (_, sessions) in sessionsByWorktree {
            let sorted = sessions.sorted { $0.createdAt < $1.createdAt }
            guard let parent = sorted.first else { continue }
            if sorted.count == 1 {
                // Single-session worktree: renders as direct NavigationLink
                groups.append(WorkstreamGroup(parent: parent, children: [], isWorktree: true))
            } else {
                // Multi-session worktree: ALL sessions are children (parent is just for group identity/header)
                let children = sorted.sorted { $0.updatedAt > $1.updatedAt }
                groups.append(WorkstreamGroup(parent: parent, children: children, isWorktree: true))
            }
        }

        groups.sort { $0.latestUpdate > $1.latestUpdate }

        // Apply phase filter: only show groups that have matching children
        if phaseFilter == .all { return groups }
        return groups.filter { phaseFilter.matchesGroup($0) }
    }

    /// IDs of all sessions that belong to a workstream or worktree group.
    private var groupedSessionIds: Set<String> {
        var ids = Set<String>()
        for group in workstreamGroups {
            ids.insert(group.parent.id)
            for child in group.children {
                ids.insert(child.id)
            }
        }
        return ids
    }

    /// Sessions that are standalone: not in any workstream or worktree group.
    private var standaloneSessions: [Session] {
        let grouped = groupedSessionIds
        return filteredSessions.filter { session in
            // Exclude sessions in groups
            if grouped.contains(session.id) { return false }
            // Exclude workstream parents (shouldn't happen, but safety)
            if session.sessionType == "workstream" { return false }
            // Apply phase filter
            if phaseFilter != .all && !phaseFilter.matches(session) { return false }
            return true
        }
    }

    /// All items (standalone sessions + workstream/worktree groups) interleaved by time period.
    private var allItemsGroupedByPeriod: [GroupedSessionItems] {
        var items: [SessionListItem] = []

        // Add standalone sessions
        for session in standaloneSessions {
            items.append(.session(session))
        }

        // Add workstream/worktree groups
        for group in workstreamGroups {
            items.append(.group(group))
        }

        // Group by time period, sorted by most recent within each period
        let byPeriod = Dictionary(grouping: items) { item in
            TimePeriod.classify(epochMs: item.effectiveUpdatedAt)
        }
        return TimePeriod.allCases.compactMap { period in
            guard let periodItems = byPeriod[period], !periodItems.isEmpty else { return nil }
            let sorted = periodItems.sorted { $0.effectiveUpdatedAt > $1.effectiveUpdatedAt }
            return GroupedSessionItems(period: period, items: sorted)
        }
    }

    /// All workstream parents for context menu "Move to Workstream" submenu.
    private var workstreamParents: [Session] {
        filteredSessions.filter { $0.sessionType == "workstream" }
    }

    public var body: some View {
        List {
            // Phase filter - only show when sessions have phase data
            if hasPhaseData {
                Picker("Filter", selection: $phaseFilter) {
                    ForEach(PhaseFilter.allCases, id: \.self) { filter in
                        Text(filter.rawValue).tag(filter)
                    }
                }
                .pickerStyle(.segmented)
                .listRowSeparator(.hidden)
                .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
            }

            // All items interleaved by time period
            ForEach(allItemsGroupedByPeriod) { periodGroup in
                Section(periodGroup.period.rawValue) {
                    ForEach(periodGroup.items) { item in
                        sessionListItemView(item)
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
                    creationMenu
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
            loadExpandedState()
            appState.configureVoiceAgent(forProject: project.id)
        }
        .onDisappear {
            cancellable?.cancel()
        }
    }

    // MARK: - Creation Menu

    private var creationMenu: some View {
        Menu {
            Button {
                createAndNavigateToSession()
            } label: {
                Label("New Session", systemImage: "bubble.left")
            }

            Button {
                createWorktree()
            } label: {
                Label("New Worktree", systemImage: "arrow.triangle.branch")
            }

            Button {
                createWorkstream()
            } label: {
                Label("New Workstream", systemImage: "folder.badge.plus")
            }
        } label: {
            if isCreatingSession {
                ProgressView()
                    .controlSize(.small)
            } else {
                Image(systemName: "plus")
            }
        } primaryAction: {
            createAndNavigateToSession()
        }
        .disabled(isCreatingSession)
    }

    // MARK: - Session List Item View

    @ViewBuilder
    private func sessionListItemView(_ item: SessionListItem) -> some View {
        switch item {
        case .group(let group):
            WorkstreamSection(
                group: group,
                isExpanded: Binding(
                    get: { expandedWorkstreams.contains(group.parent.id) },
                    set: { newValue in
                        if newValue {
                            expandedWorkstreams.insert(group.parent.id)
                        } else {
                            expandedWorkstreams.remove(group.parent.id)
                        }
                        saveExpandedState()
                    }
                ),
                voiceFocusedSessionId: voiceFocusedSessionId
            )
            .contextMenu {
                groupContextMenu(for: group)
            }
        case .session(let session):
            NavigationLink(value: session) {
                SessionRow(
                    session: session,
                    voiceFocusedSessionId: voiceFocusedSessionId
                )
            }
            .contextMenu {
                standaloneContextMenu(for: session)
            }
        }
    }

    // MARK: - Context Menu for Standalone Sessions

    @ViewBuilder
    private func standaloneContextMenu(for session: Session) -> some View {
        Button {
            convertToWorkstream(session: session)
        } label: {
            Label("Start Workstream", systemImage: "folder.badge.plus")
        }

        if !workstreamParents.isEmpty {
            Menu("Move to Workstream") {
                ForEach(workstreamParents) { ws in
                    Button(ws.titleDecrypted ?? "Workstream") {
                        reparentSession(sessionId: session.id, newParentId: ws.id)
                    }
                }
            }
        }

        Divider()

        Button(role: .destructive) {
            deleteSession(session)
        } label: {
            Label("Delete", systemImage: "trash")
        }
    }

    // MARK: - Context Menu for Workstream/Worktree Groups

    @ViewBuilder
    private func groupContextMenu(for group: WorkstreamGroup) -> some View {
        Button {
            createChildSession(parentId: group.parent.id)
        } label: {
            Label("Add Session", systemImage: "plus.bubble")
        }

        Divider()

        Button(role: .destructive) {
            deleteSession(group.parent)
        } label: {
            Label("Delete", systemImage: "trash")
        }
    }

    // MARK: - Connection Indicator

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

    // MARK: - GRDB Observation

    private func startObserving() {
        guard let db = appState.databaseManager else { return }

        let projectId = project.id
        let observation = ValueObservation.tracking { db in
            // Fetch ALL sessions for this project, including workstream parents.
            // The view separates them into groups vs standalone display.
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

    // MARK: - Expand/Collapse Persistence

    private var expandedStateKey: String {
        "expandedWorkstreams_\(project.id)"
    }

    private func loadExpandedState() {
        if let data = UserDefaults.standard.data(forKey: expandedStateKey),
           let ids = try? JSONDecoder().decode(Set<String>.self, from: data) {
            expandedWorkstreams = ids
        }
    }

    private func saveExpandedState() {
        if let data = try? JSONEncoder().encode(expandedWorkstreams) {
            UserDefaults.standard.set(data, forKey: expandedStateKey)
        }
    }

    // MARK: - Actions

    private func deleteSession(_ session: Session) {
        guard let db = appState.databaseManager else { return }
        do {
            try db.deleteSession(session.id)
            try db.refreshSessionCount(forProject: project.id)
        } catch {
            print("Failed to delete session: \(error)")
        }
    }

    /// Create a new standalone session.
    private func createAndNavigateToSession() {
        guard let sync = appState.syncManager else { return }
        isCreatingSession = true
        do {
            try sync.createSession(projectId: project.id, initialPrompt: nil)
            AnalyticsManager.shared.capture("mobile_session_created")
        } catch {
            print("Failed to create session: \(error)")
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            isCreatingSession = false
        }
    }

    /// Create a new workstream parent session.
    private func createWorkstream() {
        guard let sync = appState.syncManager else { return }
        isCreatingSession = true
        do {
            try sync.createSession(
                projectId: project.id,
                initialPrompt: nil,
                sessionType: "workstream"
            )
            AnalyticsManager.shared.capture("mobile_workstream_created")
        } catch {
            print("Failed to create workstream: \(error)")
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            isCreatingSession = false
        }
    }

    /// Create a child session within a workstream.
    private func createChildSession(parentId: String) {
        guard let sync = appState.syncManager else { return }
        do {
            try sync.createSession(
                projectId: project.id,
                initialPrompt: nil,
                parentSessionId: parentId
            )
            AnalyticsManager.shared.capture("mobile_child_session_created")
            // Auto-expand the parent workstream
            expandedWorkstreams.insert(parentId)
            saveExpandedState()
        } catch {
            print("Failed to create child session: \(error)")
        }
    }

    /// Move a standalone session into a workstream.
    private func reparentSession(sessionId: String, newParentId: String) {
        guard let sync = appState.syncManager else { return }
        do {
            try sync.updateSessionParent(sessionId: sessionId, parentSessionId: newParentId)
            // Auto-expand the target workstream
            expandedWorkstreams.insert(newParentId)
            saveExpandedState()
        } catch {
            print("Failed to reparent session: \(error)")
        }
    }

    /// Convert a standalone session into a workstream.
    /// Creates a workstream parent and reparents the session under it.
    /// Since session creation is async (via WebSocket), we watch for the new workstream
    /// to appear and then reparent the original session under it.
    private func convertToWorkstream(session: Session) {
        guard let sync = appState.syncManager else { return }
        do {
            // Snapshot current workstream IDs so we can detect the new one
            let existingIds = Set(sessions.filter { $0.sessionType == "workstream" }.map(\.id))

            try sync.createSession(
                projectId: project.id,
                initialPrompt: nil,
                sessionType: "workstream"
            )
            AnalyticsManager.shared.capture("mobile_convert_to_workstream")

            // Watch for the new workstream to appear (created async by desktop),
            // then reparent the original session under it.
            Task {
                let sessionId = session.id
                for _ in 0..<20 { // Poll for up to ~10s
                    try await Task.sleep(nanoseconds: 500_000_000)
                    let newWorkstream = sessions.first { s in
                        s.sessionType == "workstream" && !existingIds.contains(s.id)
                    }
                    if let ws = newWorkstream {
                        try sync.updateSessionParent(sessionId: sessionId, parentSessionId: ws.id)
                        await MainActor.run {
                            expandedWorkstreams.insert(ws.id)
                            saveExpandedState()
                        }
                        return
                    }
                }
            }
        } catch {
            print("Failed to convert to workstream: \(error)")
        }
    }

    /// Request the desktop to create a new git worktree.
    private func createWorktree() {
        guard let sync = appState.syncManager else { return }
        isCreatingSession = true
        do {
            try sync.createWorktree(projectId: project.id)
            AnalyticsManager.shared.capture("mobile_worktree_created")
        } catch {
            print("Failed to create worktree: \(error)")
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            isCreatingSession = false
        }
    }
}

// MARK: - WorkstreamSection

struct WorkstreamSection: View {
    let group: WorkstreamGroup
    @Binding var isExpanded: Bool
    var voiceFocusedSessionId: String?

    var body: some View {
        Group {
            if group.children.isEmpty {
                // Single-session worktree: show header as a navigable link to the session
                NavigationLink(value: group.parent) {
                    WorkstreamHeader(
                        title: group.parent.titleDecrypted ?? (group.isWorktree ? "Worktree" : "Workstream"),
                        childCount: 0,
                        status: computeAggregatedStatus([group.parent]),
                        isWorktree: group.isWorktree
                    )
                }
            } else {
                DisclosureGroup(isExpanded: $isExpanded) {
                    ForEach(group.children) { child in
                        NavigationLink(value: child) {
                            SessionRow(
                                session: child,
                                isChild: true,
                                voiceFocusedSessionId: voiceFocusedSessionId
                            )
                        }
                    }
                } label: {
                    WorkstreamHeader(
                        title: group.parent.titleDecrypted ?? (group.isWorktree ? "Worktree" : "Workstream"),
                        childCount: group.children.count,
                        status: computeAggregatedStatus(group.children),
                        isWorktree: group.isWorktree
                    )
                }
            }
        }
    }
}

// MARK: - WorkstreamHeader

struct WorkstreamHeader: View {
    let title: String
    let childCount: Int
    let status: AggregatedStatus
    var isWorktree: Bool = false

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: isWorktree ? "arrow.triangle.branch" : "folder.fill")
                .font(.system(size: 14))
                .foregroundStyle(isWorktree ? .orange : NimbalystColors.primary)

            Text(title)
                .font(.body)
                .fontWeight(.medium)
                .lineLimit(1)

            Text("\(childCount)")
                .font(.caption2)
                .fontWeight(.medium)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(Color.secondary.opacity(0.15))
                .clipShape(Capsule())

            Spacer()

            statusIndicator
        }
        .padding(.vertical, 4)
    }

    @ViewBuilder
    private var statusIndicator: some View {
        switch status {
        case .waitingForInput:
            Image(systemName: "exclamationmark.bubble.fill")
                .font(.caption)
                .foregroundStyle(.orange)
        case .processing:
            ProgressView()
                .controlSize(.small)
        case .pendingPrompt:
            Image(systemName: "clock.fill")
                .font(.caption)
                .foregroundStyle(.orange)
        case .unread:
            Circle()
                .fill(NimbalystColors.primary)
                .frame(width: 8, height: 8)
        case .idle:
            EmptyView()
        }
    }
}

// MARK: - Session Row

struct SessionRow: View {
    let session: Session
    var isChild: Bool = false
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
                    .font(isChild ? .callout : .body)
                    .fontWeight(session.hasUnread ? .semibold : .regular)
                    .lineLimit(1)

                HStack(spacing: 6) {
                    ProviderBadge(provider: session.provider, model: session.model)

                    if let phase = session.phase, !phase.isEmpty {
                        PhaseBadge(phase: phase)
                    }
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

                Text(RelativeTimestamp.format(epochMs: session.updatedAt))
                    .font(.caption)
                    .foregroundStyle(.secondary)

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

// MARK: - Phase Badge

struct PhaseBadge: View {
    let phase: String

    var body: some View {
        Text(displayName)
            .font(.caption2)
            .fontWeight(.medium)
            .padding(.horizontal, 5)
            .padding(.vertical, 1)
            .background(phaseColor.opacity(0.15))
            .foregroundStyle(phaseColor)
            .clipShape(Capsule())
    }

    private var displayName: String {
        switch phase {
        case "backlog": return "Backlog"
        case "planning": return "Planning"
        case "implementing": return "Impl"
        case "validating": return "Validating"
        case "complete": return "Done"
        default: return phase.capitalized
        }
    }

    private var phaseColor: Color {
        switch phase {
        case "backlog": return .gray
        case "planning": return .purple
        case "implementing": return .blue
        case "validating": return .orange
        case "complete": return .green
        default: return .gray
        }
    }
}

// MARK: - Tag Pill

struct TagPill: View {
    let tag: String

    var body: some View {
        Text(tag)
            .font(.system(size: 9))
            .padding(.horizontal, 4)
            .padding(.vertical, 1)
            .background(Color.secondary.opacity(0.12))
            .foregroundStyle(.secondary)
            .clipShape(Capsule())
    }
}

/// Badge showing the AI provider name with model info and appropriate color.
struct ProviderBadge: View {
    let provider: String?
    let model: String?

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
        let prov = provider?.lowercased() ?? ""

        if prov == "claude-code" {
            // Format like electron: "Claude Agent (Opus 4.6)"
            let variantLabel = claudeCodeVariantLabel
            return "Claude Agent (\(variantLabel))"
        }

        switch prov {
        case "claude": return "Claude"
        case "openai": return "OpenAI"
        case "lm-studio": return "LM Studio"
        default:
            if let provider = provider, !provider.isEmpty {
                return provider
            }
            return "AI"
        }
    }

    /// Extract Claude Code variant from model field and format as "Opus 4.6", "Sonnet 4.6", etc.
    private var claudeCodeVariantLabel: String {
        guard let model = model?.lowercased() else { return "Sonnet 4.6" }

        // Model can be "claude-code:opus", "claude-code:sonnet-1m", "opus", "sonnet", etc.
        let variant: String
        if model.contains(":") {
            variant = String(model.split(separator: ":").last ?? "sonnet")
        } else {
            variant = model
        }

        // Handle pinned Sonnet 4.5 1M
        if variant == "sonnet-4.5-1m" {
            return "Sonnet 4.5 (1M)"
        }

        // Strip suffixes like "-1m" for extended context
        let baseVariant = variant.split(separator: "-").first.map(String.init) ?? variant
        let isExtended = variant.contains("-1m")
        let suffix = isExtended ? " (1M)" : ""

        switch baseVariant {
        case "opus": return "Opus 4.6\(suffix)"
        case "sonnet": return "Sonnet 4.6\(suffix)"
        case "haiku": return "Haiku 3.5\(suffix)"
        default: return "Sonnet 4.6\(suffix)"
        }
    }

    private var badgeColor: Color {
        let prov = provider?.lowercased() ?? ""
        switch prov {
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
