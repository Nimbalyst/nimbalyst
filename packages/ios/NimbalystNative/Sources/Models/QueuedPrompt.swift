import Foundation
import GRDB

/// A prompt queued by the user on mobile, waiting to be sent to the desktop.
public struct QueuedPrompt: Codable, Identifiable, Hashable {
    public var id: String
    public var sessionId: String
    public var promptTextEncrypted: String
    public var iv: String
    public var createdAt: Int
    public var sentAt: Int?  // nil until acknowledged by desktop
}

// MARK: - GRDB Conformance

extension QueuedPrompt: FetchableRecord, PersistableRecord {
    public static let databaseTableName = "queuedPrompts"

    public enum Columns: String, ColumnExpression {
        case id, sessionId, promptTextEncrypted, iv, createdAt, sentAt
    }

    /// Association to parent session.
    static let session = belongsTo(Session.self)
}
