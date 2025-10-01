/**
 * EditorPool - Manages multiple concurrent editor instances
 *
 * Implements LRU (Least Recently Used) eviction strategy to keep memory usage bounded
 * while preserving editor state for recently accessed files.
 */

import type { EditorInstance, EditorPoolConfig } from '../types/editor';
import { logger } from '../utils/logger';

const DEFAULT_CONFIG: EditorPoolConfig = {
  maxInstances: 10,
  preserveDirty: true,
};

export class EditorPool {
  private instances: Map<string, EditorInstance> = new Map();
  private config: EditorPoolConfig;

  constructor(config: Partial<EditorPoolConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    logger.ui.info('[EditorPool] Initialized with config:', this.config);
  }

  /**
   * Get an existing editor instance by file path
   */
  get(filePath: string): EditorInstance | undefined {
    const instance = this.instances.get(filePath);
    if (instance) {
      // Update last accessed time
      instance.lastAccessed = Date.now();
    }
    return instance;
  }

  /**
   * Check if an editor instance exists for a file path
   */
  has(filePath: string): boolean {
    return this.instances.has(filePath);
  }

  /**
   * Create a new editor instance
   */
  create(filePath: string, content: string = ''): EditorInstance {
    // Check if we need to evict
    if (this.instances.size >= this.config.maxInstances) {
      this.evictLRU();
    }

    const instance: EditorInstance = {
      filePath,
      editorRef: null,
      content,
      initialContent: content, // Initialize with same content (not dirty)
      isDirty: false,
      scrollPosition: 0,
      lastAccessed: Date.now(),
      isVisible: false,
      reloadVersion: 0,
    };

    this.instances.set(filePath, instance);
    logger.ui.info(`[EditorPool] Created editor instance for: ${filePath}`);

    this.config.onCreate?.(filePath);

    return instance;
  }

  /**
   * Update an existing editor instance
   */
  update(filePath: string, updates: Partial<EditorInstance>): void {
    const instance = this.instances.get(filePath);
    if (!instance) {
      logger.ui.warn(`[EditorPool] Attempted to update non-existent instance: ${filePath}`);
      return;
    }

    Object.assign(instance, updates, { lastAccessed: Date.now() });
  }

  /**
   * Destroy an editor instance
   */
  destroy(filePath: string): void {
    const instance = this.instances.get(filePath);
    if (instance) {
      logger.ui.info(`[EditorPool] Destroying editor instance: ${filePath}`);

      // Clean up autosave timer
      if (instance.autosaveTimer) {
        clearInterval(instance.autosaveTimer);
        instance.autosaveTimer = null;
      }

      // Clean up file watcher
      if (instance.fileWatcherCleanup) {
        instance.fileWatcherCleanup();
        instance.fileWatcherCleanup = null;
      }

      this.instances.delete(filePath);
    }
  }

  /**
   * Evict the least recently used editor instance
   * Skips dirty editors if preserveDirty is true
   */
  private evictLRU(): void {
    let oldestInstance: EditorInstance | null = null;
    let oldestPath: string | null = null;

    for (const [path, instance] of this.instances) {
      // Skip dirty editors if configured to preserve them
      if (this.config.preserveDirty && instance.isDirty) {
        continue;
      }

      // Skip visible editors (currently active tab)
      if (instance.isVisible) {
        continue;
      }

      if (!oldestInstance || instance.lastAccessed < oldestInstance.lastAccessed) {
        oldestInstance = instance;
        oldestPath = path;
      }
    }

    if (oldestPath && oldestInstance) {
      logger.ui.info(`[EditorPool] Evicting LRU editor: ${oldestPath}`);
      this.config.onEvict?.(oldestInstance);
      // Use destroy to clean up timers and watchers
      this.destroy(oldestPath);
    } else {
      logger.ui.warn('[EditorPool] Could not evict any editors (all dirty or visible)');
    }
  }

  /**
   * Get all editor instances
   */
  getAll(): Map<string, EditorInstance> {
    return new Map(this.instances);
  }

  /**
   * Get count of active instances
   */
  size(): number {
    return this.instances.size;
  }

  /**
   * Clear all instances
   */
  clear(): void {
    logger.ui.info('[EditorPool] Clearing all editor instances');
    this.instances.clear();
  }

  /**
   * Set an editor as visible (active tab)
   */
  setVisible(filePath: string, visible: boolean): void {
    const instance = this.instances.get(filePath);
    if (instance) {
      instance.isVisible = visible;
      instance.lastAccessed = Date.now();
    }
  }

  /**
   * Get memory usage statistics
   */
  getStats() {
    const stats = {
      total: this.instances.size,
      dirty: 0,
      visible: 0,
      maxInstances: this.config.maxInstances,
    };

    for (const instance of this.instances.values()) {
      if (instance.isDirty) stats.dirty++;
      if (instance.isVisible) stats.visible++;
    }

    return stats;
  }
}

// Singleton instance
let editorPoolInstance: EditorPool | null = null;

export function getEditorPool(config?: Partial<EditorPoolConfig>): EditorPool {
  if (!editorPoolInstance) {
    editorPoolInstance = new EditorPool(config);
    // Expose for debugging
    if (typeof window !== 'undefined') {
      (window as any).__editorPool__ = editorPoolInstance;
    }
  }
  return editorPoolInstance;
}

export function resetEditorPool(): void {
  editorPoolInstance = null;
}
