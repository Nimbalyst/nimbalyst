/**
 * AttachmentService - Handles chat attachment file operations
 * Manages image and document attachments for AI chat sessions
 */

import { promises as fs } from 'fs';
import { join, basename } from 'path';
import { createHash } from 'crypto';
import type { ChatAttachment } from '@nimbalyst/runtime';
import {AnalyticsService} from "./analytics/AnalyticsService.ts";

export interface AttachmentValidation {
  valid: boolean;
  error?: string;
}

/**
 * Convert workspace path to a safe directory name
 * e.g., /Users/ghinkle/sources/datamodellm -> -Users-ghinkle-sources-datamodellm
 */
function workspacePathToDir(workspacePath: string): string {
  return workspacePath.replace(/[\/\\:]/g, '-');
}

export class AttachmentService {
  private workspacePath: string;
  private attachmentsDir: string;
  private readonly analytics: AnalyticsService = AnalyticsService.getInstance();

  // Supported file types and their MIME types
  private static readonly SUPPORTED_TYPES: Record<string, string[]> = {
    image: [
      'image/png',
      'image/jpeg',
      'image/jpg',
      'image/gif',
      'image/webp'
    ],
    pdf: ['application/pdf'],
    document: [
      'text/plain',
      'text/markdown',
      'application/json',
      'text/csv'
    ]
  };

  // File size limits (in bytes)
  private static readonly MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
  private static readonly MAX_DOCUMENT_SIZE = 10 * 1024 * 1024; // 10MB

  constructor(workspacePath: string, userDataPath: string) {
    this.workspacePath = workspacePath;
    // Store attachments in app user data, organized by project
    // e.g., ~/Library/Application Support/@nimbalyst/electron/chat-attachments/-Users-ghinkle-sources-datamodellm/
    const workspaceDir = workspacePathToDir(workspacePath);
    this.attachmentsDir = join(userDataPath, 'chat-attachments', workspaceDir);
  }

  /**
   * Save an attachment file to app user data
   */
  async saveAttachment(
    fileBuffer: Buffer,
    originalName: string,
    mimeType: string,
    sessionId: string
  ): Promise<{ success: boolean; attachment?: ChatAttachment; error?: string }> {
    try {
      // Validate the file
      const validation = this.validateFile(fileBuffer.length, mimeType);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      // Ensure session directory exists
      const sessionDir = join(this.attachmentsDir, sessionId);
      await fs.mkdir(sessionDir, { recursive: true });

      // Generate unique filename
      const timestamp = Date.now();
      const sanitizedName = this.sanitizeFilename(originalName);
      const filename = `${timestamp}_${sanitizedName}`;
      const filepath = join(sessionDir, filename);

      // Write file to disk
      await fs.writeFile(filepath, fileBuffer);

      console.log('[AttachmentService] Saved attachment', {
        filename,
        size: fileBuffer.length,
        sessionId
      });

      // Determine attachment type (validated above, so always non-null)
      const type = this.getAttachmentType(mimeType)!;

      // Create attachment object
      const attachment: ChatAttachment = {
        id: this.generateId(filepath),
        filename: sanitizedName,
        filepath,
        mimeType,
        size: fileBuffer.length,
        type,
        addedAt: timestamp
      };

      this.analytics.sendEvent('add_attachment');
      return { success: true, attachment };
    } catch (error) {
      console.error('[AttachmentService] Failed to save attachment', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to save attachment'
      };
    }
  }

  /**
   * Delete an attachment file
   */
  async deleteAttachment(
    attachmentId: string,
    sessionId: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const sessionDir = join(this.attachmentsDir, sessionId);

      // Find the file that matches this attachment ID
      // (ID is based on file path hash)
      const files = await fs.readdir(sessionDir);

      for (const file of files) {
        const filepath = join(sessionDir, file);
        const id = this.generateId(filepath);

        if (id === attachmentId) {
          await fs.unlink(filepath);
          console.log('[AttachmentService] Deleted attachment', { attachmentId, sessionId });
          return { success: true };
        }
      }

      this.analytics.sendEvent('delete_attachment');
      return { success: false, error: 'Attachment not found' };
    } catch (error) {
      console.error('[AttachmentService] Failed to delete attachment', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete attachment'
      };
    }
  }

  /**
   * Validate file type and size
   */
  validateFile(fileSize: number, mimeType: string): AttachmentValidation {
    // Check MIME type
    const type = this.getAttachmentType(mimeType);
    if (!type) {
      return {
        valid: false,
        error: `Unsupported file type: ${mimeType}`
      };
    }

    // Check file size
    const maxSize = type === 'image'
      ? AttachmentService.MAX_IMAGE_SIZE
      : AttachmentService.MAX_DOCUMENT_SIZE;

    if (fileSize > maxSize) {
      const maxSizeMB = Math.round(maxSize / (1024 * 1024));
      return {
        valid: false,
        error: `File too large. Maximum size for ${type}s is ${maxSizeMB}MB`
      };
    }

    return { valid: true };
  }

  /**
   * Get attachment type from MIME type
   */
  private getAttachmentType(mimeType: string): 'image' | 'pdf' | 'document' | null {
    for (const [type, mimes] of Object.entries(AttachmentService.SUPPORTED_TYPES)) {
      if (mimes.includes(mimeType)) {
        return type as 'image' | 'pdf' | 'document';
      }
    }
    return null;
  }

  /**
   * Sanitize filename to prevent path traversal
   */
  private sanitizeFilename(filename: string): string {
    // Remove any path components
    const base = basename(filename);

    // Replace dangerous characters
    return base.replace(/[^a-zA-Z0-9._-]/g, '_');
  }

  /**
   * Generate a unique ID for an attachment based on its filepath
   */
  private generateId(filepath: string): string {
    return createHash('md5').update(filepath).digest('hex').substring(0, 16);
  }

  /**
   * Read attachment file as base64 (for sending to AI providers)
   */
  async readAttachmentAsBase64(filepath: string): Promise<{ success: boolean; data?: string; error?: string }> {
    try {
      const buffer = await fs.readFile(filepath);
      const base64 = buffer.toString('base64');
      return { success: true, data: base64 };
    } catch (error) {
      console.error('[AttachmentService] Failed to read attachment', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to read attachment'
      };
    }
  }

  /**
   * Clean up orphaned attachments (attachments for deleted sessions)
   */
  async cleanupOrphanedAttachments(validSessionIds: string[]): Promise<{ success: boolean; deletedCount: number }> {
    try {
      const sessionDirs = await fs.readdir(this.attachmentsDir);
      let deletedCount = 0;

      for (const sessionId of sessionDirs) {
        if (!validSessionIds.includes(sessionId)) {
          const sessionDir = join(this.attachmentsDir, sessionId);
          await fs.rm(sessionDir, { recursive: true, force: true });
          deletedCount++;
          console.log('[AttachmentService] Cleaned up orphaned session', { sessionId });
        }
      }

      return { success: true, deletedCount };
    } catch (error) {
      console.error('[AttachmentService] Cleanup failed', error);
      return { success: false, deletedCount: 0 };
    }
  }
}
