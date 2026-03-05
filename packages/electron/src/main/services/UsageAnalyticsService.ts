/**
 * Usage Analytics Service
 * Provides aggregated statistics for AI usage and document editing patterns
 */

import type { PGLiteDatabaseWorker } from '../database/PGLiteDatabaseWorker';

export interface TokenUsageStats {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  sessionCount: number;
  messageCount: number;
}

export interface ProviderUsageStats {
  provider: string;
  model: string | null;
  sessionCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
}

export interface ProjectUsageStats {
  workspaceId: string;
  sessionCount: number;
  totalTokens: number;
  lastActivity: number;
}

export interface TimeSeriesDataPoint {
  timestamp: number; // Epoch milliseconds
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  sessionCount: number;
}

export interface ActivityHeatmapData {
  hourOfDay: number; // 0-23
  dayOfWeek: number; // 0-6 (Sunday-Saturday)
  activityCount: number;
}

export interface DocumentEditStats {
  workspaceId: string;
  filePath: string;
  editCount: number;
  lastEdited: number;
  sizeBytes: number;
}

export class UsageAnalyticsService {
  constructor(private db: PGLiteDatabaseWorker) {}

  private readonly SESSION_TOKEN_USAGE_CTE = `
    WITH session_token_usage AS (
      SELECT
        s.id,
        s.provider,
        s.model,
        s.workspace_id,
        s.created_at,
        s.updated_at,
        CASE
          WHEN s.provider = 'openai-codex' THEN
            COALESCE(
              codex_usage.input_tokens,
              (s.metadata->'tokenUsage'->>'inputTokens')::bigint,
              0
            )
          ELSE
            COALESCE((s.metadata->'tokenUsage'->>'inputTokens')::bigint, 0)
        END AS input_tokens,
        CASE
          WHEN s.provider = 'openai-codex' THEN
            COALESCE(
              codex_usage.output_tokens,
              (s.metadata->'tokenUsage'->>'outputTokens')::bigint,
              0
            )
          ELSE
            COALESCE((s.metadata->'tokenUsage'->>'outputTokens')::bigint, 0)
        END AS output_tokens,
        CASE
          WHEN s.provider = 'openai-codex' THEN
            COALESCE(
              codex_usage.input_tokens,
              (s.metadata->'tokenUsage'->>'inputTokens')::bigint,
              0
            ) +
            COALESCE(
              codex_usage.output_tokens,
              (s.metadata->'tokenUsage'->>'outputTokens')::bigint,
              0
            )
          ELSE
            COALESCE(
              (s.metadata->'tokenUsage'->>'totalTokens')::bigint,
              COALESCE((s.metadata->'tokenUsage'->>'inputTokens')::bigint, 0) +
              COALESCE((s.metadata->'tokenUsage'->>'outputTokens')::bigint, 0),
              0
            )
        END AS total_tokens
      FROM ai_sessions s
      LEFT JOIN LATERAL (
        SELECT
          (m.content::jsonb->'usage'->>'input_tokens')::bigint AS input_tokens,
          (m.content::jsonb->'usage'->>'output_tokens')::bigint AS output_tokens
        FROM ai_agent_messages m
        WHERE m.session_id = s.id
          AND m.source = 'openai-codex'
          AND m.direction = 'output'
          AND m.metadata->>'eventType' = 'turn.completed'
        ORDER BY m.created_at DESC
        LIMIT 1
      ) codex_usage ON TRUE
      WHERE s.metadata->'tokenUsage' IS NOT NULL
    )
  `;

  /**
   * Get total count of all AI sessions (including those without token data)
   */
  async getAllSessionCount(workspaceId?: string): Promise<number> {
    const whereClause = workspaceId ? `WHERE workspace_id = $1` : '';
    const params = workspaceId ? [workspaceId] : [];

    const result = await this.db.query(
      `SELECT COUNT(DISTINCT id) as total_sessions
      FROM ai_sessions
      ${whereClause}`,
      params
    );

    return parseInt(result.rows[0]?.total_sessions) || 0;
  }

  /**
   * Get overall token usage statistics across all sessions
   */
  async getOverallTokenUsage(workspaceId?: string): Promise<TokenUsageStats> {
    const whereClause = workspaceId ? `WHERE workspace_id = $1` : '';
    const params = workspaceId ? [workspaceId] : [];

    const result = await this.db.query(
      `${this.SESSION_TOKEN_USAGE_CTE}
      SELECT
        COALESCE(SUM(input_tokens), 0) as total_input_tokens,
        COALESCE(SUM(output_tokens), 0) as total_output_tokens,
        COALESCE(SUM(total_tokens), 0) as total_tokens,
        COUNT(DISTINCT id) as session_count
      FROM session_token_usage
      ${whereClause}`,
      params
    );

    const row = result.rows[0] || {};

    return {
      totalInputTokens: parseInt(row.total_input_tokens) || 0,
      totalOutputTokens: parseInt(row.total_output_tokens) || 0,
      totalTokens: parseInt(row.total_tokens) || 0,
      sessionCount: parseInt(row.session_count) || 0,
      messageCount: 0, // TODO: Can be calculated from ai_agent_messages if needed
    };
  }

  /**
   * Get token usage broken down by provider and model
   */
  async getUsageByProvider(workspaceId?: string): Promise<ProviderUsageStats[]> {
    const whereClause = workspaceId ? `WHERE workspace_id = $1` : '';
    const params = workspaceId ? [workspaceId] : [];

    const result = await this.db.query(
      `${this.SESSION_TOKEN_USAGE_CTE}
      SELECT
        provider,
        model,
        COUNT(DISTINCT id) as session_count,
        COALESCE(SUM(input_tokens), 0) as total_input_tokens,
        COALESCE(SUM(output_tokens), 0) as total_output_tokens,
        COALESCE(SUM(total_tokens), 0) as total_tokens
      FROM session_token_usage
      ${whereClause}
      GROUP BY provider, model
      ORDER BY total_tokens DESC`,
      params
    );

    return result.rows.map((row: any) => ({
      provider: row.provider,
      model: row.model,
      sessionCount: parseInt(row.session_count) || 0,
      totalInputTokens: parseInt(row.total_input_tokens) || 0,
      totalOutputTokens: parseInt(row.total_output_tokens) || 0,
      totalTokens: parseInt(row.total_tokens) || 0,
    }));
  }

  /**
   * Get token usage broken down by project (workspace)
   */
  async getUsageByProject(): Promise<ProjectUsageStats[]> {
    const result = await this.db.query(
      `${this.SESSION_TOKEN_USAGE_CTE}
      SELECT
        workspace_id,
        COUNT(DISTINCT id) as session_count,
        COALESCE(SUM(total_tokens), 0) as total_tokens,
        MAX(EXTRACT(EPOCH FROM updated_at) * 1000) as last_activity
      FROM session_token_usage
      GROUP BY workspace_id
      ORDER BY total_tokens DESC`,
      []
    );

    return result.rows.map((row: any) => ({
      workspaceId: row.workspace_id,
      sessionCount: parseInt(row.session_count) || 0,
      totalTokens: parseInt(row.total_tokens) || 0,
      lastActivity: parseFloat(row.last_activity) || Date.now(),
    }));
  }

  /**
   * Get time-series data for token usage over a date range
   * @param startDate - Start of range (epoch ms)
   * @param endDate - End of range (epoch ms)
   * @param granularity - 'hour' | 'day' | 'week' | 'month'
   */
  async getTimeSeriesData(
    startDate: number,
    endDate: number,
    granularity: 'hour' | 'day' | 'week' | 'month' = 'day',
    workspaceId?: string
  ): Promise<TimeSeriesDataPoint[]> {
    const truncFunc = {
      hour: 'hour',
      day: 'day',
      week: 'week',
      month: 'month',
    }[granularity];

    const params = workspaceId ? [startDate, endDate, workspaceId] : [startDate, endDate];

    const whereClause = workspaceId
      ? `WHERE workspace_id = $3 AND created_at >= to_timestamp($1 / 1000.0) AND created_at <= to_timestamp($2 / 1000.0)`
      : `WHERE created_at >= to_timestamp($1 / 1000.0) AND created_at <= to_timestamp($2 / 1000.0)`;

    const result = await this.db.query(
      `${this.SESSION_TOKEN_USAGE_CTE}
      SELECT
        EXTRACT(EPOCH FROM DATE_TRUNC('${truncFunc}', created_at)) * 1000 as timestamp,
        COALESCE(SUM(input_tokens), 0) as input_tokens,
        COALESCE(SUM(output_tokens), 0) as output_tokens,
        COALESCE(SUM(total_tokens), 0) as total_tokens,
        COUNT(DISTINCT id) as session_count
      FROM session_token_usage
      ${whereClause}
      GROUP BY DATE_TRUNC('${truncFunc}', created_at)
      ORDER BY timestamp ASC`,
      params
    );

    return result.rows.map((row: any) => ({
      timestamp: parseFloat(row.timestamp),
      inputTokens: parseInt(row.input_tokens) || 0,
      outputTokens: parseInt(row.output_tokens) || 0,
      totalTokens: parseInt(row.total_tokens) || 0,
      sessionCount: parseInt(row.session_count) || 0,
    }));
  }

  /**
   * Get activity heatmap data (hour of day x day of week)
   * @param workspaceId - Optional workspace filter
   * @param metric - Type of activity to track: sessions, messages, or edits
   * @param timezoneOffsetMinutes - User's timezone offset in minutes (e.g., -300 for EST)
   */
  async getActivityHeatmap(
    workspaceId?: string,
    metric: 'sessions' | 'messages' | 'edits' = 'messages',
    timezoneOffsetMinutes: number = 0
  ): Promise<ActivityHeatmapData[]> {
    let query: string;
    const params: any[] = [];

    // Convert timezone offset to interval format for PostgreSQL
    // Note: getTimezoneOffset() returns positive for west of UTC, so we negate it
    const offsetMinutes = -timezoneOffsetMinutes;

    if (metric === 'messages') {
      // Count AI messages sent (only user messages, not AI responses)
      const whereClause = workspaceId
        ? `WHERE session_id IN (SELECT id FROM ai_sessions WHERE workspace_id = $1) AND direction = 'input'`
        : `WHERE direction = 'input'`;
      if (workspaceId) params.push(workspaceId);

      query = `SELECT
        EXTRACT(HOUR FROM ai_agent_messages.created_at + INTERVAL '${offsetMinutes} minutes') as hour_of_day,
        EXTRACT(DOW FROM ai_agent_messages.created_at + INTERVAL '${offsetMinutes} minutes') as day_of_week,
        COUNT(*) as activity_count
      FROM ai_agent_messages
      ${whereClause}
      GROUP BY hour_of_day, day_of_week
      ORDER BY day_of_week, hour_of_day`;
    } else if (metric === 'edits') {
      // Count document saves (document_history uses timestamp BIGINT, not created_at)
      const whereClause = workspaceId ? `WHERE workspace_id = $1` : '';
      if (workspaceId) params.push(workspaceId);

      query = `SELECT
        EXTRACT(HOUR FROM to_timestamp(timestamp / 1000.0) + INTERVAL '${offsetMinutes} minutes') as hour_of_day,
        EXTRACT(DOW FROM to_timestamp(timestamp / 1000.0) + INTERVAL '${offsetMinutes} minutes') as day_of_week,
        COUNT(*) as activity_count
      FROM document_history
      ${whereClause}
      GROUP BY hour_of_day, day_of_week
      ORDER BY day_of_week, hour_of_day`;
    } else {
      // Count AI sessions created
      const whereClause = workspaceId ? `WHERE workspace_id = $1` : '';
      if (workspaceId) params.push(workspaceId);

      query = `SELECT
        EXTRACT(HOUR FROM created_at + INTERVAL '${offsetMinutes} minutes') as hour_of_day,
        EXTRACT(DOW FROM created_at + INTERVAL '${offsetMinutes} minutes') as day_of_week,
        COUNT(*) as activity_count
      FROM ai_sessions
      ${whereClause}
      GROUP BY hour_of_day, day_of_week
      ORDER BY day_of_week, hour_of_day`;
    }

    const result = await this.db.query(query, params);

    return result.rows.map((row: any) => ({
      hourOfDay: parseInt(row.hour_of_day),
      dayOfWeek: parseInt(row.day_of_week),
      activityCount: parseInt(row.activity_count) || 0,
    }));
  }

  /**
   * Get document edit statistics from document_history table
   */
  async getDocumentEditStats(workspaceId?: string): Promise<DocumentEditStats[]> {
    const whereClause = workspaceId ? `WHERE workspace_id = $1` : '';
    const params = workspaceId ? [workspaceId] : [];

    const result = await this.db.query(
      `SELECT
        workspace_id,
        file_path,
        COUNT(*) as edit_count,
        MAX(EXTRACT(EPOCH FROM created_at) * 1000) as last_edited,
        MAX(size_bytes) as size_bytes
      FROM document_history
      ${whereClause}
      GROUP BY workspace_id, file_path
      ORDER BY edit_count DESC
      LIMIT 100`,
      params
    );

    return result.rows.map((row: any) => ({
      workspaceId: row.workspace_id,
      filePath: row.file_path,
      editCount: parseInt(row.edit_count) || 0,
      lastEdited: parseFloat(row.last_edited) || Date.now(),
      sizeBytes: parseInt(row.size_bytes) || 0,
    }));
  }

  /**
   * Get document edit counts over time
   */
  async getDocumentEditTimeSeries(
    startDate: number,
    endDate: number,
    granularity: 'hour' | 'day' | 'week' | 'month' = 'day',
    workspaceId?: string
  ): Promise<{ timestamp: number; editCount: number }[]> {
    const truncFunc = {
      hour: 'hour',
      day: 'day',
      week: 'week',
      month: 'month',
    }[granularity];

    const whereClause = workspaceId
      ? `WHERE workspace_id = $3 AND created_at >= to_timestamp($1 / 1000.0) AND created_at <= to_timestamp($2 / 1000.0)`
      : `WHERE created_at >= to_timestamp($1 / 1000.0) AND created_at <= to_timestamp($2 / 1000.0)`;

    const params = workspaceId ? [startDate, endDate, workspaceId] : [startDate, endDate];

    const result = await this.db.query(
      `SELECT
        EXTRACT(EPOCH FROM DATE_TRUNC('${truncFunc}', created_at)) * 1000 as timestamp,
        COUNT(*) as edit_count
      FROM document_history
      ${whereClause}
      GROUP BY DATE_TRUNC('${truncFunc}', created_at)
      ORDER BY timestamp ASC`,
      params
    );

    return result.rows.map((row: any) => ({
      timestamp: parseFloat(row.timestamp),
      editCount: parseInt(row.edit_count) || 0,
    }));
  }
}
