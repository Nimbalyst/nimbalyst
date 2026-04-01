/**
 * Tests for tracker sync integration in ElectronDocumentService.
 *
 * Verifies that all tracker mutation methods (create, update, archive, delete)
 * correctly call the TrackerSyncManager functions when sync is active.
 *
 * These tests caught the bug where deleteTrackerItem did NOT call unsyncTrackerItem,
 * meaning deletions were never propagated to other users.
 *
 * Mocks: database, TrackerSyncManager, fs
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

// Mock the database before importing ElectronDocumentService
const mockQuery = vi.fn();
vi.mock('../../database/PGLiteDatabaseWorker', () => ({
  database: {
    query: (...args: any[]) => mockQuery(...args),
  },
}));

// Mock TrackerSyncManager
const mockSyncTrackerItem = vi.fn();
const mockUnsyncTrackerItem = vi.fn();
const mockIsTrackerSyncActive = vi.fn();
vi.mock('../TrackerSyncManager', () => ({
  syncTrackerItem: (...args: any[]) => mockSyncTrackerItem(...args),
  unsyncTrackerItem: (...args: any[]) => mockUnsyncTrackerItem(...args),
  isTrackerSyncActive: (...args: any[]) => mockIsTrackerSyncActive(...args),
}));

import { ElectronDocumentService } from '../ElectronDocumentService';

const WORKSPACE = '/Users/test/my-project';

// ============================================================================
// Test helpers
// ============================================================================

function makeTrackerRow(overrides: Record<string, any> = {}) {
  return {
    id: 'bug-001',
    type: 'bug',
    data: JSON.stringify({
      title: 'Test bug',
      description: 'A test bug',
      status: 'to-do',
      priority: 'high',
      labels: [],
      linkedSessions: [],
      ...overrides.data,
    }),
    workspace: WORKSPACE,
    document_path: '',
    line_number: null,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    last_indexed: new Date().toISOString(),
    sync_status: 'synced',
    archived: false,
    archived_at: null,
    source: 'tracked',
    source_ref: null,
    ...overrides,
  };
}

// ============================================================================
// Setup / Teardown
// ============================================================================

let tempDir: string;
let service: ElectronDocumentService;

beforeEach(async () => {
  vi.clearAllMocks();
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tracker-sync-test-'));
  service = new ElectronDocumentService(tempDir);
});

afterEach(async () => {
  service?.destroy();
  await fs.rm(tempDir, { recursive: true, force: true });
});

// ============================================================================
// deleteTrackerItem sync integration
// ============================================================================

describe('deleteTrackerItem sync integration', () => {
  it('should call unsyncTrackerItem when sync is active', async () => {
    mockIsTrackerSyncActive.mockReturnValue(true);
    mockUnsyncTrackerItem.mockResolvedValue(undefined);

    // First query: lookup source/document_path for inline removal
    mockQuery.mockResolvedValueOnce({ rows: [{ source: 'tracked', document_path: '' }] });
    // Second query: DELETE
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await service.deleteTrackerItem('bug-001');

    expect(mockUnsyncTrackerItem).toHaveBeenCalledWith('bug-001', tempDir);
  });

  it('should NOT call unsyncTrackerItem when sync is not active', async () => {
    mockIsTrackerSyncActive.mockReturnValue(false);

    mockQuery.mockResolvedValueOnce({ rows: [{ source: 'tracked', document_path: '' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await service.deleteTrackerItem('bug-001');

    expect(mockUnsyncTrackerItem).not.toHaveBeenCalled();
  });

  it('should still delete locally even if sync fails', async () => {
    mockIsTrackerSyncActive.mockReturnValue(true);
    mockUnsyncTrackerItem.mockRejectedValue(new Error('Network error'));

    mockQuery.mockResolvedValueOnce({ rows: [{ source: 'tracked', document_path: '' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    // Should not throw
    await service.deleteTrackerItem('bug-001');

    // DB delete was called
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM tracker_items'),
      ['bug-001']
    );
  });

  it('should emit change event with removed ID', async () => {
    mockIsTrackerSyncActive.mockReturnValue(false);

    mockQuery.mockResolvedValueOnce({ rows: [{ source: 'tracked', document_path: '' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const changeEvents: any[] = [];
    service.watchTrackerItems((event) => changeEvents.push(event));

    await service.deleteTrackerItem('bug-002');

    expect(changeEvents).toHaveLength(1);
    expect(changeEvents[0].removed).toEqual(['bug-002']);
  });
});

// ============================================================================
// archiveTrackerItem sync integration
// ============================================================================

describe('archiveTrackerItem sync integration', () => {
  it('should call syncTrackerItem when archiving with sync active', async () => {
    mockIsTrackerSyncActive.mockReturnValue(true);
    mockSyncTrackerItem.mockResolvedValue(undefined);

    // Lookup row
    mockQuery.mockResolvedValueOnce({ rows: [makeTrackerRow({ source: 'tracked' })] });
    // UPDATE archived
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // SELECT after update
    mockQuery.mockResolvedValueOnce({ rows: [makeTrackerRow({ archived: true })] });

    await service.archiveTrackerItem('bug-001', true);

    expect(mockSyncTrackerItem).toHaveBeenCalled();
    const syncedItem = mockSyncTrackerItem.mock.calls[0][0];
    expect(syncedItem.id).toBe('bug-001');
  });

  it('should call syncTrackerItem when un-archiving with sync active', async () => {
    mockIsTrackerSyncActive.mockReturnValue(true);
    mockSyncTrackerItem.mockResolvedValue(undefined);

    mockQuery.mockResolvedValueOnce({ rows: [makeTrackerRow({ archived: true, source: 'tracked' })] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [makeTrackerRow({ archived: false })] });

    await service.archiveTrackerItem('bug-001', false);

    expect(mockSyncTrackerItem).toHaveBeenCalled();
  });

  it('should NOT call syncTrackerItem when sync is not active', async () => {
    mockIsTrackerSyncActive.mockReturnValue(false);

    mockQuery.mockResolvedValueOnce({ rows: [makeTrackerRow({ source: 'tracked' })] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [makeTrackerRow({ archived: true })] });

    await service.archiveTrackerItem('bug-001', true);

    expect(mockSyncTrackerItem).not.toHaveBeenCalled();
  });

  it('should still archive locally if sync fails', async () => {
    mockIsTrackerSyncActive.mockReturnValue(true);
    mockSyncTrackerItem.mockRejectedValue(new Error('Sync failed'));

    mockQuery.mockResolvedValueOnce({ rows: [makeTrackerRow({ source: 'tracked' })] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [makeTrackerRow({ archived: true })] });

    // Should not throw
    const item = await service.archiveTrackerItem('bug-001', true);
    expect(item).toBeDefined();
  });
});

// ============================================================================
// Inline item deletion (file system interaction)
// ============================================================================

describe('deleteTrackerItem inline items', () => {
  it('should handle ENOENT gracefully when inline source file is missing', async () => {
    mockIsTrackerSyncActive.mockReturnValue(false);

    // Item is inline with a document_path that doesn't exist
    mockQuery.mockResolvedValueOnce({
      rows: [{ source: 'inline', document_path: 'nonexistent.md' }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    // Should not throw
    await service.deleteTrackerItem('inline-001');

    // DB delete was still called
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM tracker_items'),
      ['inline-001']
    );
  });
});

// ============================================================================
// Change event watchers
// ============================================================================

describe('tracker change event watchers', () => {
  it('should notify watcher on delete', async () => {
    mockIsTrackerSyncActive.mockReturnValue(false);
    mockQuery.mockResolvedValueOnce({ rows: [{ source: 'tracked', document_path: '' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const events: any[] = [];
    service.watchTrackerItems((e) => events.push(e));

    await service.deleteTrackerItem('bug-003');

    expect(events).toHaveLength(1);
    expect(events[0].removed).toEqual(['bug-003']);
  });

  it('should notify watchers with updated item on archive', async () => {
    mockIsTrackerSyncActive.mockReturnValue(false);

    mockQuery.mockResolvedValueOnce({ rows: [makeTrackerRow({ source: 'tracked' })] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [makeTrackerRow({ archived: true })] });

    const events: any[] = [];
    service.watchTrackerItems((e) => events.push(e));

    await service.archiveTrackerItem('bug-001', true);

    expect(events).toHaveLength(1);
    expect(events[0].updated).toHaveLength(1);
    expect(events[0].updated[0].id).toBe('bug-001');
  });
});
