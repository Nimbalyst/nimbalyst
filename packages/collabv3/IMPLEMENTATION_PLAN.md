# CollabV3: Cloudflare Durable Objects Multi-Device AI Session Sync

> **Status:** Implementation complete. Phases 1-4 done, Phase 5 (production deployment) in progress.

## Executive Summary

This document outlines the implementation plan for the `collabv3` package that replaces the existing Y.js + D1 BLOB sync system with a Cloudflare Durable Objects architecture. The key driver for this change is the D1 2MB BLOB limit, which becomes a critical constraint for long AI sessions with tool calls and attachments.

### Current Architecture Problems

1. **D1 2MB BLOB Limit**: Y.js document state is stored as a single BLOB in D1. Long AI sessions easily exceed this.
2. **CRDT Tombstone Bloat**: Even with append-only semantics, Y.js state vectors grow over time
3. **Memory Pressure**: Loading entire Y.Doc state for each session connection is expensive
4. **No Message-Level Granularity**: Can't query or paginate individual messages server-side

### Implemented Solution

Move from "Y.js CRDT everywhere" to a **hybrid approach**:
- **Durable Object (DO) SQLite** for per-session message storage (normalized rows, not BLOBs)
- **Native Cloudflare Workers** with DO WebSocket hibernation for real-time sync
- **D1** only for global indexes (session list, project list) - small metadata, not content
- **R2** for large attachments and optional archival (future)

> **Note:** We chose native Cloudflare Durable Objects over PartyKit for better hibernation support and direct SQLite access.

---

## 1. Architecture Overview (As Implemented)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Client Layer                                   │
├─────────────────────────────────────────────────────────────────────────┤
│  Electron App                          │  Capacitor Mobile App          │
│  - PGLite local store (source of truth)│  - In-memory (no persistence)  │
│  - CollabV3Sync provider               │  - CollabV3SyncContext         │
│  - AES-GCM E2E encryption              │  - AES-GCM E2E encryption      │
└──────────────────┬─────────────────────┴──────────────────┬─────────────┘
                   │                                         │
                   │  Native WebSocket                       │
                   │  ws://localhost:8790/sync/{roomId}      │
                   ▼                                         ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        Cloudflare Edge                                   │
├─────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────────┐                                                   │
│  │   Edge Worker    │  - Auth validation (token in URL params)          │
│  │  (src/index.ts)  │  - Route to SessionRoom or IndexRoom              │
│  └────────┬─────────┘  - REST: /health, /api/sessions, /api/bulk-index  │
│           │                                                              │
│           │ Room routing by ID pattern                                   │
│           ▼                                                              │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │              Durable Objects (Native Cloudflare)                  │  │
│  ├──────────────────────────────────────────────────────────────────┤  │
│  │  SessionRoom DO               │  IndexRoom DO                     │  │
│  │  - ID: user:{uid}:session:{s} │  - ID: user:{uid}:index           │  │
│  │  - DO SQLite for messages     │  - DO SQLite for session list     │  │
│  │  - Hibernating WebSockets     │  - Hibernating WebSockets         │  │
│  │  - Message deduplication      │  - Project filtering              │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌──────────────────┐   ┌──────────────────┐                            │
│  │       D1         │   │       R2         │   (KV not used yet)        │
│  │  (Not yet used)  │   │  (Future)        │                            │
│  │                  │   │  - Attachments   │                            │
│  └──────────────────┘   └──────────────────┘                            │
└─────────────────────────────────────────────────────────────────────────┘
```

**Key Implementation Files:**
- `packages/collabv3/src/index.ts` - Worker entry point, routing, REST API
- `packages/collabv3/src/SessionRoom.ts` - Per-session message storage and sync
- `packages/collabv3/src/IndexRoom.ts` - Per-user session index
- `packages/collabv3/src/types.ts` - Shared protocol types
- `packages/runtime/src/sync/CollabV3Sync.ts` - Electron client provider
- `packages/capacitor/src/contexts/CollabV3SyncContext.tsx` - Mobile client

---

## 2. Key Design Decisions

### 2.1 Drop Y.js for Message Storage, Keep for Metadata Sync

**Why Y.js was problematic for messages:**
- Messages are append-only by nature
- Y.Array creates tombstones even when only appending (less severe, but still grows)
- Full state vector must be loaded on connection
- Can't query individual messages

**New approach:**
- Messages stored as rows in DO SQLite (per-session)
- Simple append-only protocol over WebSocket
- Pagination and cursor-based sync
- Metadata (title, mode, settings) can optionally use a small Y.Map if bidirectional editing is needed

### 2.2 DO SQLite vs D1 for Messages

Each Durable Object has its own SQLite database (up to 10GB storage, 128MB memory).

**DO SQLite advantages:**
- No 2MB BLOB limit - rows are individually stored
- Fast local queries (no network to D1)
- Transactions are ACID within the DO
- Natural isolation per session

**D1 stays for:**
- Cross-session queries (list all sessions for user)
- User/auth metadata
- Analytics aggregates

### 2.3 E2E Encryption Strategy

Messages are encrypted client-side before transmission:

```
Client                          Server (DO)
  │                                │
  ├── encrypt(message) ────────────►│
  │                                │ store encrypted blob
  │                                │
  │◄────── encrypted blob ──────────┤
  │                                │
  └── decrypt(blob) = message      │
```

**Key Hierarchy (future-proofed for orgs):**

```
                    ┌─────────────────────┐
                    │  Org Master Key     │  (future: shared across org members)
                    │  (OMK)              │
                    └──────────┬──────────┘
                               │ HKDF
                    ┌──────────▼──────────┐
                    │  User Master Key    │  (derived from passphrase or stored in keychain)
                    │  (UMK)              │
                    └──────────┬──────────┘
                               │ HKDF + project_id
          ┌────────────────────┼────────────────────┐
          ▼                    ▼                    ▼
    ┌───────────┐        ┌───────────┐        ┌───────────┐
    │ Project A │        │ Project B │        │ Project C │
    │    Key    │        │    Key    │        │    Key    │
    └───────────┘        └───────────┘        └───────────┘
```

**Current (single-user):**
- User Master Key (UMK) derived from passphrase or stored in OS keychain
- Per-project keys derived via HKDF: `project_key = HKDF(UMK, project_id)`
- All content encrypted with project key

**Future (org/team):**
- Org Master Key (OMK) shared via key exchange with org members
- UMK = HKDF(OMK, user_id) for org-owned projects
- Personal projects still use personal UMK
- Room IDs include org prefix: `{orgId}:{userId}:{sessionId}`

Server stores opaque ciphertext. Metadata (timestamps, message IDs) remain plaintext for indexing.

### 2.4 Message Sync Protocol

Replace Y.js sync protocol with a simpler message-based protocol:

```typescript
// Client → Server
type ClientMessage =
  | { type: 'sync_request'; since_id?: string; since_ts?: number }
  | { type: 'append_message'; message: EncryptedMessage }
  | { type: 'update_metadata'; metadata: Partial<SessionMetadata> }

// Server → Client
type ServerMessage =
  | { type: 'sync_response'; messages: EncryptedMessage[]; has_more: boolean; cursor: string }
  | { type: 'message_broadcast'; message: EncryptedMessage; from_device?: string }
  | { type: 'metadata_broadcast'; metadata: Partial<SessionMetadata> }
  | { type: 'error'; code: string; message: string }
```

---

## 3. Data Models

### 3.1 DO SQLite Schema (per SessionRoom)

```sql
-- messages table (append-only)
CREATE TABLE messages (
  id TEXT PRIMARY KEY,                    -- ULID for ordering
  session_id TEXT NOT NULL,               -- Denormalized for safety
  sequence INTEGER NOT NULL,              -- Monotonic per session
  created_at INTEGER NOT NULL,            -- Unix timestamp ms
  source TEXT NOT NULL,                   -- 'user' | 'assistant' | 'tool' | 'system'
  direction TEXT NOT NULL,                -- 'input' | 'output'
  encrypted_content BLOB NOT NULL,        -- E2E encrypted message content
  content_hash TEXT,                      -- For deduplication
  metadata_json TEXT                      -- Unencrypted metadata (timestamps, tool names)
);

CREATE INDEX idx_messages_sequence ON messages(session_id, sequence);
CREATE INDEX idx_messages_created ON messages(created_at);

-- session_metadata table
CREATE TABLE session_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
```

### 3.2 DO SQLite Schema (IndexRoom)

```sql
-- session_index table
CREATE TABLE session_index (
  session_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT,
  provider TEXT,
  model TEXT,
  mode TEXT,
  message_count INTEGER DEFAULT 0,
  last_message_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_session_project ON session_index(project_id, updated_at DESC);
CREATE INDEX idx_session_updated ON session_index(updated_at DESC);

-- project_index table
CREATE TABLE project_index (
  project_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT,
  session_count INTEGER DEFAULT 0,
  last_activity_at INTEGER,
  sync_enabled INTEGER DEFAULT 1
);
```

### 3.3 D1 Schema (Global)

D1 is only used for cross-user queries and lightweight global state:

```sql
-- users table
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER
);

-- user_devices table (optional, for push notifications)
CREATE TABLE user_devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  device_type TEXT,         -- 'electron' | 'ios' | 'android'
  push_token TEXT,
  last_sync_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX idx_devices_user ON user_devices(user_id);
```

---

## 4. Room Types and Routing

### 4.1 Room ID Format

**Current (single-user):**
```
SessionRoom:  user:{userId}:session:{sessionId}
IndexRoom:    user:{userId}:index
ProjectsRoom: user:{userId}:projects
```

**Future (org-ready):**
```
SessionRoom:  org:{orgId}:user:{userId}:session:{sessionId}
IndexRoom:    org:{orgId}:user:{userId}:index
ProjectsRoom: org:{orgId}:projects                           # shared across org
OrgRoom:      org:{orgId}:index                              # org-wide session index
```

Using explicit prefixes (`user:`, `org:`, `session:`) makes the ID format extensible and self-documenting. For now, we implement only the single-user paths but the routing logic can easily expand.

### 4.2 SessionRoom DO

One per AI session. Responsibilities:
- Store messages in DO SQLite
- Broadcast new messages to connected clients
- Handle cursor-based sync for reconnecting clients
- Hibernate when idle, wake on connection

```typescript
// Pseudocode for SessionRoom
class SessionRoom implements Party.Server {
  private sql: DurableSQLite;
  private connections: Map<string, Party.Connection>;

  async onConnect(conn: Party.Connection) {
    // Authenticate from headers
    // Send initial sync if needed
    // Add to broadcast list
  }

  async onMessage(message: ClientMessage, conn: Party.Connection) {
    switch (message.type) {
      case 'sync_request':
        const messages = await this.getMessagesSince(message.since_id);
        conn.send({ type: 'sync_response', messages });
        break;

      case 'append_message':
        await this.appendMessage(message.message);
        this.broadcast({ type: 'message_broadcast', message: message.message }, conn);
        break;
    }
  }

  async onClose(conn: Party.Connection) {
    this.connections.delete(conn.id);
    // DO will hibernate if no connections after idle timeout
  }
}
```

### 4.3 IndexRoom DO

One per user. Responsibilities:
- Maintain session list for quick mobile startup
- Broadcast session list updates
- Filter by project

```typescript
class IndexRoom implements Party.Server {
  async updateSessionEntry(sessionId: string, metadata: SessionIndexEntry) {
    await this.sql.run(`
      INSERT OR REPLACE INTO session_index (session_id, project_id, title, ...)
      VALUES (?, ?, ?, ...)
    `, [sessionId, metadata.projectId, metadata.title, ...]);

    this.broadcast({ type: 'index_update', session: metadata });
  }

  async getSessionsForProject(projectId: string, cursor?: string) {
    // Return paginated session list
  }
}
```

---

## 5. Client Integration

### 5.1 Electron Client Changes

The Electron app remains the source of truth. Changes needed:

```typescript
// packages/runtime/src/sync/index.ts

export interface CollabV3Config {
  serverUrl: string;
  userId: string;
  authToken: string;
  encryptionKey: CryptoKey;
}

export function createCollabV3Provider(config: CollabV3Config): SyncProvider {
  // Replace Y.js provider with new WebSocket-based sync
  // Uses PartySocket for connection management
  return {
    connect(sessionId: string): Promise<void> { ... },
    disconnect(sessionId: string): void { ... },

    // Message sync
    appendMessage(sessionId: string, message: AgentMessage): Promise<void> { ... },
    onRemoteMessage(sessionId: string, callback: (message: AgentMessage) => void): () => void { ... },

    // Metadata sync
    updateMetadata(sessionId: string, metadata: Partial<SessionMetadata>): void { ... },
    onMetadataChange(sessionId: string, callback: (metadata: Partial<SessionMetadata>) => void): () => void { ... },
  };
}
```

### 5.2 Mobile Client Changes

The Capacitor app connects to the same rooms:

```typescript
// packages/capacitor/src/contexts/CollabV3Context.tsx

export function CollabV3Provider({ children }: { children: React.ReactNode }) {
  const [sessions, setSessions] = useState<SessionIndexEntry[]>([]);

  useEffect(() => {
    // Connect to IndexRoom for session list
    const indexSocket = new PartySocket({
      host: config.serverUrl,
      room: `${config.userId}:index`,
      // ...auth
    });

    indexSocket.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'sync_response') {
        setSessions(msg.sessions);
      }
    });
  }, [config]);

  // ...
}
```

---

## 6. Initial Sync Strategy

Since collabv2 was never deployed to production, there's no migration needed. The sync flow is straightforward:

### First-Time Sync (Electron → Cloud)

When a user enables sync for the first time:

1. **Bulk upload session index**: Read all sessions from PGLite, upload metadata to IndexRoom DO
2. **On-demand message sync**: Only sync messages when user opens a session (lazy)
3. **Incremental thereafter**: New messages sync in real-time as they're created

### Mobile First Launch

1. **Connect to IndexRoom**: Get full session list (metadata only, fast)
2. **Display session list**: User can browse immediately
3. **Sync messages on open**: When user taps a session, fetch messages from SessionRoom DO
4. **Cache locally**: Store in mobile SQLite for offline access

This approach means:
- No massive initial upload
- Mobile gets session list in <500ms
- Message content syncs lazily
- Works well for 3,000+ sessions

---

## 7. Implementation Status

### Phase 1: Infrastructure - COMPLETE

- [ ] Create `packages/collabv3` directory
- [ ] Set up Wrangler config with Cloudflare Workers (native DOs, not PartyKit)
- [ ] Implement SessionRoom DO with SQLite schema (`src/SessionRoom.ts`)
- [ ] Implement IndexRoom DO (`src/IndexRoom.ts`)
- [ ] Deploy to staging environment
- [ ] Write unit tests for protocol types (`test/types.test.ts`)

**Implementation Notes:**
- Used native Cloudflare Durable Objects with DO SQLite instead of PartyKit
- WebSocket handling via `state.acceptWebSocket()` with hibernation support
- Room ID format: `user:{userId}:session:{sessionId}` and `user:{userId}:index`
- REST API endpoints: `/health`, `/api/sessions`, `/api/session/{id}/status`, `/api/bulk-index`

### Phase 2: Sync Protocol - COMPLETE

- [x] Define TypeScript types for sync protocol (`src/types.ts`)
- [x] Implement client-side sync provider (`createCollabV3Sync` in `packages/runtime/src/sync/CollabV3Sync.ts`)
- [x] Implement cursor-based message sync with `since_seq` pagination
- [x] Add E2E encryption layer (AES-GCM with PBKDF2 key derivation)
- [ ] Integration tests (client <-> server) - manual testing done

**Protocol Messages Implemented:**
- `sync_request` / `sync_response` - Initial sync with cursor pagination
- `append_message` / `message_broadcast` - Real-time message sync
- `update_metadata` / `metadata_broadcast` - Session metadata updates
- `index_sync_request` / `index_sync_response` - Session list for mobile
- `index_update` / `index_broadcast` - Real-time index updates
- `delete_session` - Session deletion

**Encryption Implementation:**
- Client derives key via PBKDF2 from passphrase + userId salt (100K iterations, SHA-256)
- Messages encrypted with AES-GCM (12-byte IV)
- Base64 encoding for transmission (chunked encoding for payloads > 1KB)
- Both Electron and mobile use identical encryption/decryption routines

### Phase 3: Electron Integration - COMPLETE

- [ ] Add collabv3 backend option to sync settings (`packages/electron/src/main/utils/store.ts`)
- [ ] Wire up SyncManager to use collabv3 (`packages/electron/src/main/services/SyncManager.ts`)
- [x] Support encryption passphrase configuration
- [x] SyncPanel UI in GlobalSettings (`packages/electron/src/renderer/components/GlobalSettings/panels/SyncPanel.tsx`)
- [ ] Test multi-device sync with two Electron instances
- [ ] Handle offline/reconnection scenarios - visibility change reconnect implemented

**Config Schema:**
```typescript
sessionSync: {
  enabled: boolean;
  backend: 'collabv3' | 'yjs';  // 'collabv3' is default for new configs
  serverUrl: string;
  userId: string;
  authToken: string;
  encryptionPassphrase?: string;
  enabledProjects?: string[];
}
```

### Phase 4: Mobile Integration - COMPLETE

- [ ] Create CollabV3SyncContext (`packages/capacitor/src/contexts/CollabV3SyncContext.tsx`)
- [ ] Update SessionListScreen to use CollabV3 sync
- [x] Update SessionDetailScreen with full E2E encryption support
- [ ] Handle background/foreground transitions (visibility change reconnect)
- [x] Project filtering and selection
- [x] Message sending from mobile with encryption
- [x] Remove old Y.js-based SyncContext.tsx (deleted)

**Mobile Features:**
- Session list sync via IndexRoom WebSocket connection
- Session detail view with real-time message decryption
- AI message composition and sending with encryption
- Automatic reconnection on app resume (visibility change handler)
- Project-based session filtering with persistent selection
- Optimistic UI updates for sent messages

### Phase 5: Polish & Deploy - IN PROGRESS

- [ ] Production deployment to Cloudflare
- [ ] Monitoring and alerting setup
- [ ] End-user documentation for sync setup
- [ ] Performance testing with large session counts
- [ ] Error handling improvements for network failures
- [ ] Draft input sync via metadata (not yet implemented)

### Remaining Work

1. **Deployment**: Deploy collabv3 worker to Cloudflare production
2. **Testing**: Multi-device sync testing (Electron <-> Electron, Electron <-> Mobile)
3. **Draft Sync**: Implement draft input sync via metadata for cross-device continuity
4. **Attachments**: R2 integration for large file attachments
5. **Cleanup**: Remove collabv2 package (legacy, never deployed)

---

## 8. Risk Analysis

### 8.1 DO SQLite Limits

- **Storage**: 10GB per DO (plenty for single session)
- **Memory**: 128MB (must be careful with large result sets)
- **Connections**: No hard limit, but memory scales with connections

**Mitigation**: Implement pagination, limit concurrent connections per session

### 8.2 Data Loss During Migration

**Mitigation**:
- Backup collabv2 state before migration
- Run migration in dry-run mode first
- Keep collabv2 read-only until verified

### 8.3 E2E Encryption Key Management

**Mitigation**:
- Store derived keys in OS keychain
- Implement key rotation protocol
- Server can't read content anyway (encrypted)

---

## 9. Cost Model

### Cloudflare Pricing (as of 2025)

| Resource | Free Tier | Paid |
| --- | --- | --- |
| Workers requests | 100K/day | $0.30/million |
| DO requests | 1M/month | $0.15/million |
| DO duration | 400K GB-s/month | $12.50/million GB-s |
| DO storage | 1GB | $0.20/GB/month |
| D1 reads | 5M/day | $0.001/million |
| D1 writes | 100K/day | $1.00/million |
| D1 storage | 5GB | $0.75/GB/month |

### Power User Example (your usage)

**Profile:**
- 3,000 sessions across 15 projects
- ~50 messages/session average = 150K total messages
- ~2KB/message encrypted = 300MB total storage
- Active sessions: ~10/day (sessions you actually open)
- Devices: 2 (Electron + mobile)

**Durable Objects:**

| Component | Count | Activity |
| --- | --- | --- |
| SessionRoom DOs | 3,000 | ~10 active/day, rest hibernated |
| IndexRoom DO | 1 | Always active when app open |
| ProjectsRoom DO | 1 | Low activity |

**Monthly estimates:**

```
DO Requests (per month):
- App opens: 30 days × 5 opens/day = 150 opens
- Each open syncs index + ~3 sessions = 600 DO requests
- Active session messages: 10 sessions × 20 msgs × 30 days = 6,000 requests
- Broadcasts to 2 devices: 6,000 × 2 = 12,000 requests
- Total: ~20,000 DO requests/month
- Cost: FREE (under 1M/month)

DO Duration (GB-seconds):
- Active DO time: 10 sessions × 5 min × 30 days = 1,500 minutes = 25 hours
- Memory per active DO: ~10MB (small SQLite + connections)
- GB-seconds: 25 hours × 3600s × 0.01GB = 900 GB-s
- Cost: FREE (under 400K GB-s)

DO Storage:
- 3,000 sessions × 100KB average = 300MB
- Cost: FREE (under 1GB)

D1 (global index only):
- Reads: 150 opens × 1 query = 150 reads/month
- Writes: Session creates/updates: ~100/month
- Storage: <1MB (just metadata)
- Cost: FREE
```

**Power user total: \~$0/month** (well within free tier)

### Scaling to 10K Users

**Assumptions:**
- Average user: 100 sessions, 20 messages/session
- Power users (10%): 500 sessions, 50 messages/session
- Active sessions/day: 5 average, 20 power users

**Monthly at 10K users:**

```
DO Requests:
- 9,000 average users × 5 opens × 30 days × 4 requests = 5.4M
- 1,000 power users × 10 opens × 30 days × 10 requests = 3M
- Total: ~8.5M requests
- Cost: (8.5M - 1M free) × $0.15/M = $1.13

DO Duration:
- Assume 50K active DO-hours/month across all users
- At 20MB average: 50K × 3600 × 0.02 = 3.6M GB-s
- Cost: (3.6M - 400K free) × $12.50/M = $40

DO Storage:
- 10K users × 200 sessions avg × 50KB = 100GB
- Cost: (100GB - 1GB free) × $0.20 = $20

D1:
- Minimal, stays in free tier

Total at 10K users: ~$60/month = $0.006/user/month
```

### Cost Comparison with CollabV2

CollabV2 (Y.js + D1 BLOBs) would hit issues before cost:
- D1 2MB BLOB limit forces complex sharding
- Y.js state vectors grow unbounded
- More complex = more requests = higher cost

CollabV3 is both cheaper AND removes the scaling ceiling.

## 10. Success Metrics

| Metric | Target | Measurement |
| --- | --- | --- |
| Message sync latency | < 200ms P95 | Instrumentation |
| Mobile startup (session list) | < 500ms | Instrumentation |
| Failed syncs | < 0.1% | Error tracking |
| DO memory usage | < 64MB typical | Cloudflare dashboard |
| Cost per active user | < $0.01/month | Cloudflare billing |

---

## 10. Resolved Questions

1. **Key Rotation**: Not a priority. E2E encryption keys live only on clients. If a user needs to change their key, they'd re-encrypt locally - but this is an edge case we can defer.

2. **Search**: Client-side only. Both Electron (PGLite) and mobile (SQLite) have full message content locally. Server never has plaintext.

3. **Offline Support**: Already solved. PGLite on Electron is the source of truth. Mobile currently runs in-memory only (no offline persistence). The sync layer keeps them in sync - if offline, Electron uses local store until connection resumes.

3. **Conflict Resolution**: Implemented as last-write-wins with timestamps. Metadata updates (`update_metadata`) use the latest `updated_at` timestamp. Message appends use deduplication by content hash to avoid duplicates.

5. **PartyKit vs Native DOs**: Decided to use native Cloudflare Durable Objects instead of PartyKit for better hibernation support and direct SQLite access.

## 11. Remaining Open Questions

1. **Attachments**: Should large attachments (images, files) go through DO or direct to R2? Likely R2 with pre-signed URLs and references stored in messages.

2. **Mobile Offline**: Currently mobile has no local persistence - messages are fetched from server on each session open. Consider adding SQLite-based caching for offline viewing.

5. **Draft Sync**: Draft input content could be synced via metadata to enable cross-device draft continuity. Not yet implemented.

---

## Appendix A: Protocol Message Schemas (As Implemented)

See `packages/collabv3/src/types.ts` for the complete protocol definitions.

```typescript
// Client -> Server messages
type SessionClientMessage =
  | { type: 'sync_request'; since_seq?: number }
  | { type: 'append_message'; message: SyncMessage }
  | { type: 'update_metadata'; metadata: Partial<SessionMetadata> }
  | { type: 'delete_session' }

// Server -> Client messages
type SessionServerMessage =
  | { type: 'sync_response'; messages: SyncMessage[]; has_more: boolean; next_cursor?: number }
  | { type: 'message_broadcast'; message: SyncMessage; from_connection?: string }
  | { type: 'metadata_broadcast'; metadata: Partial<SessionMetadata> }
  | { type: 'error'; code: string; message: string }

// Encrypted message format (what server stores)
interface SyncMessage {
  id: string;                    // UUID
  seq: number;                   // Monotonic sequence number
  role: 'user' | 'assistant';
  encrypted_content: string;     // Base64 of AES-GCM encrypted JSON
  content_hash: string;          // SHA-256 hash for deduplication
  created_at: number;            // Unix timestamp ms
}

// Index room messages
type IndexClientMessage =
  | { type: 'index_sync_request' }
  | { type: 'index_update'; session: SessionIndexEntry }
  | { type: 'delete_session'; session_id: string }

type IndexServerMessage =
  | { type: 'index_sync_response'; sessions: SessionIndexEntry[] }
  | { type: 'index_broadcast'; session: SessionIndexEntry }
  | { type: 'session_deleted'; session_id: string }
```

---

## Appendix B: Local Development Setup

Wrangler includes Miniflare for local development - no separate install needed.

```bash
# Install dependencies
cd packages/collabv3
npm install

# Start local dev server (Miniflare runs automatically via wrangler dev)
npm run dev

# Server runs at:
# - HTTP: http://localhost:8790
# - WebSocket: ws://localhost:8790/sync/user:{userId}:session:{sessionId}
# - WebSocket: ws://localhost:8790/sync/user:{userId}:index

# D1 and DO SQLite are automatically provisioned locally by Wrangler
# No manual database creation needed for local dev
```

**Testing locally:**
```bash
# Run unit tests
npm test

# Type check
npm run typecheck

# Deploy to staging
npm run deploy:staging
```

---

## Appendix C: References

- [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/)
- [Cloudflare Durable Objects SQLite](https://developers.cloudflare.com/durable-objects/api/storage-api/#sql-in-durable-objects)
- [Cloudflare WebSocket Hibernation](https://developers.cloudflare.com/durable-objects/examples/websocket-hibernation-server/)
- [Web Crypto API (PBKDF2, AES-GCM)](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto)
- [Legacy: collabv2 package](../packages/collabv2/) - Never deployed, to be removed
