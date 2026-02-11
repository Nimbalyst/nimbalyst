/**
 * Activity Handlers
 *
 * IPC handlers for the Activity History panel.
 * Aggregates session creation, worktree creation, user prompts,
 * and git commits into a unified reverse-chronological timeline.
 */

import simpleGit, { SimpleGit } from 'simple-git';
import log from 'electron-log/main';
import { existsSync } from 'fs';
import { join } from 'path';
import { safeHandle } from '../utils/ipcRegistry';

interface ActivityEvent {
  id: string;
  type: 'session_created' | 'worktree_created' | 'prompt_sent' | 'git_commit';
  timestamp: number;
  sessionId?: string;
  sessionTitle?: string;
  provider?: string;
  worktreeId?: string;
  worktreeName?: string;
  worktreeBranch?: string;
  promptPreview?: string;
  commitHash?: string;
  commitMessage?: string;
  commitAuthor?: string;
}

function isGitRepository(workspacePath: string): boolean {
  try {
    return existsSync(join(workspacePath, '.git'));
  } catch {
    return false;
  }
}

async function hasCommits(git: SimpleGit): Promise<boolean> {
  try {
    await git.revparse(['HEAD']);
    return true;
  } catch {
    return false;
  }
}

export function registerActivityHandlers(): void {
  safeHandle('activity:list', async (_event, workspacePath: string, options?: { page?: number; pageSize?: number }) => {
    if (!workspacePath) {
      throw new Error('workspacePath is required');
    }

    const page = options?.page ?? 0;
    const pageSize = options?.pageSize ?? 100;

    try {
      const events: ActivityEvent[] = [];

      // Source A: Sessions + Worktrees from database
      try {
        const { database } = await import('../database/PGLiteDatabaseWorker');

        const { rows: sessions } = await database.query<{
          id: string;
          title: string;
          provider: string;
          created_at: Date | string;
          worktree_id: string | null;
          worktree_name: string | null;
          worktree_branch: string | null;
          worktree_display_name: string | null;
        }>(
          `SELECT s.id, s.title, s.provider, s.created_at, s.worktree_id,
                  w.name as worktree_name, w.branch as worktree_branch, w.display_name as worktree_display_name
           FROM ai_sessions s
           LEFT JOIN worktrees w ON s.worktree_id = w.id
           WHERE s.workspace_id = $1
           ORDER BY s.created_at DESC`,
          [workspacePath]
        );

        const seenWorktrees = new Set<string>();

        for (const session of sessions) {
          const ts = session.created_at instanceof Date
            ? session.created_at.getTime()
            : new Date(session.created_at).getTime();

          events.push({
            id: `session-${session.id}`,
            type: 'session_created',
            timestamp: ts,
            sessionId: session.id,
            sessionTitle: session.title,
            provider: session.provider,
          });

          if (session.worktree_id && !seenWorktrees.has(session.worktree_id)) {
            seenWorktrees.add(session.worktree_id);
            events.push({
              id: `worktree-${session.worktree_id}`,
              type: 'worktree_created',
              timestamp: ts,
              worktreeId: session.worktree_id,
              worktreeName: session.worktree_display_name || session.worktree_name || session.worktree_id,
              worktreeBranch: session.worktree_branch || undefined,
            });
          }
        }

        // Source B: User prompts
        const { rows: messages } = await database.query<{
          id: string;
          session_id: string;
          created_at: Date | string;
          content: string;
          session_title: string;
        }>(
          `SELECT m.id, m.session_id, m.created_at, m.content, s.title as session_title
           FROM ai_agent_messages m
           JOIN ai_sessions s ON m.session_id = s.id
           WHERE s.workspace_id = $1 AND m.direction = 'input'
           ORDER BY m.created_at DESC`,
          [workspacePath]
        );

        for (const msg of messages) {
          const ts = msg.created_at instanceof Date
            ? msg.created_at.getTime()
            : new Date(msg.created_at).getTime();

          // Content is stored as JSON with the prompt nested inside
          let promptText = msg.content;
          try {
            const parsed = JSON.parse(msg.content);
            if (parsed.prompt) {
              promptText = parsed.prompt;
            }
          } catch {
            // Not JSON, use raw content
          }

          events.push({
            id: `prompt-${msg.id}`,
            type: 'prompt_sent',
            timestamp: ts,
            sessionId: msg.session_id,
            sessionTitle: msg.session_title,
            promptPreview: promptText.length > 500
              ? promptText.slice(0, 500) + '...'
              : promptText,
          });
        }
      } catch (dbError) {
        log.error('[ActivityHandlers] Database query failed:', dbError);
      }

      // Source C: Git commits
      if (isGitRepository(workspacePath)) {
        try {
          const git: SimpleGit = simpleGit(workspacePath);
          if (await hasCommits(git)) {
            const gitLog = await git.log({ maxCount: 200 });
            for (const commit of gitLog.all) {
              events.push({
                id: `commit-${commit.hash}`,
                type: 'git_commit',
                timestamp: new Date(commit.date).getTime(),
                commitHash: commit.hash,
                commitMessage: commit.message,
                commitAuthor: commit.author_name,
              });
            }
          }
        } catch (gitError) {
          log.error('[ActivityHandlers] Git log failed:', gitError);
        }
      }

      // Sort all events by timestamp descending
      events.sort((a, b) => b.timestamp - a.timestamp);

      // Paginate
      const start = page * pageSize;
      const end = start + pageSize;
      const paged = events.slice(start, end);
      const hasMore = end < events.length;

      return { success: true, events: paged, hasMore };
    } catch (error) {
      log.error('[ActivityHandlers] Failed to list activity:', error);
      return { success: false, events: [], hasMore: false, error: String(error) };
    }
  });
}
