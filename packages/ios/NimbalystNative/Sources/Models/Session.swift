import Foundation
import GRDB

/// A session represents an AI conversation within a project.
public struct Session: Codable, Identifiable, Hashable, Sendable {
    public var id: String
    public var projectId: String
    public var titleEncrypted: String?
    public var titleIv: String?
    public var titleDecrypted: String?
    public var provider: String?
    public var model: String?
    public var mode: String?          // "agent" | "planning"
    /// Structural type: "session" (normal), "workstream" (parent container), "blitz" (quick task)
    public var sessionType: String?
    public var isExecuting: Bool
    public var hasQueuedPrompts: Bool
    public var contextTokens: Int?
    public var contextWindow: Int?
    public var createdAt: Int
    public var updatedAt: Int
    public var lastSyncedSeq: Int
    public var lastReadAt: Int?
    public var lastMessageAt: Int?

    /// Context usage as a percentage (0-100), or nil if no context info available.
    public var contextUsagePercent: Int? {
        guard let tokens = contextTokens, let window = contextWindow, window > 0 else {
            return nil
        }
        return min(100, Int(Double(tokens) / Double(window) * 100))
    }

    /// Whether this session has unread messages (a message arrived after the last read).
    public var hasUnread: Bool {
        guard let messageAt = lastMessageAt, messageAt > 0 else { return false }
        guard let readAt = lastReadAt else { return true }
        return messageAt > readAt
    }

    public init(
        id: String,
        projectId: String,
        titleEncrypted: String? = nil,
        titleIv: String? = nil,
        titleDecrypted: String? = nil,
        provider: String? = nil,
        model: String? = nil,
        mode: String? = nil,
        sessionType: String? = nil,
        isExecuting: Bool = false,
        hasQueuedPrompts: Bool = false,
        contextTokens: Int? = nil,
        contextWindow: Int? = nil,
        createdAt: Int = Int(Date().timeIntervalSince1970 * 1000),
        updatedAt: Int = Int(Date().timeIntervalSince1970 * 1000),
        lastSyncedSeq: Int = 0,
        lastReadAt: Int? = nil,
        lastMessageAt: Int? = nil
    ) {
        self.id = id
        self.projectId = projectId
        self.titleEncrypted = titleEncrypted
        self.titleIv = titleIv
        self.titleDecrypted = titleDecrypted
        self.provider = provider
        self.model = model
        self.mode = mode
        self.sessionType = sessionType
        self.isExecuting = isExecuting
        self.hasQueuedPrompts = hasQueuedPrompts
        self.contextTokens = contextTokens
        self.contextWindow = contextWindow
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.lastSyncedSeq = lastSyncedSeq
        self.lastReadAt = lastReadAt
        self.lastMessageAt = lastMessageAt
    }
}

// MARK: - GRDB Conformance

extension Session: FetchableRecord, PersistableRecord {
    public static let databaseTableName = "sessions"

    public enum Columns: String, ColumnExpression {
        case id, projectId, titleEncrypted, titleIv, titleDecrypted
        case provider, model, mode, sessionType, isExecuting, hasQueuedPrompts
        case contextTokens, contextWindow
        case createdAt, updatedAt, lastSyncedSeq
        case lastReadAt, lastMessageAt
    }

    /// Association to parent project.
    static let project = belongsTo(Project.self)

    /// Association to child messages.
    static let messages = hasMany(Message.self)
}
