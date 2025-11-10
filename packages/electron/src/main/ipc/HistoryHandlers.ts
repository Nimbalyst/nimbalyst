import { ipcMain } from 'electron';
import { HistoryManager } from '../HistoryManager';

// Initialize history manager
const historyManager = new HistoryManager();

export async function registerHistoryHandlers() {
    // Initialize history manager
    await historyManager.initialize();

    // Create snapshot
    ipcMain.handle('history:create-snapshot', async (event, filePath: string, state: string, type: string, description?: string) => {
        try {
            await historyManager.createSnapshot(filePath, state, type as any, description);
        } catch (error) {
            console.error('[HistoryHandlers] Failed to create snapshot:', error);
            throw error;
        }
    });

    // List snapshots
    ipcMain.handle('history:list-snapshots', async (event, filePath: string) => {
        return await historyManager.listSnapshots(filePath);
    });

    // Load snapshot
    ipcMain.handle('history:load-snapshot', async (event, filePath: string, timestamp: string) => {
        return await historyManager.loadSnapshot(filePath, timestamp);
    });

    // Delete snapshot
    ipcMain.handle('history:delete-snapshot', async (event, filePath: string, timestamp: string) => {
        await historyManager.deleteSnapshot(filePath, timestamp);
    });

    // PHASE 4/5: Get pending AI edit tags
    ipcMain.handle('history:get-pending-tags', async (event, filePath?: string) => {
        return await historyManager.getPendingTags(filePath);
    });

    // PHASE 5: Create tag (for testing)
    ipcMain.handle('history:create-tag', async (event, filePath: string, tagId: string, content: string, sessionId: string, toolUseId: string) => {
        await historyManager.createTag(filePath, tagId, content, sessionId, toolUseId);
    });

    // PHASE 5: Get tag (for testing)
    ipcMain.handle('history:get-tag', async (event, filePath: string, tagId: string) => {
        return await historyManager.getTag(filePath, tagId);
    });

    // PHASE 5: Update tag status
    ipcMain.handle('history:update-tag-status', async (event, filePath: string, tagId: string, status: string) => {
        await historyManager.updateTagStatus(filePath, tagId, status as any);
    });

    // PHASE 5: Update tag content
    ipcMain.handle('history:update-tag-content', async (event, filePath: string, tagId: string, content: string) => {
        await historyManager.updateTagContent(filePath, tagId, content);
    });

    // Incremental approval tags
    ipcMain.handle('history:create-incremental-approval-tag', async (
        event,
        filePath: string,
        content: string,
        sessionId: string,
        metadata?: { acceptedGroups?: string[], rejectedGroups?: string[], remainingGroups?: string[] }
    ) => {
        await historyManager.createIncrementalApprovalTag(filePath, content, sessionId, metadata);
    });

    ipcMain.handle('history:get-diff-baseline', async (event, filePath: string) => {
        return await historyManager.getDiffBaseline(filePath);
    });

    // Debug helper: get all tags with full metadata
    ipcMain.handle('history:get-all-tags', async (event, filePath: string) => {
        const { database } = await import('../database/PGLiteDatabaseWorker');

        const result = await database.query(`
            SELECT metadata, timestamp
            FROM document_history
            WHERE file_path = $1
            ORDER BY timestamp DESC
        `, [filePath]);

        return result.rows.map((row: any) => {
            // Parse metadata if it's a string (PGLite returns JSONB as strings)
            const metadata = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
            return {
                metadata,
                timestamp: row.timestamp
            };
        });
    });

    // Mark all incremental-approval tags for a session as reviewed
    ipcMain.handle('history:mark-incremental-tags-reviewed', async (event, filePath: string, sessionId: string) => {
        const { database } = await import('../database/PGLiteDatabaseWorker');
        const now = Date.now();

        await database.query(`
            UPDATE document_history
            SET metadata = jsonb_set(
                  jsonb_set(metadata, '{status}', to_jsonb('reviewed'::text)),
                  '{updatedAt}', to_jsonb($1::bigint)
                )
            WHERE file_path = $2
              AND metadata->>'type' = 'incremental-approval'
              AND metadata->>'sessionId' = $3
        `, [now, filePath, sessionId]);
    });
}

export { historyManager };