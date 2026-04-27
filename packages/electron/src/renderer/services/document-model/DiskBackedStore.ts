/**
 * DiskBackedStore - File system backing store for DocumentModel.
 *
 * Reads/writes files via the Electron IPC bridge (window.electronAPI).
 * Subscribes to file-watcher events for external change notifications.
 */

import { store } from '@nimbalyst/runtime/store';
import type { DocumentBackingStore, ExternalChangeCallback, ExternalChangeInfo } from './types';
import {
  fileChangedOnDiskAtomFamily,
  historyPendingTagCreatedAtomFamily,
} from '../../store/atoms/fileWatch';

export class DiskBackedStore implements DocumentBackingStore {
  private readonly filePath: string;
  private changeCallbacks = new Set<ExternalChangeCallback>();
  private ipcCleanup: (() => void) | null = null;

  /**
   * Timestamps of recent saves made through this store.
   * Used to suppress echo events from the file watcher
   * (our own saves come back as external changes).
   */
  private recentSaveTimestamps = new Set<number>();

  constructor(filePath: string) {
    this.filePath = filePath;
    this.setupFileWatcher();
  }

  async load(): Promise<string | ArrayBuffer> {
    const result = await window.electronAPI.readFileContent(this.filePath);
    if (!result || !result.success) {
      throw new Error(`Failed to load file: ${this.filePath}`);
    }
    return result.content;
  }

  async save(content: string | ArrayBuffer): Promise<void> {
    const now = Date.now();
    this.recentSaveTimestamps.add(now);

    // Clean up old timestamps after 5s
    setTimeout(() => {
      this.recentSaveTimestamps.delete(now);
    }, 5000);

    if (typeof content === 'string') {
      await window.electronAPI.saveFile(content, this.filePath);
    } else {
      // Binary content -- convert ArrayBuffer to base64 for IPC
      // This path is for future binary file support
      const uint8 = new Uint8Array(content);
      const binary = Array.from(uint8, (b) => String.fromCharCode(b)).join('');
      const base64 = btoa(binary);
      await window.electronAPI.saveFile(base64, this.filePath);
    }
  }

  onExternalChange(callback: ExternalChangeCallback): () => void {
    this.changeCallbacks.add(callback);
    return () => {
      this.changeCallbacks.delete(callback);
    };
  }

  /**
   * Subscribe to per-path atoms updated by store/listeners/fileChangeListeners.ts.
   *
   * Two events surface as separate atom families:
   * - `file-changed-on-disk`: normal file watcher events
   * - `history:pending-tag-created`: signals echo suppression should be
   *    bypassed to check for AI edits
   */
  private setupFileWatcher(): void {
    const emitChange = async (checkPendingTags: boolean) => {
      let content: string;
      try {
        const result = await window.electronAPI.readFileContent(this.filePath);
        if (!result || !result.success) return;
        content = result.content ?? '';
      } catch (err) {
        console.error('[DiskBackedStore] Failed to read file after change:', err);
        return;
      }

      const info: ExternalChangeInfo = {
        content,
        timestamp: Date.now(),
        checkPendingTags,
      };

      for (const cb of this.changeCallbacks) {
        try {
          cb(info);
        } catch (err) {
          console.error('[DiskBackedStore] Error in external change callback:', err);
        }
      }
    };

    const fileChangeAtom = fileChangedOnDiskAtomFamily(this.filePath);
    const tagCreatedAtom = historyPendingTagCreatedAtomFamily(this.filePath);
    const initialFileChangeVersion = store.get(fileChangeAtom);
    const initialTagCreatedVersion = store.get(tagCreatedAtom);

    const unsubFileChange = store.sub(fileChangeAtom, () => {
      if (store.get(fileChangeAtom) === initialFileChangeVersion) return;
      void emitChange(false);
    });
    const unsubTagCreated = store.sub(tagCreatedAtom, () => {
      if (store.get(tagCreatedAtom) === initialTagCreatedVersion) return;
      void emitChange(true);
    });

    this.ipcCleanup = () => {
      unsubFileChange();
      unsubTagCreated();
    };
  }

  /**
   * Clean up IPC listeners. Called when the DocumentModel is disposed.
   */
  dispose(): void {
    this.ipcCleanup?.();
    this.ipcCleanup = null;
    this.changeCallbacks.clear();
    this.recentSaveTimestamps.clear();
  }
}
