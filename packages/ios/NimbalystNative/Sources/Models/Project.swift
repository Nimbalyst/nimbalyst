import Foundation
import GRDB

/// A project represents a workspace path synced from the desktop app.
public struct Project: Codable, Identifiable, Hashable, Sendable {
    /// Workspace path (e.g., "/Users/ghinkle/sources/stravu-editor")
    public var id: String
    /// Display name (last path component)
    public var name: String
    public var sessionCount: Int
    public var lastUpdatedAt: Int?
    public var sortOrder: Int

    public init(id: String, name: String, sessionCount: Int = 0, lastUpdatedAt: Int? = nil, sortOrder: Int = 0) {
        self.id = id
        self.name = name
        self.sessionCount = sessionCount
        self.lastUpdatedAt = lastUpdatedAt
        self.sortOrder = sortOrder
    }

    /// Create a Project from a workspace path, deriving the name from the last path component.
    public static func from(workspacePath: String) -> Project {
        let name = (workspacePath as NSString).lastPathComponent
        return Project(id: workspacePath, name: name)
    }
}

// MARK: - GRDB Conformance

extension Project: FetchableRecord, PersistableRecord {
    public static let databaseTableName = "projects"

    public enum Columns: String, ColumnExpression {
        case id, name, sessionCount, lastUpdatedAt, sortOrder
    }
}
