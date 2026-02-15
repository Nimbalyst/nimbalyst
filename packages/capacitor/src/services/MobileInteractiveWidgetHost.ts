/**
 * MobileInteractiveWidgetHost
 *
 * Provides InteractiveWidgetHost implementation for Capacitor (mobile).
 * Interactive prompts are displayed inline in the transcript using CustomToolWidgets.
 * Responses are sent via the CollabV3 sync layer to desktop for execution.
 *
 * Key differences from desktop:
 * - Cannot execute git commits directly (sends to desktop)
 * - Cannot open files (mobile has no local filesystem)
 * - Cannot start new sessions (worktree creation is desktop-only)
 * - Responses sent via session_control broadcast, not IPC
 */

import type { InteractiveWidgetHost, PermissionScope } from '@nimbalyst/runtime';
import { analyticsService } from './AnalyticsService';

/**
 * Callback type for sending control messages via the sync layer
 */
export type SendControlMessage = (
  sessionId: string,
  type: string,
  payload?: Record<string, unknown>
) => void;

/**
 * Callback type for appending tool result messages to the transcript
 */
export type AppendToolResult = (
  toolUseId: string,
  result: string
) => Promise<void>;

/**
 * Creates a MobileInteractiveWidgetHost instance for a session.
 *
 * @param sessionId - The session ID
 * @param sendControlMessage - Function to send control messages via sync layer
 * @param appendToolResult - Function to append tool result messages to transcript
 */
export function createMobileInteractiveWidgetHost(
  sessionId: string,
  sendControlMessage: SendControlMessage,
  appendToolResult: AppendToolResult
): InteractiveWidgetHost {
  return {
    sessionId,
    workspacePath: '',  // Not available on mobile
    worktreeId: null,

    // ============================================================
    // AskUserQuestion Operations
    // ============================================================

    async askUserQuestionSubmit(questionId: string, answers: Record<string, string>): Promise<void> {
      // Persist response to transcript as tool result
      await appendToolResult(questionId, JSON.stringify({ answers }));

      // Broadcast to desktop for immediate resolution
      sendControlMessage(sessionId, 'prompt_response', {
        promptType: 'ask_user_question',
        promptId: questionId,
        response: { answers },
      });

      analyticsService.capture('mobile_ask_user_question_response', {
        action: 'submitted',
        question_count: Object.keys(answers).length,
      });
    },

    async askUserQuestionCancel(questionId: string): Promise<void> {
      // Persist cancellation to transcript
      await appendToolResult(questionId, JSON.stringify({ cancelled: true }));

      // Broadcast cancellation - this cancels the session
      sendControlMessage(sessionId, 'cancel');

      analyticsService.capture('mobile_ask_user_question_response', {
        action: 'cancelled',
      });
    },

    // ============================================================
    // ExitPlanMode Operations
    // ============================================================

    async exitPlanModeApprove(requestId: string): Promise<void> {
      sendControlMessage(sessionId, 'prompt_response', {
        promptType: 'exit_plan_mode',
        promptId: requestId,
        response: { approved: true },
      });

      analyticsService.capture('mobile_exit_plan_mode_response', {
        action: 'approved',
      });
    },

    async exitPlanModeStartNewSession(requestId: string, _planFilePath: string): Promise<void> {
      // Mobile cannot create new sessions/worktrees
      // Just approve and let desktop handle session creation
      sendControlMessage(sessionId, 'prompt_response', {
        promptType: 'exit_plan_mode',
        promptId: requestId,
        response: { approved: true, startNewSession: true },
      });

      analyticsService.capture('mobile_exit_plan_mode_response', {
        action: 'start_new_session',
      });
    },

    async exitPlanModeDeny(requestId: string, feedback?: string): Promise<void> {
      sendControlMessage(sessionId, 'prompt_response', {
        promptType: 'exit_plan_mode',
        promptId: requestId,
        response: { approved: false, feedback },
      });

      analyticsService.capture('mobile_exit_plan_mode_response', {
        action: 'denied',
        has_feedback: !!feedback,
      });
    },

    async exitPlanModeCancel(requestId: string): Promise<void> {
      // Cancel the session entirely
      sendControlMessage(sessionId, 'cancel');

      analyticsService.capture('mobile_exit_plan_mode_response', {
        action: 'cancelled',
      });
    },

    // ============================================================
    // Tool Permission Operations
    // ============================================================

    async toolPermissionSubmit(
      requestId: string,
      response: { decision: 'allow' | 'deny'; scope: PermissionScope }
    ): Promise<void> {
      // Persist response to transcript
      await appendToolResult(requestId, JSON.stringify(response));

      // Broadcast to desktop
      sendControlMessage(sessionId, 'prompt_response', {
        promptType: 'tool_permission',
        promptId: requestId,
        response,
      });

      analyticsService.capture('mobile_tool_permission_response', {
        decision: response.decision,
        scope: response.scope,
      });
    },

    async toolPermissionCancel(requestId: string): Promise<void> {
      // Cancel the session
      sendControlMessage(sessionId, 'cancel');

      analyticsService.capture('mobile_tool_permission_response', {
        action: 'cancelled',
      });
    },

    // ============================================================
    // Auto-commit (not supported on mobile)
    // ============================================================

    autoCommitEnabled: false,
    setAutoCommitEnabled(_enabled: boolean): void {
      // No-op on mobile
    },

    // ============================================================
    // Git Commit Operations
    // ============================================================

    async gitCommit(
      proposalId: string,
      files: string[],
      message: string
    ): Promise<{ success: boolean; commitHash?: string; error?: string; pending?: boolean }> {
      // Mobile cannot execute git commands - send approval to desktop
      sendControlMessage(sessionId, 'prompt_response', {
        promptType: 'git_commit',
        promptId: proposalId,
        response: {
          action: 'committed',
          files,
          message,
        },
      });

      analyticsService.capture('mobile_git_commit_response', {
        action: 'approved',
        file_count: files.length,
      });

      // Return pending - actual commit happens on desktop
      // Widget will stay in "Committing..." state until tool result arrives via sync
      return { success: false, pending: true };
    },

    async gitCommitCancel(proposalId: string): Promise<void> {
      sendControlMessage(sessionId, 'prompt_response', {
        promptType: 'git_commit',
        promptId: proposalId,
        response: { action: 'cancelled' },
      });

      analyticsService.capture('mobile_git_commit_response', {
        action: 'cancelled',
      });
    },

    // ============================================================
    // Common Operations
    // ============================================================

    async openFile(_filePath: string): Promise<void> {
      // Cannot open files on mobile - no local filesystem
      console.log('[MobileInteractiveWidgetHost] openFile not available on mobile');
    },

    trackEvent(eventName: string, properties?: Record<string, unknown>): void {
      analyticsService.capture(eventName, properties);
    },
  };
}
