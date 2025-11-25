import { ipcMain } from 'electron';
import { UsageAnalyticsService } from '../services/UsageAnalyticsService';
import { database } from '../database/PGLiteDatabaseWorker';

let analyticsService: UsageAnalyticsService | null = null;

export async function registerUsageAnalyticsHandlers() {
  // Initialize analytics service
  analyticsService = new UsageAnalyticsService(database);

  // Get total session count (all sessions, not just those with token data)
  ipcMain.handle('usage-analytics:get-all-session-count', async (event, workspaceId?: string) => {
    try {
      return await analyticsService!.getAllSessionCount(workspaceId);
    } catch (error) {
      console.error('[UsageAnalyticsHandlers] Failed to get all session count:', error);
      throw error;
    }
  });

  // Get overall token usage statistics
  ipcMain.handle('usage-analytics:get-overall-stats', async (event, workspaceId?: string) => {
    try {
      return await analyticsService!.getOverallTokenUsage(workspaceId);
    } catch (error) {
      console.error('[UsageAnalyticsHandlers] Failed to get overall stats:', error);
      throw error;
    }
  });

  // Get usage broken down by provider/model
  ipcMain.handle('usage-analytics:get-usage-by-provider', async (event, workspaceId?: string) => {
    try {
      return await analyticsService!.getUsageByProvider(workspaceId);
    } catch (error) {
      console.error('[UsageAnalyticsHandlers] Failed to get usage by provider:', error);
      throw error;
    }
  });

  // Get usage broken down by project
  ipcMain.handle('usage-analytics:get-usage-by-project', async () => {
    try {
      return await analyticsService!.getUsageByProject();
    } catch (error) {
      console.error('[UsageAnalyticsHandlers] Failed to get usage by project:', error);
      throw error;
    }
  });

  // Get time-series data for token usage
  ipcMain.handle('usage-analytics:get-time-series', async (
    event,
    startDate: number,
    endDate: number,
    granularity: 'hour' | 'day' | 'week' | 'month',
    workspaceId?: string
  ) => {
    try {
      return await analyticsService!.getTimeSeriesData(startDate, endDate, granularity, workspaceId);
    } catch (error) {
      console.error('[UsageAnalyticsHandlers] Failed to get time series data:', error);
      throw error;
    }
  });

  // Get activity heatmap (hour x day of week)
  ipcMain.handle('usage-analytics:get-activity-heatmap', async (
    event,
    workspaceId?: string,
    metric?: 'sessions' | 'messages' | 'edits',
    timezoneOffsetMinutes?: number
  ) => {
    try {
      return await analyticsService!.getActivityHeatmap(
        workspaceId,
        metric || 'messages',
        timezoneOffsetMinutes || 0
      );
    } catch (error) {
      console.error('[UsageAnalyticsHandlers] Failed to get activity heatmap:', error);
      throw error;
    }
  });

  // Get document edit statistics
  ipcMain.handle('usage-analytics:get-document-stats', async (event, workspaceId?: string) => {
    try {
      return await analyticsService!.getDocumentEditStats(workspaceId);
    } catch (error) {
      console.error('[UsageAnalyticsHandlers] Failed to get document stats:', error);
      throw error;
    }
  });

  // Get document edit time series
  ipcMain.handle('usage-analytics:get-document-time-series', async (
    event,
    startDate: number,
    endDate: number,
    granularity: 'hour' | 'day' | 'week' | 'month',
    workspaceId?: string
  ) => {
    try {
      return await analyticsService!.getDocumentEditTimeSeries(startDate, endDate, granularity, workspaceId);
    } catch (error) {
      console.error('[UsageAnalyticsHandlers] Failed to get document time series:', error);
      throw error;
    }
  });
}
