import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import type { DocumentSyncStatus } from '../documentSyncTypes';
import { CollabLexicalProvider } from '../CollabLexicalProvider';

function createSyncProviderStub() {
  return {
    onAwarenessChange: vi.fn(() => () => {}),
    setLocalAwareness: vi.fn(),
    connect: vi.fn(async () => {}),
    getYDoc: vi.fn(() => new Y.Doc()),
  };
}

describe('CollabLexicalProvider', () => {
  it('fires sync immediately by default', () => {
    const syncProvider = createSyncProviderStub();
    const provider = new CollabLexicalProvider(syncProvider as any);
    const onSync = vi.fn();

    provider.on('sync', onSync);

    expect(onSync).toHaveBeenCalledTimes(1);
    expect(onSync).toHaveBeenCalledWith(true);
  });

  it('defers initial sync until connected when requested', () => {
    const syncProvider = createSyncProviderStub();
    const provider = new CollabLexicalProvider(syncProvider as any, {
      deferInitialSync: true,
    });
    const onSync = vi.fn();

    provider.on('sync', onSync);
    expect(onSync).not.toHaveBeenCalled();

    provider.handleStatusChange('syncing' as DocumentSyncStatus);
    expect(onSync).not.toHaveBeenCalled();

    provider.handleStatusChange('connected' as DocumentSyncStatus);
    expect(onSync).toHaveBeenCalledTimes(1);
    expect(onSync).toHaveBeenCalledWith(true);
  });
});
