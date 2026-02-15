import SwiftUI
import Combine
import GRDB

/// Displays the list of projects (workspace paths) synced from the desktop app.
/// Uses GRDB ValueObservation for reactive updates when the database changes.
struct ProjectListView: View {
    @EnvironmentObject var appState: AppState
    @State private var projects: [Project] = []
    @State private var cancellable: AnyDatabaseCancellable?

    var body: some View {
        List(projects) { project in
            NavigationLink(value: project) {
                ProjectRow(project: project)
            }
        }
        #if os(iOS)
        .listStyle(.insetGrouped)
        #endif
        .navigationTitle("Projects")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.large)
        #endif
        .refreshable {
            appState.requestSync()
            // Give a moment for the sync response to arrive and update SQLite
            try? await Task.sleep(nanoseconds: 500_000_000)
        }
        .navigationDestination(for: Project.self) { project in
            SessionListView(project: project)
        }
        .overlay {
            if projects.isEmpty {
                VStack(spacing: 12) {
                    Image(systemName: "folder")
                        .font(.system(size: 48))
                        .foregroundStyle(.secondary)
                    Text("No Projects")
                        .font(.title3)
                    Text("Projects will appear here once synced from your Mac.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
                .padding()
            }
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                connectionIndicator
            }
            #if os(iOS)
            ToolbarItem(placement: .topBarLeading) {
                NavigationLink(value: "settings") {
                    Image(systemName: "gearshape")
                }
            }
            #else
            ToolbarItem {
                NavigationLink(value: "settings") {
                    Image(systemName: "gearshape")
                }
            }
            #endif
        }
        .navigationDestination(for: String.self) { value in
            if value == "settings" {
                SettingsView()
            }
        }
        .onAppear {
            startObserving()
        }
        .onReceive(appState.$databaseManager) { db in
            if db != nil && cancellable == nil {
                startObserving()
            }
        }
        .onDisappear {
            cancellable?.cancel()
        }
    }

    private var isDesktopConnected: Bool {
        appState.syncManager?.connectedDevices.contains(where: { $0.type == "desktop" }) ?? false
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

        let observation = ValueObservation.tracking { db in
            try Project
                .order(Project.Columns.lastUpdatedAt.desc, Project.Columns.name)
                .fetchAll(db)
        }

        cancellable = observation.start(
            in: db.writer,
            onError: { error in
                print("Project observation error: \(error)")
            },
            onChange: { newProjects in
                withAnimation {
                    projects = newProjects
                }
            }
        )
    }
}

struct ProjectRow: View {
    let project: Project

    var body: some View {
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
            if let lastUpdated = project.lastUpdatedAt {
                Text(RelativeTimestamp.format(epochMs: lastUpdated))
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(.vertical, 4)
    }
}
