import { app } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import * as zlib from 'zlib';
import { promisify } from 'util';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

export type SnapshotType = 'auto-save' | 'manual' | 'ai-diff' | 'pre-apply';

export interface SnapshotMetadata {
  timestamp: string;
  type: SnapshotType;
  description?: string;
  baseMarkdownHash: string;
  stats?: {
    additions?: number;
    deletions?: number;
    nodeCount?: number;
  };
}

export interface Snapshot {
  timestamp: string;
  type: SnapshotType;
  size: number;
  baseMarkdownHash: string;
  metadata?: SnapshotMetadata;
}

export interface Manifest {
  filePath: string;
  created: string;
  lastAccessed: string;
  snapshots: Snapshot[];
}

export class HistoryManager {
  private historyDir: string;
  private maxSnapshots = 50;
  private maxAgeDays = 30;

  constructor() {
    this.historyDir = path.join(app.getPath('userData'), 'history');
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.historyDir, { recursive: true });
    await this.cleanup();
  }

  private getFileHash(filePath: string): string {
    return crypto
      .createHash('sha256')
      .update(filePath)
      .digest('hex')
      .substring(0, 16);
  }

  private getFilePaths(filePath: string) {
    const hash = this.getFileHash(filePath);
    const fileDir = path.join(this.historyDir, hash);
    return {
      dir: fileDir,
      manifest: path.join(fileDir, 'manifest.json'),
      snapshotsDir: path.join(fileDir, 'snapshots'),
    };
  }

  async createSnapshot(
    filePath: string,
    state: string,
    type: SnapshotType,
    description?: string
  ): Promise<void> {
    const paths = this.getFilePaths(filePath);
    const timestamp = new Date().toISOString();
    
    // Ensure directories exist
    await fs.mkdir(paths.snapshotsDir, { recursive: true });

    // Compress the state
    const compressed = await gzip(Buffer.from(state, 'utf-8'));
    
    // Calculate markdown hash
    const baseMarkdownHash = crypto
      .createHash('sha256')
      .update(state)
      .digest('hex');

    // Save snapshot
    const snapshotPath = path.join(paths.snapshotsDir, `${timestamp}.lexical.gz`);
    await fs.writeFile(snapshotPath, compressed);

    // Save metadata
    const metadata: SnapshotMetadata = {
      timestamp,
      type,
      description,
      baseMarkdownHash,
    };
    
    const metaPath = path.join(paths.snapshotsDir, `${timestamp}.meta.json`);
    await fs.writeFile(metaPath, JSON.stringify(metadata, null, 2));

    // Update manifest
    await this.updateManifest(filePath, {
      timestamp,
      type,
      size: compressed.length,
      baseMarkdownHash,
    });

    // Cleanup old snapshots
    await this.cleanupFile(filePath);
  }

  private async updateManifest(filePath: string, snapshot: Snapshot): Promise<void> {
    const paths = this.getFilePaths(filePath);
    let manifest: Manifest;

    try {
      const data = await fs.readFile(paths.manifest, 'utf-8');
      manifest = JSON.parse(data);
      manifest.lastAccessed = new Date().toISOString();
    } catch {
      manifest = {
        filePath,
        created: new Date().toISOString(),
        lastAccessed: new Date().toISOString(),
        snapshots: [],
      };
    }

    manifest.snapshots.push(snapshot);
    manifest.snapshots.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    await fs.writeFile(paths.manifest, JSON.stringify(manifest, null, 2));
  }

  async listSnapshots(filePath: string): Promise<Snapshot[]> {
    const paths = this.getFilePaths(filePath);
    
    try {
      const data = await fs.readFile(paths.manifest, 'utf-8');
      const manifest: Manifest = JSON.parse(data);
      return manifest.snapshots;
    } catch {
      return [];
    }
  }

  async loadSnapshot(filePath: string, timestamp: string): Promise<string> {
    const paths = this.getFilePaths(filePath);
    const snapshotPath = path.join(paths.snapshotsDir, `${timestamp}.lexical.gz`);
    
    const compressed = await fs.readFile(snapshotPath);
    const decompressed = await gunzip(compressed);
    return decompressed.toString('utf-8');
  }

  async deleteSnapshot(filePath: string, timestamp: string): Promise<void> {
    const paths = this.getFilePaths(filePath);
    const snapshotPath = path.join(paths.snapshotsDir, `${timestamp}.lexical.gz`);
    const metaPath = path.join(paths.snapshotsDir, `${timestamp}.meta.json`);
    
    await fs.unlink(snapshotPath).catch(() => {});
    await fs.unlink(metaPath).catch(() => {});
    
    // Update manifest
    try {
      const data = await fs.readFile(paths.manifest, 'utf-8');
      const manifest: Manifest = JSON.parse(data);
      manifest.snapshots = manifest.snapshots.filter(s => s.timestamp !== timestamp);
      await fs.writeFile(paths.manifest, JSON.stringify(manifest, null, 2));
    } catch {
      // Ignore if manifest doesn't exist
    }
  }

  private async cleanupFile(filePath: string): Promise<void> {
    const paths = this.getFilePaths(filePath);
    
    try {
      const data = await fs.readFile(paths.manifest, 'utf-8');
      const manifest: Manifest = JSON.parse(data);
      
      const now = Date.now();
      const maxAge = this.maxAgeDays * 24 * 60 * 60 * 1000;
      
      // Filter snapshots to keep
      let snapshots = manifest.snapshots.filter((s, index) => {
        const age = now - new Date(s.timestamp).getTime();
        // Keep if: within max count, within max age, or in top 5
        return index < this.maxSnapshots && (age < maxAge || index < 5);
      });
      
      // Delete removed snapshots
      const toDelete = manifest.snapshots.filter(s => !snapshots.includes(s));
      for (const snapshot of toDelete) {
        await this.deleteSnapshot(filePath, snapshot.timestamp);
      }
      
      manifest.snapshots = snapshots;
      await fs.writeFile(paths.manifest, JSON.stringify(manifest, null, 2));
    } catch {
      // Ignore if manifest doesn't exist
    }
  }

  async cleanup(): Promise<void> {
    try {
      const dirs = await fs.readdir(this.historyDir);
      
      for (const dir of dirs) {
        const manifestPath = path.join(this.historyDir, dir, 'manifest.json');
        
        try {
          const data = await fs.readFile(manifestPath, 'utf-8');
          const manifest: Manifest = JSON.parse(data);
          await this.cleanupFile(manifest.filePath);
        } catch {
          // Skip invalid directories
        }
      }
    } catch {
      // History directory doesn't exist yet
    }
  }
}