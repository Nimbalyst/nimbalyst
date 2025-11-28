/**
 * Y.js Sync Protocol Types
 *
 * Based on the Y.js sync protocol and Cloudflare Workers/Durable Objects types.
 */

// Y.js Protocol Message Types
export enum MessageType {
  Sync = 0,
  Awareness = 1,
  Auth = 2,
  QueryAwareness = 3,
}

export enum SyncMessageType {
  SyncStep1 = 0, // Client sends state vector
  SyncStep2 = 1, // Server responds with diff
  Update = 2, // Incremental update broadcast
}

// Client connection info stored in Durable Object
export interface ClientInfo {
  userId: string | null;
  sessionId: string | null;
  synced: boolean;
  connectedAt: number;
}

// Environment bindings for Cloudflare Worker
export interface Env {
  DB: D1Database;
  YJSSYNC: DurableObjectNamespace;
  // Optional: for auth validation
  JWT_SECRET?: string;
}

// D1 Database row types
export interface YDocSnapshot {
  id: string; // Durable Object ID (userId:sessionId)
  user_id: string;
  session_id: string;
  state_vector: ArrayBuffer; // Encrypted Y.Doc binary state
  created_at: number; // Unix timestamp (milliseconds)
  updated_at: number;
}

export interface SessionMetadata {
  session_id: string;
  user_id: string;
  title: string | null;
  created_at: number;
  last_synced_at: number;
  device_count: number;
  snapshot_count: number;
}

// WebSocket message result
export interface SyncResult {
  response: Uint8Array | null;
  broadcast: Uint8Array | null;
  dirty: boolean;
}

// Persistence configuration
export interface PersistenceConfig {
  snapshotIntervalMs: number; // Time between snapshots (default: 5 min)
  snapshotSizeThreshold: number; // Size threshold for snapshot (default: 1MB)
}

// Auth validation result
export interface AuthResult {
  valid: boolean;
  userId?: string;
  error?: string;
}
