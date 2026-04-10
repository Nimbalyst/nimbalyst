import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DocumentModel } from '../DocumentModel';
import { DocumentModelRegistry } from '../DocumentModelRegistry';
import type { DocumentBackingStore, ExternalChangeCallback } from '../types';

function createMockStore(): DocumentBackingStore & { dispose: () => void } {
  return {
    load: vi.fn(async () => ''),
    save: vi.fn(async () => {}),
    onExternalChange: vi.fn(() => () => {}),
    dispose: vi.fn(),
  };
}

describe('DocumentModelRegistry', () => {
  beforeEach(() => {
    DocumentModelRegistry.clear();
    // Override factory to use mock stores
    DocumentModelRegistry.setModelFactory((filePath: string) => {
      return new DocumentModel(filePath, createMockStore(), {
        autosaveInterval: 0, // Disable for tests
        getPendingTags: async () => [],
        updateTagStatus: async () => {},
      });
    });
  });

  afterEach(() => {
    DocumentModelRegistry.clear();
    DocumentModelRegistry.setModelFactory(null);
  });

  it('creates a new model on first getOrCreate', () => {
    const { model, handle } = DocumentModelRegistry.getOrCreate('/test/a.md');
    expect(model).toBeInstanceOf(DocumentModel);
    expect(model.filePath).toBe('/test/a.md');
    expect(handle.id).toBeDefined();
    handle.detach();
  });

  it('reuses existing model on second getOrCreate', () => {
    const { model: m1, handle: h1 } = DocumentModelRegistry.getOrCreate('/test/a.md');
    const { model: m2, handle: h2 } = DocumentModelRegistry.getOrCreate('/test/a.md');
    expect(m1).toBe(m2);
    expect(m1.getAttachCount()).toBe(2);
    h1.detach();
    h2.detach();
  });

  it('normalizes paths (double slashes)', () => {
    const { model: m1, handle: h1 } = DocumentModelRegistry.getOrCreate('/test//a.md');
    const { model: m2, handle: h2 } = DocumentModelRegistry.getOrCreate('/test/a.md');
    expect(m1).toBe(m2);
    h1.detach();
    h2.detach();
  });

  it('disposes model when ref count reaches zero via release', () => {
    const { model, handle } = DocumentModelRegistry.getOrCreate('/test/a.md');
    expect(DocumentModelRegistry.has('/test/a.md')).toBe(true);

    DocumentModelRegistry.release('/test/a.md', handle);
    expect(DocumentModelRegistry.has('/test/a.md')).toBe(false);
  });

  it('does not dispose model if other refs remain', () => {
    const { handle: h1 } = DocumentModelRegistry.getOrCreate('/test/a.md');
    const { handle: h2 } = DocumentModelRegistry.getOrCreate('/test/a.md');

    DocumentModelRegistry.release('/test/a.md', h1);
    expect(DocumentModelRegistry.has('/test/a.md')).toBe(true);

    DocumentModelRegistry.release('/test/a.md', h2);
    expect(DocumentModelRegistry.has('/test/a.md')).toBe(false);
  });

  it('get() returns null for non-existent path', () => {
    expect(DocumentModelRegistry.get('/test/nope.md')).toBeNull();
  });

  it('get() returns model for existing path', () => {
    const { model, handle } = DocumentModelRegistry.getOrCreate('/test/a.md');
    expect(DocumentModelRegistry.get('/test/a.md')).toBe(model);
    handle.detach();
  });

  it('getRegisteredPaths returns all active paths', () => {
    const { handle: h1 } = DocumentModelRegistry.getOrCreate('/test/a.md');
    const { handle: h2 } = DocumentModelRegistry.getOrCreate('/test/b.md');

    const paths = DocumentModelRegistry.getRegisteredPaths();
    expect(paths).toContain('/test/a.md');
    expect(paths).toContain('/test/b.md');
    expect(paths).toHaveLength(2);

    h1.detach();
    h2.detach();
  });

  it('flushAll flushes all dirty models', async () => {
    const { model: m1, handle: h1 } = DocumentModelRegistry.getOrCreate('/test/a.md');
    const { model: m2, handle: h2 } = DocumentModelRegistry.getOrCreate('/test/b.md');

    const save1 = vi.fn();
    const save2 = vi.fn();
    h1.onSaveRequested(save1);
    h2.onSaveRequested(save2);

    h1.setDirty(true);
    // h2 is not dirty

    await DocumentModelRegistry.flushAll();

    expect(save1).toHaveBeenCalledTimes(1);
    expect(save2).not.toHaveBeenCalled();

    h1.detach();
    h2.detach();
  });

  it('clear() disposes all models', () => {
    const { handle: h1 } = DocumentModelRegistry.getOrCreate('/test/a.md');
    const { handle: h2 } = DocumentModelRegistry.getOrCreate('/test/b.md');

    DocumentModelRegistry.clear();
    expect(DocumentModelRegistry.getRegisteredPaths()).toHaveLength(0);
  });
});
